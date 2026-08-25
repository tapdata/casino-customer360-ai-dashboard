import { spawn } from "node:child_process";
import { resolve } from "node:path";

try {
  process.loadEnvFile(resolve(".env.local"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const relayPort = Number(process.env.LOCAL_AI_RELAY_PORT || 8789);
const auditPort = Number(process.env.LOCAL_AUDIT_RELAY_PORT || 8790);
const localProxy = process.env.LOCAL_AI_PROXY?.trim();
const mongoAuditConfigured = Boolean(process.env.MONGO_AUDIT_URI || (process.env.MONGO_AUDIT_HOST && process.env.MONGO_AUDIT_USER && process.env.MONGO_AUDIT_PASSWORD));
const childEnv = { ...process.env };
let relay = null;
let auditBridge = null;

if (localProxy) {
  const noProxy = [process.env.NO_PROXY, "127.0.0.1", "localhost", "::1"]
    .filter(Boolean)
    .join(",");
  relay = spawn(process.execPath, [resolve("scripts/openai-relay.mjs")], {
    env: {
      ...childEnv,
      NODE_USE_ENV_PROXY: "1",
      HTTPS_PROXY: localProxy,
      HTTP_PROXY: localProxy,
      NO_PROXY: noProxy,
      LOCAL_AI_RELAY_PORT: String(relayPort),
    },
    stdio: "inherit",
  });
  childEnv.AI_BASE_URL = `http://127.0.0.1:${relayPort}/v1`;
}

if (mongoAuditConfigured) {
  auditBridge = spawn(process.execPath, [resolve("scripts/mongo-audit-bridge.mjs")], {
    env: {
      ...childEnv,
      LOCAL_AUDIT_RELAY_PORT: String(auditPort),
    },
    stdio: "inherit",
  });
  childEnv.MONGO_AUDIT_HTTP_URL = `http://127.0.0.1:${auditPort}`;
}

const vinext = spawn(
  process.execPath,
  [resolve("node_modules/vinext/dist/cli.js"), "dev", ...process.argv.slice(2)],
  { env: childEnv, stdio: "inherit" },
);

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  if (!vinext.killed) vinext.kill(signal);
  if (relay && !relay.killed) relay.kill(signal);
  if (auditBridge && !auditBridge.killed) auditBridge.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}

vinext.on("exit", (code, signal) => {
  if (relay && !relay.killed) relay.kill("SIGTERM");
  if (auditBridge && !auditBridge.killed) auditBridge.kill("SIGTERM");
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

relay?.on("exit", (code) => {
  if (!stopping && code !== 0) {
    console.error("Local OpenAI relay stopped unexpectedly.");
    if (!vinext.killed) vinext.kill("SIGTERM");
  }
});

auditBridge?.on("exit", (code) => {
  if (!stopping && code !== 0) {
    console.error("Local Mongo audit bridge stopped unexpectedly.");
    if (!vinext.killed) vinext.kill("SIGTERM");
  }
});
