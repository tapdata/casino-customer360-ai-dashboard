import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const base = {
  TAPDATA_IMPORT_API_BASE_URL: 'http://127.0.0.1:1',
  TAPDATA_API_BASE_URL: 'http://127.0.0.1:1',
  TAPDATA_IMPORT_SOURCE_MONGODB_URI: 'mongodb://user:DO_NOT_PRINT@localhost/tapdata_casino_marketing',
  MONGO_AUDIT_URI: 'mongodb://localhost/marketing_demo',
  AI_PANEL_PUBLIC_HOST: 'demo.example.com',
  TAPDATA_IMPORT_TOKEN: 'DO_NOT_PRINT', TAPDATA_ACCESS_TOKEN: 'DO_NOT_PRINT',
  DEEPSEEK_API_KEY: 'DO_NOT_PRINT',
};
function invoke(overrides) {
  const dir = mkdtempSync(join(tmpdir(), 'external-demo-test-'));
  try {
    const file = join(dir, '.env');
    writeFileSync(file, Object.entries({ ...base, ...overrides }).map(([key, value]) => `${key}=${value}`).join('\n'));
    const result = spawnSync(process.execPath, [resolve('scripts/external-demo.mjs'), file, 'check'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /DO_NOT_PRINT/);
    return result.stderr;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('rejects invalid configured panel ports before network or remote writes', () => {
  for (const port of ['0', '80', '65536', '3000oops']) assert.match(invoke({ AI_PANEL_PORT: port }), /AI_PANEL_PORT/);
});
test('requires separate published API credentials before deployment', () => {
  assert.match(invoke({ TAPDATA_ACCESS_TOKEN: '' }), /published API authentication/);
});
test('rejects a URL supplied where the public hostname is required', () => {
  assert.match(invoke({ AI_PANEL_PUBLIC_HOST: 'https://demo.example.com' }), /AI_PANEL_PUBLIC_HOST/);
});
test('requires AI provider configuration without exposing other credentials', () => {
  assert.match(invoke({ DEEPSEEK_API_KEY: '' }), /API key/);
});
