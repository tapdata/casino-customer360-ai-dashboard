/* global connect, quit */
/* eslint-disable @typescript-eslint/no-require-imports -- mongosh loads Node built-ins through CommonJS */
/* Executed by mongosh --nodb; credentials never enter command arguments. */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

async function restore() {
  const database = 'tapdata_casino_marketing';
  const root = '/backup';
  const archive = `${root}/${database}.archive.gz`;
  const expected = fs.readFileSync(`${root}/archive.sha256`, 'utf8').trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Invalid archive checksum');
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw new Error('Archive checksum mismatch');
  const manifest = JSON.parse(fs.readFileSync(`${root}/restore-manifest.json`, 'utf8'));
  if (manifest.database !== database || !manifest.collections?.length || manifest.sha256 !== expected) {
    throw new Error('Invalid restore manifest');
  }
  const uri = process.env.SOURCE_RESTORE_URI;
  if (!uri) throw new Error('SOURCE_RESTORE_URI is required');
  const parsed = new URL(uri);
  const allowRemote = process.env.SOURCE_RESTORE_ALLOW_REMOTE === 'true';
  if (!allowRemote && (parsed.hostname !== 'mongo' || parsed.port !== '27017' || parsed.pathname !== `/${database}`)) {
    throw new Error('Restore target must be the bundled mongo:27017 source database');
  }
  if (allowRemote && parsed.pathname !== `/${database}`) {
    throw new Error(`Restore target database must be ${database}`);
  }
  const target = (await connect(uri)).getSiblingDB(database);
  const state = target.getSiblingDB('demo_deployment_state').getCollection('source_restores');
  const existing = await target.getCollectionInfos();
  const marker = await state.findOne({ _id: database });
  if (existing.length) {
    if (marker?.sha256 === expected && marker.status === 'complete' && manifest.collections.every(c => existing.some(e => e.name === c.name))) {
      print('[restore] already restored; existing data kept');
      return;
    }
    throw new Error('Target database is not empty or a previous restore was incomplete; refusing to overwrite');
  }
  const privateDir = fs.mkdtempSync('/tmp/mongo-restore-');
  const config = `${privateDir}/config.yml`;
  try {
    fs.writeFileSync(config, `uri: ${JSON.stringify(uri)}\n`, { mode: 0o600 });
    const result = spawnSync('mongorestore', [
      `--config=${config}`, `--archive=${archive}`, '--gzip',
      `--nsInclude=${database}.*`, '--stopOnError',
    ], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error('mongorestore failed; target may be partially restored; no automatic overwrite will be attempted');
    for (const collection of manifest.collections) {
      const actual = await target.getCollection(collection.name).countDocuments({});
      if (actual !== collection.count) throw new Error(`Restored count mismatch in ${collection.name}`);
    }
    await state.updateOne({ _id: database }, { $set: { status: 'complete', sha256: expected, restoredAt: new Date(), collections: manifest.collections } }, { upsert: true });
    print(`[restore] verified ${manifest.collections.length} collections`);
  } finally {
    fs.rmSync(privateDir, { recursive: true, force: true });
  }
}
restore().catch(() => { print('[restore] failed or refused; verify checksum, empty target, credentials and restore manifest. Existing data is never dropped.'); quit(1); });
