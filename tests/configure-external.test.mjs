import test from 'node:test';
import assert from 'node:assert/strict';
import { envText, mongoDatabase, wizardDefaults } from '../scripts/configure-external.mjs';

test('configuration wizard supplies local TapData, MongoDB, panel and AI defaults', () => {
  const defaults = wizardDefaults();
  assert.equal(defaults.tapdataManagerUrl, 'http://127.0.0.1:3030');
  assert.equal(defaults.tapdataApiUrl, 'http://127.0.0.1:3080');
  assert.match(defaults.sourceMongoUri, /tapdata_casino_marketing\?replicaSet=rs1$/);
  assert.equal(defaults.panelPort, '3000');
  assert.equal(defaults.aiProvider, 'deepseek');
});

test('deployment host overrides make Enter useful on a separate TapData server', () => {
  const defaults = wizardDefaults({ DEMO_TAPDATA_HOST: 'tapdata.example.internal', DEMO_MONGO_HOST: 'mongo.example.internal', DEMO_PUBLIC_HOST: 'demo.example.internal' });
  assert.equal(defaults.tapdataManagerUrl, 'http://tapdata.example.internal:3030');
  assert.equal(defaults.tapdataApiUrl, 'http://tapdata.example.internal:3080');
  assert.match(defaults.sourceMongoUri, /^mongodb:\/\/mongo\.example\.internal:27017/);
  assert.equal(defaults.publicHost, 'demo.example.internal');
});

test('configuration writer preserves private values in shell-compatible quoted env', () => {
  const text = envText({ TOKEN: 'value with spaces', URI: 'mongodb://user:p%40ss@host/db' });
  assert.match(text, /TOKEN='value with spaces'/);
  assert.match(text, /URI='mongodb:\/\/user:p%40ss@host\/db'/);
  assert.equal(mongoDatabase('mongodb://host/source?replicaSet=rs1', 'marketing_demo'), 'mongodb://host/marketing_demo?replicaSet=rs1');
});
