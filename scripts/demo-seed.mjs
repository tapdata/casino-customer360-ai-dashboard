import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { BSON, MongoClient } from 'mongodb';
import { verifyBackup } from './verify-source-backup.mjs';
export const DATABASE = 'tapdata_casino_marketing';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const identityKey = /^(?:fullName|maskedName|mobileHash|passportHash|casinoCardNo|loyaltyCardNo|phone|mobile|email|address|passport|idCard|agentName|suggestedPrName)$/i;
const secretKey = /password|secret|token|privateKey|authorization/i;
const personName = (key, path) => key === 'name' && /patron_profiles|patronSnapshot|agentSnapshot|pr_agent_profiles/.test(path);

// The archive is a sequence of BSON blocks separated by 0xffffffff. Only this
// checked-in demo's ordinary collection format is accepted (no oplog/views).
export function decodeArchive(bytes) {
  if (bytes.readUInt32LE(0) !== 0x8199e26d) throw new Error('Invalid mongodump magic');
  let pos = 4, block = 0, header = true, collection;
  const collections = new Map();
  while (pos < bytes.length) {
    if (pos + 4 > bytes.length) throw new Error('Truncated archive');
    const length = bytes.readInt32LE(pos);
    if (length === -1) { pos += 4; block++; header = true; continue; }
    if (length < 5 || pos + length > bytes.length) throw new Error('Invalid BSON frame');
    const doc = BSON.deserialize(bytes.subarray(pos, pos + length), { promoteValues: false });
    pos += length;
    if (header) {
      if (block > 0) {
        if (doc.db !== DATABASE || !collections.has(doc.collection)) throw new Error('Unknown archive namespace');
        collection = doc.EOF ? null : doc.collection;
      }
      header = false;
    } else if (block === 0) {
      if (doc.db !== DATABASE || collections.has(doc.collection)) throw new Error('Unexpected collection');
      const meta = BSON.EJSON.parse(doc.metadata, { relaxed: false });
      if (Object.keys(meta.options || {}).length) throw new Error('Collection options require explicit review');
      collections.set(doc.collection, { documents: [], indexes: meta.indexes || [] });
    } else {
      if (!collection) throw new Error('Data after EOF');
      collections.get(collection).documents.push(doc);
    }
  }
  if (!header) throw new Error('Unterminated archive block');
  return collections;
}
function walk(value, visit, path = '', key = '') {
  if (typeof value === 'string') return visit(value, key, path);
  if (Array.isArray(value)) return value.map(item => walk(item, visit, path, key));
  if (value && typeof value === 'object' && !value._bsontype && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, visit, `${path}.${k}`, k)]));
  return value;
}
export async function prepareSeed(input, output) {
  const source = await verifyBackup(input);
  const expected = JSON.parse(readFileSync(join(input, 'restore-manifest.json')));
  const collections = decodeArchive(gunzipSync(readFileSync(join(input, `${DATABASE}.archive.gz`))));
  if (collections.size !== 23 || collections.size !== expected.collections.length) throw new Error('Expected 23 collections');
  const replacements = new Map();
  for (const [name, data] of collections) {
    if (data.documents.length !== expected.collections.find(c => c.name === name)?.count) throw new Error('Source count mismatch');
    for (const doc of data.documents) walk(doc, (value, key, path) => {
      if (value && (identityKey.test(key) || personName(key, path))) replacements.set(value, null);
      return value;
    }, name);
  }
  // Use opaque sequence labels instead of hashes. A short hash of a name or
  // card number could be brute-forced from a public repository.
  let labelNumber = 0;
  for (const value of replacements.keys()) replacements.set(value, `Demo-${String(++labelNumber).padStart(5, '0')}`);
  const escaped = [...replacements.keys()].filter(s => s.length >= 2).sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(escaped.join('|'), 'g');
  const sanitize = (value, key, path) => {
    if (secretKey.test(key)) return '';
    if (identityKey.test(key) || personName(key, path)) return value ? (replacements.get(value) || 'Demo-Unknown') : value;
    return value.replace(pattern, match => replacements.get(match))
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, 'demo@example.invalid')
      .replace(/\b(?:https?|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi, 'demo.invalid');
  };
  mkdirSync(output, { recursive: true });
  const manifest = { format: 'demo-ejson-v1', database: DATABASE, sourceSha256: source.sha256, anonymized: true, collections: [] };
  for (const [name, data] of collections) {
    const documents = data.documents.map(doc => walk(doc, sanitize, name));
    const bytes = gzipSync(documents.map(doc => BSON.EJSON.stringify(doc, { relaxed: false })).join('\n') + '\n');
    const file = `${name}.ejson.gz`;
    writeFileSync(join(output, file), bytes);
    const indexes = data.indexes.filter(i => i.name !== '_id_').map(({ key, name, unique, sparse, expireAfterSeconds, partialFilterExpression }) => Object.fromEntries(Object.entries({ key, name, unique, sparse, expireAfterSeconds, partialFilterExpression }).filter(([, v]) => v !== undefined)));
    manifest.collections.push({ name, count: documents.length, file, sha256: digest(bytes), indexes: BSON.EJSON.serialize(indexes) });
  }
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
export function loadSeed(root) {
  const raw = readFileSync(join(root, 'manifest.json'));
  const manifest = JSON.parse(raw);
  if (manifest.format !== 'demo-ejson-v1' || manifest.database !== DATABASE || manifest.anonymized !== true || manifest.collections?.length !== 23) throw new Error('Invalid demo seed manifest');
  const names = new Set();
  const collections = manifest.collections.map(c => {
    if (!/^[a-z][a-z0-9_]*$/.test(c.name) || c.file !== `${c.name}.ejson.gz` || names.has(c.name) || !Number.isSafeInteger(c.count) || c.count < 1) throw new Error('Invalid collection manifest');
    names.add(c.name);
    const bytes = readFileSync(join(root, c.file));
    if (digest(bytes) !== c.sha256) throw new Error(`Seed checksum mismatch: ${c.name}`);
    const documents = gunzipSync(bytes).toString('utf8').trim().split('\n').map(line => BSON.EJSON.parse(line, { relaxed: false }));
    if (documents.length !== c.count) throw new Error(`Seed count mismatch: ${c.name}`);
    return { ...c, documents, indexes: BSON.EJSON.deserialize(c.indexes) };
  });
  return { collections, sha256: digest(raw) };
}
export async function restoreSeed(client, seed) {
  const db = client.db(DATABASE);
  const state = client.db('demo_deployment_state').collection('source_restores');
  const existing = await db.listCollections({}, { nameOnly: true }).toArray();
  const marker = await state.findOne({ _id: DATABASE });
  if (existing.length) {
    if (marker?.sha256 === seed.sha256 && marker.status === 'complete' && seed.collections.every(c => existing.some(e => e.name === c.name))) return 'already-restored';
    throw new Error('Source is not empty or restore is incomplete; refusing overwrite');
  }
  // Record intent before writing: failures are not silently retried over partial data.
  await state.updateOne({ _id: DATABASE }, { $set: { sha256: seed.sha256, status: 'restoring' } }, { upsert: true });
  for (const c of seed.collections) {
    await db.createCollection(c.name);
    for (let i = 0; i < c.documents.length; i += 500) await db.collection(c.name).insertMany(c.documents.slice(i, i + 500), { ordered: true });
    if (c.indexes.length) await db.collection(c.name).createIndexes(c.indexes);
    if (await db.collection(c.name).countDocuments({}) !== c.count) throw new Error(`Restore count mismatch: ${c.name}`);
  }
  await state.updateOne({ _id: DATABASE }, { $set: { status: 'complete', restoredAt: new Date() } });
  return 'restored';
}
async function main() {
  const mode = process.argv[2];
  if (mode === 'prepare') {
    const manifest = await prepareSeed(resolve(process.argv[3] || 'secrets/mongo-source'), resolve(process.argv[4] || 'seed/demo'));
    console.log(`Prepared ${manifest.collections.length} anonymized collections`);
  } else if (mode === 'check' || mode === 'restore') {
    const seed = loadSeed(resolve(process.env.SOURCE_RESTORE_BACKUP_DIR || 'seed/demo'));
    if (mode === 'restore') {
      const client = new MongoClient(process.env.SOURCE_RESTORE_URI, { serverSelectionTimeoutMS: 10000 });
      if (client.options.dbName !== DATABASE) throw new Error('Wrong source database');
      try { await client.connect(); console.log(await restoreSeed(client, seed)); } finally { await client.close(); }
    }
    console.log(`Verified ${seed.collections.length} collections`);
  } else throw new Error('Use prepare, check or restore');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('Demo seed operation failed; check inputs, connectivity and empty-source requirement. Credentials are not printed.'); process.exitCode = 1; });
