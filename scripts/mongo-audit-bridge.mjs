import { createServer } from "node:http";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";

try {
  process.loadEnvFile(resolve(".env.local"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const host = "127.0.0.1";
const port = Number(process.env.LOCAL_AUDIT_RELAY_PORT || 8790);
const dbName = process.env.MONGO_AUDIT_DB || "ai_loyalty_engine";
const collectionName = process.env.MONGO_AUDIT_COLLECTION || "ai_action_events";

let client = null;
let ensuredIndexes = false;

function mongoUri() {
  if (process.env.MONGO_AUDIT_URI) return process.env.MONGO_AUDIT_URI;
  const mongoHost = process.env.MONGO_AUDIT_HOST;
  const user = process.env.MONGO_AUDIT_USER;
  const password = process.env.MONGO_AUDIT_PASSWORD;
  const authDb = process.env.MONGO_AUDIT_AUTH_DB || "admin";
  const authMechanism = process.env.MONGO_AUDIT_AUTH_MECHANISM || "SCRAM-SHA-256";
  if (!mongoHost || !user || !password) return null;
  return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${mongoHost}/?authSource=${encodeURIComponent(authDb)}&authMechanism=${encodeURIComponent(authMechanism)}&directConnection=true`;
}

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sanitizePayload(payload) {
  const allowed = new Set([
    "risk_alert_sent",
    "risk_alert_closed",
    "recommendation_approved",
    "recommendation_rejected",
    "recommendation_sent",
  ]);
  const actionType = payload?.actionType;
  if (!allowed.has(actionType)) throw new Error("Unsupported audit action");

  const now = new Date().toISOString();
  return {
    eventId: `AUD-${now.replace(/\D/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    actionType,
    source: "ai-panel",
    scenarioId: text(payload.scenarioId, "unknown"),
    patronId: text(payload.patronId, "unknown"),
    maskedName: text(payload.maskedName),
    tableId: text(payload.tableId),
    reportId: text(payload.reportId),
    alertLevel: text(payload.alertLevel),
    channel: text(payload.channel, "WhatsApp"),
    recipient: text(payload.recipient),
    message: text(payload.message),
    status: text(payload.status, actionType === "risk_alert_closed" ? "closed" : "sent"),
    closeReason: text(payload.closeReason),
    metadata: payload?.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata) ? payload.metadata : {},
    createdAt: now,
  };
}

async function targetCollection() {
  const uri = mongoUri();
  if (!uri) return null;
  if (!client) {
    client = new MongoClient(uri, {
      appName: "ai-loyalty-engine-local-audit",
      connectTimeoutMS: 8_000,
      serverSelectionTimeoutMS: 8_000,
    });
    await client.connect();
  }

  const target = client.db(dbName).collection(collectionName);
  if (!ensuredIndexes) {
    await Promise.all([
      target.createIndex({ eventId: 1 }, { unique: true }),
      target.createIndex({ patronId: 1, createdAt: -1 }),
      target.createIndex({ scenarioId: 1, createdAt: -1 }),
      target.createIndex({ actionType: 1, createdAt: -1 }),
    ]);
    ensuredIndexes = true;
  }
  return target;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    if (url.pathname === "/health") {
      const target = await targetCollection();
      return json(response, target ? 200 : 202, { ok: true, persisted: Boolean(target), mode: target ? "mongo" : "unconfigured" });
    }

    if (url.pathname !== "/events") return json(response, 404, { ok: false, error: "Not found" });

    const target = await targetCollection();
    if (!target) {
      return json(response, 202, {
        ok: true,
        persisted: false,
        mode: "unconfigured",
        message: "Mongo audit persistence is not configured.",
      });
    }

    if (request.method === "GET") {
      const data = await target.find({}, {
        projection: { _id: 0 },
        sort: { createdAt: -1 },
        limit: 20,
      }).toArray();
      return json(response, 200, { ok: true, persisted: true, mode: "mongo", database: dbName, collection: collectionName, data });
    }

    if (request.method === "POST") {
      const raw = await readBody(request);
      const record = sanitizePayload(raw ? JSON.parse(raw) : {});
      await target.insertOne(record);
      return json(response, 200, {
        ok: true,
        persisted: true,
        mode: "mongo",
        database: dbName,
        collection: collectionName,
        eventId: record.eventId,
        createdAt: record.createdAt,
      });
    }

    return json(response, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    return json(response, 500, {
      ok: false,
      persisted: false,
      error: error instanceof Error ? error.message : "Mongo audit bridge failed",
    });
  }
});

server.listen(port, host, () => {
  console.log(`Local Mongo audit bridge ready on http://${host}:${port}`);
});

// Audit persistence is optional for local development. A stale bridge or
// another local tool may already own the configured port; do not let that
// prevent the read-only AI panel from starting.
server.on("error", (error) => {
  if (["EADDRINUSE", "EPERM", "EACCES"].includes(error?.code)) {
    console.error(`Local Mongo audit bridge unavailable (${error.code}) on port ${port}; continuing without local persistence.`);
    process.exit(0);
  }
  console.error("Local Mongo audit bridge failed to start.", error);
  process.exit(1);
});

function stop() {
  server.close();
  void client?.close();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stop();
    process.exit(0);
  });
}
