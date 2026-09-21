import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const packageFiles = [
  'tasks/TapData_CDC_Patron_Table_Sessions_To_MongoDB-20260915.json.gz',
  'apis/module_batch-20260915.json.gz',
];
const privateKeys = /^(?:.*password.*|.*secret.*|.*token.*|authorization|apiKey|accessKey|privateKey|username|user_id|userId|createUser|lastUpdBy|last_user_name|emailReceivers|accessNodeProcessId|accessNodeProcessIdList|agentTags|project)$/i;
const runtimeKeys = new Set(['syncPoints', 'metricInfo', 'alarmInfo', 'loadFieldErrMsg']);
const mongoPlaceholder = value => `mongodb://demo.invalid:27017/${String(value).includes('tapdata_casino_marketing') ? 'tapdata_casino_marketing' : 'marketing_mdm'}`;

export function sanitize(value, key = '') {
  if (privateKeys.test(key)) return Array.isArray(value) ? [] : '';
  if (runtimeKeys.has(key)) return Array.isArray(value) ? [] : {};
  if (/^(uri|database_uri)$/i.test(key)) return mongoPlaceholder(value);
  if (Array.isArray(value)) return value.map(item => sanitize(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  if (typeof value !== 'string') return value;
  // Some TapData exports store whole records as JSON strings.
  if (value.trimStart().startsWith('[') || value.trimStart().startsWith('{')) {
    try { return JSON.stringify(sanitize(JSON.parse(value))); } catch { /* normal text */ }
  }
  return value
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, mongoPlaceholder)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'demo@example.invalid')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'demo.invalid');
}

export function prepare(input, output) {
  const manifest = { format: 1, description: 'Sanitized demo templates; destination credentials are supplied at deployment.', packages: [] };
  for (const file of packageFiles) {
    const records = JSON.parse(gunzipSync(readFileSync(resolve(input, file))));
    const cleaned = sanitize(records);
    const counts = {};
    for (const record of cleaned) {
      const body = JSON.parse(record.json);
      if (record.collectionName === 'Task') {
        body.status = 'edit';
        body.accessNodeType = 'AUTOMATIC_PLATFORM_ALLOCATION';
      }
      if (record.collectionName === 'Connections') {
        const uri = `mongodb://demo.invalid:27017/${body.name === 'MongoDB_Source' ? 'tapdata_casino_marketing' : 'marketing_mdm'}`;
        body.database_uri = uri;
        body.config.uri = uri;
      }
      record.json = JSON.stringify(body);
      counts[record.collectionName] = (counts[record.collectionName] || 0) + 1;
    }
    const bytes = gzipSync(JSON.stringify(cleaned));
    const target = resolve(output, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    manifest.packages.push({ file, sha256: createHash('sha256').update(bytes).digest('hex'), records: counts });
  }
  writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifest = prepare(resolve(process.argv[2] || 'deploy/tapdata/exports'), resolve(process.argv[3] || 'deploy/tapdata/templates'));
  console.log(`Prepared ${manifest.packages.length} sanitized packages; original exports unchanged.`);
}
