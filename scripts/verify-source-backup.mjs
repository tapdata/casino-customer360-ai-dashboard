import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verifyBackup(root) {
  const database = 'tapdata_casino_marketing';
  const expected = readFileSync(join(root, 'archive.sha256'), 'utf8').trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Invalid archive checksum file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(root, `${database}.archive.gz`))) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw new Error('Archive checksum mismatch');
  const manifest = JSON.parse(readFileSync(join(root, 'restore-manifest.json'), 'utf8'));
  if (manifest.database !== database || manifest.sha256 !== expected || !Array.isArray(manifest.collections) || !manifest.collections.length || manifest.collections.some(c => typeof c.name !== 'string' || !Number.isSafeInteger(c.count) || c.count < 0)) {
    throw new Error('Invalid restore manifest');
  }
  return { database, sha256: expected, collections: manifest.collections.length, documents: manifest.collections.reduce((sum, c) => sum + c.count, 0), writesEnabled: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  verifyBackup(resolve(process.argv[2] || 'secrets/mongo-source'))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(() => { console.error('Backup preparation failed: provide the private archive, archive.sha256 and restore-manifest.json in secrets/mongo-source'); process.exitCode = 1; });
}
