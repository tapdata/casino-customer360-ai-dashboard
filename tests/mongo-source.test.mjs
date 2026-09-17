import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { feederConfig, buildChanges, runTick } from '../scripts/mongo-source-feeder.mjs';
import { verifyBackup } from '../scripts/verify-source-backup.mjs';

const checksum = 'a'.repeat(64);
test('writes are disabled by default and reject before any database access', async () => {
  assert.equal(feederConfig({}).writeEnabled, false);
  await assert.rejects(runTick({}, feederConfig({})), /Writes are disabled/);
  assert.throws(() => feederConfig({ SOURCE_MONGO_DB: 'casino_source' }), /Source database/);
  assert.throws(() => feederConfig({ FEEDER_SESSION_UPDATES_PER_TICK: '1000' }), /Invalid/);
  const result = spawnSync(process.execPath, ['scripts/mongo-source-feeder.mjs', '--once'], { encoding: 'utf8', env: { PATH: process.env.PATH, SOURCE_MONGO_URI: 'mongodb://secret.invalid' } });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /secret.invalid/);
});
test('offline plan succeeds in a clean directory without installed dependencies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feeder-plan-'));
  try {
    const script = join(dir, 'feeder.mjs');
    writeFileSync(script, readFileSync(new URL('../scripts/mongo-source-feeder.mjs', import.meta.url)));
    const result = spawnSync(process.execPath, [script, '--dry-run'], { encoding: 'utf8', env: { PATH: process.env.PATH }, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).database, 'tapdata_casino_marketing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('updates preserve camelCase schema and do not alter identity, risk or active state', () => {
  const changes = buildChanges({ sessionBetAmount: 100, currentStackEstimate: 50 }, { adt: 1000, pointsBalance: 20 }, 500, new Date(0));
  assert.equal(changes.session.$inc.sessionBetAmount, 500);
  assert.equal(changes.session.$set.previousBetAmount.valueOf(), 100);
  assert.equal(changes.profile.$inc.adt, 125);
  assert.equal(changes.snapshot.$set['patronSnapshot.pointsBalance'], 770);
  assert.doesNotMatch(JSON.stringify(changes), /isActive|riskFlags|playerId|fullName|tier/);
  assert.throws(() => buildChanges({ sessionBetAmount: '100' }, {}, 500, new Date()), /numeric/);
});
test('session, profile and snapshots share one transaction with no inserts', async () => {
  const writes = [];
  const transaction = { withTransaction: fn => fn(), endSession: async () => {} };
  const sessions = {
    aggregate: () => ({ toArray: async () => [{ _id: 's1' }] }),
    findOne: async () => ({ _id: 's1', playerId: 'p1', sessionBetAmount: 100, currentStackEstimate: 50 }),
    updateOne: async (...args) => writes.push(['session', ...args]),
    updateMany: async (...args) => writes.push(['snapshot', ...args]),
  };
  const profiles = {
    find: () => ({ limit: () => ({ toArray: async () => [{ _id: 'p1', adt: 1000, pointsBalance: 20 }] }) }),
    updateOne: async (...args) => writes.push(['profile', ...args]),
  };
  const client = { db: name => { assert.equal(name, 'tapdata_casino_marketing'); return { collection: name => name === 'patron_profiles' ? profiles : sessions }; }, startSession: () => transaction };
  assert.equal((await runTick(client, feederConfig({ FEEDER_WRITE_ENABLED: 'true' }))).updated, 1);
  assert.equal(writes.length, 3);
  for (const write of writes) assert.equal(write[3].session, transaction);
});
test('backup verification rejects a modified archive', async () => {
  const root = mkdtempSync(join(tmpdir(), 'backup-check-'));
  try {
    const bytes = Buffer.from('test archive');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(root, 'tapdata_casino_marketing.archive.gz'), bytes);
    writeFileSync(join(root, 'archive.sha256'), sha256);
    writeFileSync(join(root, 'restore-manifest.json'), JSON.stringify({ database: 'tapdata_casino_marketing', sha256, collections: [{ name: 'patron_profiles', count: 2 }] }));
    assert.equal((await verifyBackup(root)).documents, 2);
    writeFileSync(join(root, 'tapdata_casino_marketing.archive.gz'), 'corrupt');
    await assert.rejects(verifyBackup(root), /checksum mismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

async function restoreScenario({ occupied = false, marker = null, uriHost = 'mongo', count = 2, status = 0 } = {}) {
  const calls = [], logs = [];
  const manifest = { database: 'tapdata_casino_marketing', sha256: checksum, collections: [{ name: 'patron_profiles', count: 2 }] };
  const state = { findOne: () => marker, updateOne: (...args) => calls.push(['marker', ...args]) };
  const db = {
    getSiblingDB: () => ({ getCollection: () => state }),
    getCollectionInfos: () => occupied ? [{ name: 'patron_profiles' }] : [],
    getCollection: () => ({ countDocuments: () => count }),
  };
  const fakeFs = {
    readFileSync: path => path.endsWith('archive.sha256') ? checksum : JSON.stringify(manifest),
    createReadStream: async function* () { yield Buffer.from('fake'); },
    mkdtempSync: () => '/tmp/mock-restore', writeFileSync: () => {}, rmSync: () => {},
  };
  const context = {
    require: name => name === 'node:fs' ? fakeFs : name === 'node:crypto' ? { createHash: () => ({ update: () => {}, digest: () => checksum }) } : { spawnSync: (_name, args) => { calls.push(['restore', args]); return { status }; } },
    process: { env: { SOURCE_RESTORE_URI: `mongodb://admin:test@${uriHost}:27017/tapdata_casino_marketing` } },
    URL, connect: () => ({ getSiblingDB: () => db }), print: text => logs.push(text), quit: code => calls.push(['quit', code]),
  };
  await vm.runInNewContext(readFileSync(new URL('../scripts/mongo-source-restore.cjs', import.meta.url), 'utf8'), context);
  return { calls, logs };
}
test('restore refuses nonempty unmarked databases and remote targets', async () => {
  for (const input of [{ occupied: true }, { uriHost: 'cloud.example' }]) {
    const result = await restoreScenario(input);
    assert.equal(result.calls.some(c => c[0] === 'restore'), false);
    assert.equal(result.calls.some(c => c[0] === 'quit'), true);
  }
});
test('repeat restore keeps existing data when the checksum marker matches', async () => {
  const result = await restoreScenario({ occupied: true, marker: { sha256: checksum, status: 'complete' } });
  assert.equal(result.calls.length, 0);
  assert.match(result.logs[0], /already restored/);
});
test('restore checks counts and never drops existing collections', async () => {
  const success = await restoreScenario();
  assert.equal(success.calls.filter(c => c[0] === 'marker').length, 1);
  assert.equal(success.calls.find(c => c[0] === 'restore')[1].includes('--drop'), false);
  for (const input of [{ count: 1 }, { status: 1 }]) {
    const result = await restoreScenario(input);
    assert.equal(result.calls.some(c => c[0] === 'marker'), false);
    assert.equal(result.calls.some(c => c[0] === 'quit'), true);
  }
});
