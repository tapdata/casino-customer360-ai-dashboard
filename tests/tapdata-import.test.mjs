import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';

function run(connection, task, extra = {}, mode = 'prepare') {
  const dir = mkdtempSync(join(tmpdir(), 'tapdata-import-test-'));
  try {
    writeFileSync(join(dir, 'connection.xlsx'), connection);
    writeFileSync(join(dir, 'task.json'), JSON.stringify(task));
    writeFileSync(join(dir, 'api.json'), JSON.stringify([{ collectionName: 'Modules', json: JSON.stringify({ name: 'Example API' }) }]));
    return spawnSync(process.execPath, ['scripts/tapdata-import.mjs', mode], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, TAPDATA_CONNECTION_EXPORT: join(dir, 'connection.xlsx'), TAPDATA_TASK_EXPORT: join(dir, 'task.json'), TAPDATA_API_EXPORT: join(dir, 'api.json'), TAPDATA_IMPORT_STATE_DIR: dir, ...extra },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const workbookProbe = Buffer.from('PK\x03\x04xl/workbook.xml');
test('rejects non-workbook connection files', () => {
  const result = run('invalid', [{ type: 'Task' }]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not an XLSX workbook/);
});
test('rejects API module exports as CDC tasks', () => {
  const result = run(workbookProbe, [{ type: 'Module' }]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no Task records/);
});
test('offline preparation does not require network credentials', () => {
  const result = run(workbookProbe, [{ type: 'Task', name: 'Example' }]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no network calls/);
});
test('refuses to send credentials to an endpoint on another origin', () => {
  const result = run(workbookProbe, [{ type: 'Task' }], {
    TAPDATA_API_BASE_URL: 'http://127.0.0.1:1',
    TAPDATA_CONNECTION_IMPORT_PATH: 'https://example.invalid/import',
    TAPDATA_TASK_IMPORT_PATH: '/tasks',
    TAPDATA_IMPORT_ALLOW_MISSING_URI: 'true',
    TAPDATA_IMPORT_TOKEN: 'test-secret',
  }, 'api');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /configured API origin/);
  assert.doesNotMatch(result.stdout + result.stderr, /test-secret/);
});

test('accepts the collectionName/json envelope from actual TapData task exports', () => {
  const result = run(workbookProbe, [
    { collectionName: 'Task', json: JSON.stringify({ name: 'Example', dag: { nodes: [] } }) },
    { collectionName: 'Connections', json: JSON.stringify({ name: 'Source' }) },
    { collectionName: 'MetadataInstances', json: '{"taskId":"linked-task"}' },
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /task records=3, connections=1, metadataInstances=1, tasks=1/);
});
test('rejects actual API module envelopes as task exports', () => {
  const result = run(workbookProbe, [{ collectionName: 'Modules', json: '{"name":"Example API"}' }]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no Task records/);
});

test('uploads task and API packages using the TapData 4.21 multipart contract', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        method: request.method,
        path: request.url,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ code: 'ok', data: { items: [] } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const dir = mkdtempSync(join(tmpdir(), 'tapdata-import-api-test-'));
  try {
    writeFileSync(join(dir, 'connection.xlsx'), workbookProbe);
    writeFileSync(join(dir, 'task.json'), JSON.stringify([{ collectionName: 'Task', json: JSON.stringify({ name: 'Example' }) }]));
    writeFileSync(join(dir, 'api.json'), JSON.stringify([{ collectionName: 'Modules', json: JSON.stringify({ name: 'Example API' }) }]));
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['scripts/tapdata-import.mjs', 'api'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          TAPDATA_CONNECTION_EXPORT: join(dir, 'connection.xlsx'),
          TAPDATA_TASK_EXPORT: join(dir, 'task.json'),
          TAPDATA_API_EXPORT: join(dir, 'api.json'),
          TAPDATA_IMPORT_STATE_DIR: dir,
          TAPDATA_API_BASE_URL: `http://127.0.0.1:${address.port}`,
          TAPDATA_IMPORT_TOKEN: 'test-secret',
          TAPDATA_IMPORT_ALLOW_MISSING_URI: 'true',
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(requests.length, 4);
    assert.deepEqual(requests.map((request) => `${request.method} ${new URL(request.path, 'http://127.0.0.1').pathname}`), [
      'POST /api/Task/batch/import',
      'POST /api/Modules/batch/import',
      'GET /api/Task',
      'GET /api/Modules',
    ]);
    assert.match(requests[0].path, /access_token=test-secret/);
    assert.match(requests[0].body, /name="file"/);
    assert.match(requests[0].body, /name="type"\r\n\r\ndataflow/);
    assert.match(requests[0].body, /name="importMode"\r\n\r\nimport_as_copy/);
    assert.match(requests[1].body, /name="type"\r\n\r\nModules/);
    assert.doesNotMatch(result.stdout + result.stderr, /test-secret/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }
});

test('can post-process imported connections, publish modules, and start the resolved task', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ method: request.method, path: request.url, body: Buffer.concat(chunks).toString('utf8') });
      response.setHeader('content-type', 'application/json');
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      let payload = { code: 'ok', data: { items: [] } };
      if (path === '/api/Task') payload = { code: 'ok', data: { items: [{ id: 'task-1', name: 'Example' }] } };
      if (path === '/api/Modules') payload = { code: 'ok', data: { items: [{ id: 'module-1', name: 'Example API', tableName: 'example', connectionId: 'api-connection' }] } };
      if (path === '/api/Connections') payload = { code: 'ok', data: { items: [
        { id: 'source-connection', name: 'MongoDB_Source', status: 'ready' },
        { id: 'target-connection', name: 'MDM', status: 'ready' },
        { id: 'api-connection', name: 'MDM_import', status: 'ready' },
      ] } };
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const dir = mkdtempSync(join(tmpdir(), 'tapdata-import-postprocess-test-'));
  try {
    writeFileSync(join(dir, 'connection.xlsx'), workbookProbe);
    writeFileSync(join(dir, 'task.json'), JSON.stringify([{ collectionName: 'Task', json: JSON.stringify({ name: 'Example' }) }]));
    writeFileSync(join(dir, 'api.json'), JSON.stringify([{ collectionName: 'Modules', json: JSON.stringify({ name: 'Example API' }) }]));
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['scripts/tapdata-import.mjs', 'api'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          TAPDATA_CONNECTION_EXPORT: join(dir, 'connection.xlsx'),
          TAPDATA_TASK_EXPORT: join(dir, 'task.json'),
          TAPDATA_API_EXPORT: join(dir, 'api.json'),
          TAPDATA_IMPORT_STATE_DIR: dir,
          TAPDATA_API_BASE_URL: `http://127.0.0.1:${address.port}`,
          TAPDATA_IMPORT_TOKEN: 'test-secret',
          TAPDATA_IMPORT_ALLOW_MISSING_URI: 'true',
          TAPDATA_IMPORT_POSTPROCESS: 'true',
          TAPDATA_IMPORT_SOURCE_MONGODB_URI: 'mongodb://source.invalid/source',
          TAPDATA_IMPORT_TARGET_MONGODB_URI: 'mongodb://target.invalid/target',
          TAPDATA_IMPORT_AUTOSTART: 'true',
          TAPDATA_TASK_START_PATH_TEMPLATE: '/api/Task/batchStart?taskIds={taskId}',
          TAPDATA_TASK_START_METHOD: 'PUT',
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
    assert.equal(result.status, 0, result.stderr);
    const paths = requests.map((request) => `${request.method} ${new URL(request.path, 'http://127.0.0.1').pathname}${new URL(request.path, 'http://127.0.0.1').search}`);
    assert.equal(paths.filter((path) => path.startsWith('PATCH /api/Connections/')).length, 3);
    assert.equal(paths.filter((path) => path.startsWith('PATCH /api/Modules?')).length, 1);
    assert.ok(paths.some((path) => path.startsWith('PUT /api/Task/batchStart?taskIds=task-1')));
    assert.match(result.stdout, /post-processing verified 3 MongoDB connection\(s\) and published 1 API module\(s\)/);
    assert.doesNotMatch(result.stdout + result.stderr, /test-secret/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }
});
