import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

export function envText(config) {
  return Object.entries(config).map(([key, value]) => {
    const text = String(value);
    if (/[\r\n]/.test(text)) throw new Error(`Invalid multiline value: ${key}`);
    const quote = !text.includes("'") ? "'" : !text.includes('"') ? '"' : null;
    if (!quote) throw new Error(`Use URI encoding for quotes in ${key}`);
    return `${key}=${quote}${text}${quote}`;
  }).join('\n') + '\n';
}
export function mongoDatabase(uri, database) {
  if (!/^mongodb(?:\+srv)?:\/\/[^/]+\/[^?]*(?:\?.*)?$/.test(uri)) throw new Error('MongoDB URI must include a database path');
  return uri.replace(/^(mongodb(?:\+srv)?:\/\/[^/]+\/)[^?]*/, `$1${database}`);
}
async function main() {
  const file = resolve(process.argv[2] || '.env.external');
  if (existsSync(file)) { chmodSync(file, 0o600); console.log('Using existing private configuration'); return; }
  if (!process.stdin.isTTY) throw new Error('First run requires an interactive terminal, or prepare .env.external first');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const config = parseEnv(readFileSync(new URL('../.env.external.example', import.meta.url), 'utf8'));
  async function ask(label, fallback = '', secret = false, validate = () => true) {
    for (;;) {
      process.stdout.write(`${label}${fallback ? (secret ? ' [回车使用同一 MongoDB 服务器]' : ` [${fallback}]`) : ''}: `);
      muted = secret;
      let answer;
      try { answer = (await rl.question('')).trim() || fallback; }
      finally { muted = false; if (secret) process.stdout.write('\n'); }
      if (answer && validate(answer)) return answer;
      console.log('输入无效，请重新填写。');
    }
  }
  const http = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } };
  const mongo = value => { try { mongoDatabase(value, 'test'); return true; } catch { return false; } };
  try {
    console.log('首次配置：凭据输入不回显，仅保存到本机权限为 0600 的配置文件。');
    config.TAPDATA_IMPORT_API_BASE_URL = await ask('TapData 管理端 URL', '', false, http);
    const api = new URL(config.TAPDATA_IMPORT_API_BASE_URL); api.port = '3080';
    config.TAPDATA_API_BASE_URL = await ask('TapData API Server URL', api.origin, false, http);
    config.TAPDATA_IMPORT_TOKEN = await ask('管理端 access token', '', true);
    const auth = await ask('API 认证方式：token 或 oauth', 'token', false, v => ['token', 'oauth'].includes(v));
    if (auth === 'token') {
      config.TAPDATA_ACCESS_TOKEN = await ask('已发布 API 的 access token', '', true);
      config.TAPDATA_TOKEN_URL = '';
    } else {
      config.TAPDATA_TOKEN_URL = await ask('OAuth token URL', new URL('/oauth/token', config.TAPDATA_IMPORT_API_BASE_URL).href, false, http);
      config.TAPDATA_CLIENT_ID = await ask('OAuth client ID');
      config.TAPDATA_CLIENT_SECRET = await ask('OAuth client secret', '', true);
    }
    config.TAPDATA_IMPORT_SOURCE_MONGODB_URI = mongoDatabase(await ask('源 MongoDB 完整 URI（含认证与副本集参数）', '', true, mongo), 'tapdata_casino_marketing');
    config.MONGO_AUDIT_URI = mongoDatabase(await ask('面板状态 MongoDB URI', mongoDatabase(config.TAPDATA_IMPORT_SOURCE_MONGODB_URI, 'marketing_demo'), true, mongo), 'marketing_demo');
    config.AI_PANEL_PUBLIC_HOST = await ask('面板服务器 IP 或域名', '', false, v => /^[a-zA-Z0-9.-]+$/.test(v));
    config.AI_PANEL_PORT = await ask('面板端口', '3000', false, v => /^\d+$/.test(v) && Number(v) >= 1024 && Number(v) <= 65535);
    config.AI_PROVIDER = await ask('AI 提供商：deepseek 或 openai', 'deepseek', false, v => ['deepseek', 'openai'].includes(v));
    config.AI_MODEL = await ask('模型名称', config.AI_PROVIDER === 'deepseek' ? 'deepseek-chat' : 'gpt-4.1-mini');
    config.AI_BASE_URL = await ask('AI API Base URL', config.AI_PROVIDER === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com', false, http);
    config[config.AI_PROVIDER === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY'] = await ask('AI API key', '', true);
    writeFileSync(file, envText(config), { mode: 0o600, flag: 'wx' });
    console.log('配置已保存，继续自动安装。');
  } finally { rl.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('Configuration failed; existing configuration was not overwritten.'); process.exitCode = 1; });
