import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(process.argv[2] || '.env.external');
const mode = process.argv[3] || 'install';
const state = join(root, 'runtime/external-demo');
const service = 'tapdata-casino-demo';
const log = message => console.log(`[external-demo] ${message}`);
function run(command, args, env, label) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${label || command} failed`);
}
function config() {
  const supplied = parseEnv(readFileSync(configPath, 'utf8'));
  const env = { ...process.env, ...supplied, PATH: `${dirname(process.execPath)}:${process.env.PATH || '/usr/bin:/bin'}` };
  for (const key of ['TAPDATA_IMPORT_API_BASE_URL', 'TAPDATA_API_BASE_URL', 'TAPDATA_IMPORT_SOURCE_MONGODB_URI', 'MONGO_AUDIT_URI', 'AI_PANEL_PUBLIC_HOST']) {
    if (!supplied[key] || /[<>]/.test(supplied[key])) throw new Error(`Configure ${key}`);
  }
  if (!supplied.TAPDATA_IMPORT_TOKEN && !supplied.TAPDATA_IMPORT_AUTHORIZATION) throw new Error('Configure TapData import authentication');
  if (!supplied.TAPDATA_ACCESS_TOKEN && !(supplied.TAPDATA_CLIENT_ID && supplied.TAPDATA_CLIENT_SECRET && supplied.TAPDATA_TOKEN_URL)) throw new Error('Configure TapData published API authentication');
  const provider = supplied.AI_PROVIDER || 'deepseek';
  if (!['deepseek', 'openai'].includes(provider) || !supplied[provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY']) throw new Error('Configure AI_PROVIDER and its API key');
  if (!/^[a-zA-Z0-9.-]+$/.test(supplied.AI_PANEL_PUBLIC_HOST)) throw new Error('AI_PANEL_PUBLIC_HOST must be an IPv4 address or hostname');
  const port = Number(supplied.AI_PANEL_PORT || 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('AI_PANEL_PORT must be 1024..65535');
  Object.assign(env, {
    AI_PANEL_PORT: String(port), NODE_ENV: 'production',
    MONGO_AUDIT_HTTP_URL: '', LOCAL_AI_PROXY: '',
    MONGO_SNAPSHOT_URI: supplied.MONGO_SNAPSHOT_URI || supplied.MONGO_AUDIT_URI,
    MONGO_SNAPSHOT_DB: supplied.MONGO_SNAPSHOT_DB || supplied.MONGO_AUDIT_DB || 'marketing_demo',
    TAPDATA_IMPORT_ROOT: resolve(root, supplied.TAPDATA_IMPORT_ROOT || 'deploy/tapdata/templates'),
    TAPDATA_IMPORT_STATE_DIR: join(state, 'import'),
    SOURCE_RESTORE_BACKUP_DIR: resolve(root, supplied.SOURCE_RESTORE_BACKUP_DIR || 'seed/demo'),
    SOURCE_RESTORE_URI: supplied.TAPDATA_IMPORT_SOURCE_MONGODB_URI,
    SOURCE_RESTORE_ALLOW_REMOTE: 'true',
    SOURCE_MONGO_URI: supplied.TAPDATA_IMPORT_SOURCE_MONGODB_URI,
    SOURCE_MONGO_DB: 'tapdata_casino_marketing',
    FEEDER_WRITE_ENABLED: supplied.FEEDER_ENABLED === 'false' ? 'false' : 'true',
    TAPDATA_IMPORT_POSTPROCESS: 'true', TAPDATA_IMPORT_AUTOSTART: 'true',
    TAPDATA_IMPORT_VERIFY_MDM_DATA: 'true', TAPDATA_IMPORT_ALLOW_PARTIAL_API: 'false',
  });
  return env;
}
async function preflight(env) {
  const { MongoClient } = await import('mongodb');
  for (const [key, database] of [['TAPDATA_IMPORT_SOURCE_MONGODB_URI', 'tapdata_casino_marketing'], ['MONGO_AUDIT_URI', env.MONGO_AUDIT_DB || 'marketing_demo']]) {
    const client = new MongoClient(env[key], { serverSelectionTimeoutMS: 5000 });
    try {
      if (key !== 'MONGO_AUDIT_URI' && client.options.dbName !== database) throw new Error('Wrong database');
      await client.connect();
      await client.db(database).command({ ping: 1 });
      if (key.includes('SOURCE')) {
        const hello = await client.db('admin').command({ hello: 1 });
        if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('Replica set required');
      }
    } catch { throw new Error(`${key}: database name, connectivity or replica-set check failed`); }
    finally { await client.close(); }
  }
  const url = new URL('/api/Task', env.TAPDATA_IMPORT_API_BASE_URL);
  if (env.TAPDATA_IMPORT_TOKEN) url.searchParams.set('access_token', env.TAPDATA_IMPORT_TOKEN);
  const response = await fetch(url, { headers: env.TAPDATA_IMPORT_AUTHORIZATION ? { Authorization: env.TAPDATA_IMPORT_AUTHORIZATION } : {}, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok || !(response.headers.get('content-type') || '').includes('json')) throw new Error('TapData manager authentication check failed');
  const body = await response.json();
  if (body.error || (body.code !== undefined && !['ok', 'OK', 0, 200, '200'].includes(body.code))) throw new Error('TapData manager rejected preflight');
  if (env.TAPDATA_IMPORT_RESTORE_SOURCE !== 'false') {
    if (existsSync(join(env.SOURCE_RESTORE_BACKUP_DIR, 'manifest.json'))) {
      const { loadSeed } = await import('./demo-seed.mjs');
      loadSeed(env.SOURCE_RESTORE_BACKUP_DIR);
    } else {
      for (const executable of ['mongosh', 'mongorestore']) {
        if (spawnSync(executable, ['--version'], { stdio: 'ignore' }).status !== 0) throw new Error(`Legacy archive requires ${executable}`);
      }
      const { verifyBackup } = await import('./verify-source-backup.mjs');
      await verifyBackup(env.SOURCE_RESTORE_BACKUP_DIR);
    }
  }
  run(process.execPath, ['scripts/tapdata-import.mjs', 'prepare'], env, 'Export validation');
  log('Preflight passed');
}
async function supervise(env) {
  let stopping = false;
  const children = new Set();
  function start(args, name) {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
    children.add(child);
    child.on('error', () => { log(`${name} could not start`); });
    child.on('exit', () => {
      children.delete(child);
      if (!stopping) { log(`${name} exited; restarting in 5 seconds`); setTimeout(() => { if (!stopping) start(args, name); }, 5000); }
    });
  }
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
    setTimeout(() => process.exit(0), 10000).unref();
  });
  start(['node_modules/next/dist/bin/next', 'start', '-p', env.AI_PANEL_PORT, '-H', '0.0.0.0'], 'Panel');
  if (env.FEEDER_ENABLED !== 'false') start(['scripts/mongo-source-feeder.mjs'], 'Feeder');
}
let publishedTokenCache;
async function publishedToken(env) {
  if (env.TAPDATA_ACCESS_TOKEN) return env.TAPDATA_ACCESS_TOKEN;
  if (publishedTokenCache?.expiresAt > Date.now() + 30_000) return publishedTokenCache.value;
  const form = new URLSearchParams({ grant_type: 'client_credentials' });
  const headers = { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' };
  if (env.TAPDATA_TOKEN_AUTH_METHOD === 'client_secret_basic') {
    headers.authorization = `Basic ${Buffer.from(`${env.TAPDATA_CLIENT_ID}:${env.TAPDATA_CLIENT_SECRET}`).toString('base64')}`;
  } else {
    form.set('client_id', env.TAPDATA_CLIENT_ID);
    form.set('client_secret', env.TAPDATA_CLIENT_SECRET);
  }
  const response = await fetch(env.TAPDATA_TOKEN_URL, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!response.ok) throw new Error('Published API token request failed');
  const payload = await response.json();
  const value = payload.access_token || payload.accessToken || payload.data?.access_token || payload.data?.accessToken;
  if (typeof value !== 'string' || !value) throw new Error('Published API token response was invalid');
  publishedTokenCache = { value, expiresAt: Date.now() + Math.max(Number(payload.expires_in || payload.expiresIn || 300), 60) * 1000 };
  return value;
}
async function publishedFind(env, collection, filter) {
  const token = await publishedToken(env);
  const path = (env.TAPDATA_FIND_PATH_TEMPLATE || '/api/v1/{collection}/find').replaceAll('{collection}', encodeURIComponent(collection));
  const url = new URL(path, env.TAPDATA_API_BASE_URL);
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ page: 1, limit: 100, filter }),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Published API query failed (${response.status})`);
  const payload = await response.json();
  const candidates = [payload?.data?.items, payload?.data?.records, payload?.items, payload?.records, Array.isArray(payload?.data) ? payload.data : undefined];
  return candidates.find(Array.isArray) || [];
}
async function verifyCdc(env) {
  if (env.FEEDER_ENABLED === 'false') return;
  const { MongoClient } = await import('mongodb');
  const { feederConfig, runTick } = await import('./mongo-source-feeder.mjs');
  const source = new MongoClient(env.SOURCE_MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await source.connect();
    const since = new Date();
    const result = await runTick(source, feederConfig(env));
    if (!result.updated) throw new Error('CDC probe found no active source sessions to update');
    const rows = await source.db('tapdata_casino_marketing').collection('patron_table_sessions').find({ lastActionAt: { $gte: since } }).toArray();
    if (!rows.length) throw new Error('CDC probe could not read updated source sessions');
    for (let attempt = 0; attempt < 60; attempt++) {
      const copies = await publishedFind(env, 'patron_table_sessions', { playerId: rows[0].playerId });
      if (copies.some(copy => String(copy.playerId) === String(rows[0].playerId) && Number(copy.sessionBetAmount) === Number(rows[0].sessionBetAmount))) {
        log('Source update reached MDM; CDC probe passed');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error('CDC probe timed out; source changes did not reach MDM');
  } finally { await source.close(); }
}
async function ready(env) {
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${env.AI_PANEL_PORT}/api/data/patrons`, { signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (response.ok && data.mode === 'live' && data.count > 0 && data.partial === false && data.warnings?.length === 0) {
        log(`Panel data check passed: http://${env.AI_PANEL_PUBLIC_HOST}:${env.AI_PANEL_PORT}`);
        return;
      }
    } catch { /* service may still be starting */ }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Panel live-data check failed; inspect journalctl -u tapdata-casino-demo');
}
async function main() {
  if (!['install', 'check', 'serve', 'status', 'stop'].includes(mode)) throw new Error('Mode: install, check, status, stop');
  const env = config();
  if (mode === 'serve') return supervise(env);
  if (mode === 'status' || mode === 'stop') return run('systemctl', [mode, service], env);
  if (mode === 'install' && (process.platform !== 'linux' || process.getuid() !== 0)) throw new Error('Install on the destination Linux server using sudo; check mode is available locally');
  mkdirSync(state, { recursive: true, mode: 0o700 });
  chmodSync(configPath, 0o600);
  if (!existsSync(join(root, 'node_modules/mongodb'))) run('npm', ['ci', '--include=dev'], env);
  await preflight(env);
  if (mode === 'check') return;
  // Refuse to silently reimport after a partial or uncertain remote mutation.
  const fingerprint = createHash('sha256').update(JSON.stringify([env.TAPDATA_IMPORT_API_BASE_URL, env.TAPDATA_IMPORT_SOURCE_MONGODB_URI, env.TAPDATA_IMPORT_TARGET_CONNECTION_NAME || 'MDM', ...['tasks/TapData_CDC_Patron_Table_Sessions_To_MongoDB-20260915.json.gz', 'apis/module_batch-20260915.json.gz'].map(file => createHash('sha256').update(readFileSync(join(env.TAPDATA_IMPORT_ROOT, file))).digest('hex'))])).digest('hex');
  const checkpoint = join(state, 'deployment.json');
  const previous = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, 'utf8')) : null;
  if (previous && (previous.fingerprint !== fingerprint || previous.phase !== 'imported')) throw new Error('Deployment config changed or import was interrupted. Inspect runtime/external-demo/deployment.json and remote tasks before retrying; automatic duplicate imports are blocked');
  const active = spawnSync('systemctl', ['is-active', '--quiet', service]).status === 0;
  if (!active) await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error('AI panel port is occupied')));
    server.listen(Number(env.AI_PANEL_PORT), '0.0.0.0', () => server.close(resolve));
  });
  // Build before writing to the destination services.
  if (!existsSync(join(root, '.next/BUILD_ID'))) run('npm', ['run', 'build'], env);
  if (!previous) {
    if (env.TAPDATA_IMPORT_RESTORE_SOURCE !== 'false') {
      if (existsSync(join(env.SOURCE_RESTORE_BACKUP_DIR, 'manifest.json'))) run(process.execPath, ['scripts/demo-seed.mjs', 'restore'], env, 'Demo source restore');
      else run('mongosh', ['--nodb', '--quiet', 'scripts/mongo-source-restore.cjs'], env, 'Source restore');
    }
    writeFileSync(checkpoint, JSON.stringify({ fingerprint, phase: 'importing' }), { mode: 0o600 });
    run(process.execPath, ['scripts/tapdata-import.mjs', 'api'], env, 'TapData import');
    writeFileSync(checkpoint, JSON.stringify({ fingerprint, phase: 'imported' }), { mode: 0o600 });
  } else log('Completed import checkpoint found; reusing imported objects');
  if (active) run('systemctl', ['stop', service], env);
  await verifyCdc(env);
  const quote = value => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', '$$') + '"';
  const unit = `[Unit]\nDescription=TapData casino demo panel and data feeder\nWants=network-online.target\nAfter=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${quote(root)}\nExecStart=${quote(process.execPath)} ${quote(join(root, 'scripts/external-demo.mjs'))} ${quote(configPath)} serve\nRestart=always\nRestartSec=5\nKillMode=control-group\nUMask=0077\n\n[Install]\nWantedBy=multi-user.target\n`;
  writeFileSync(`/etc/systemd/system/${service}.service`, unit, { mode: 0o644 });
  run('systemctl', ['daemon-reload'], env);
  run('systemctl', ['enable', service], env);
  run('systemctl', ['restart', service], env);
  await ready(env);
}
main().catch(error => {
  // Do not echo driver/network errors containing connection strings or credentials.
  const message = error instanceof Error ? error.message : 'Deployment failed';
  console.error(`[external-demo] ${/mongodb:|mongodb\+srv:|https?:|access_token|password/i.test(message) ? 'Operation failed; check private configuration and service connectivity' : message}`);
  process.exitCode = 1;
});
