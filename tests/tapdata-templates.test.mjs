import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageFiles, sanitize } from '../scripts/prepare-tapdata-templates.mjs';

const root = 'deploy/tapdata/templates';
const read = file => JSON.parse(gunzipSync(readFileSync(join(root, file)))).map(r => ({ kind: r.collectionName, body: JSON.parse(r.json) }));
test('sanitizes credentials including nested serialized records', () => {
  const input = { json: JSON.stringify({ config: { uri: 'mongodb://alice:secret@10.1.2.3/tapdata_casino_marketing', password: 'hidden' }, createUser: 'alice@company.com', accessNodeProcessIdList: ['private-node'], syncPoints: [{ offset: 123 }] }) };
  const result = sanitize(input);
  assert.doesNotMatch(result.json, /alice|secret|hidden|10\.1\.2\.3|private-node|123/);
  assert.equal(JSON.parse(result.json).config.uri, 'mongodb://demo.invalid:27017/tapdata_casino_marketing');
});
test('distributed packages match checksums and contain only placeholder Mongo addresses', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json')));
  for (const file of packageFiles) {
    const bytes = readFileSync(join(root, file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.packages.find(p => p.file === file).sha256);
    const records = read(file);
    function inspect(value, key = '') {
      if (/password|secret|token|^username$|^createUser$|^last_user_name$|^user_id$|^accessNodeProcessId/.test(key)) assert.ok(value === '' || (Array.isArray(value) && value.length === 0));
      if (Array.isArray(value)) return value.forEach(v => inspect(v));
      if (value && typeof value === 'object') return Object.entries(value).forEach(([k, v]) => inspect(v, k));
      if (typeof value === 'string') {
        assert.doesNotMatch(value, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
        if (/mongodb(?:\+srv)?:\/\//i.test(value)) assert.match(value, /^mongodb:\/\/demo\.invalid:27017\/(tapdata_casino_marketing|marketing_mdm)$/);
        if (/@/.test(value)) assert.equal(value, 'demo@example.invalid');
      }
    }
    records.forEach(r => inspect(r.body));
  }
});
test('templates preserve task connection references and all 23 API modules', () => {
  const taskRows = read(packageFiles[0]);
  const tasks = taskRows.filter(r => r.kind === 'Task');
  assert.equal(tasks.length, 1);
  const connections = new Set(taskRows.filter(r => r.kind === 'Connections').map(r => r.body.id));
  tasks[0].body.dag.nodes.forEach(node => assert.ok(connections.has(node.connectionId)));
  const target = tasks[0].body.dag.nodes.find(node => node.syncObjects);
  assert.equal(Object.keys(target.syncObjects[0].tableNameRelation).length, 23);
  const apiRows = read(packageFiles[1]);
  const modules = apiRows.filter(r => r.kind === 'Modules');
  assert.equal(new Set(modules.map(r => r.body.name)).size, 23);
  const apiConnections = new Set(apiRows.filter(r => r.kind === 'Connections').map(r => r.body.id));
  modules.forEach(r => assert.ok(apiConnections.has(r.body.connectionId)));
});
test('existing importer accepts the distributed packages without contacting TapData', () => {
  const state = mkdtempSync(join(tmpdir(), 'template-import-'));
  try {
    const result = spawnSync(process.execPath, ['scripts/tapdata-import.mjs', 'prepare'], { env: { ...process.env, TAPDATA_IMPORT_ROOT: root, TAPDATA_IMPORT_STATE_DIR: state }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /modules=23/);
    assert.match(result.stdout, /no network calls/);
  } finally { rmSync(state, { recursive: true, force: true }); }
});
