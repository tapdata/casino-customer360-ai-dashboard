import { MongoClient } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuditEvent = Record<string, unknown>;

let clientPromise: Promise<MongoClient> | null = null;

function auditBridgeUrl() {
  const configuredUrl = process.env.MONGO_AUDIT_HTTP_URL?.replace(/\/$/, "");
  return configuredUrl || null;
}

function auditDbName() {
  return process.env.MONGO_AUDIT_DB || "ai_loyalty_engine";
}

function auditCollectionName() {
  return process.env.MONGO_AUDIT_COLLECTION || "ai_action_events";
}

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

function unconfiguredResponse() {
  return Response.json({
    ok: true,
    persisted: false,
    mode: "unconfigured",
    message: "Mongo audit persistence is not configured.",
  }, { status: 202 });
}

function bridgeOfflineResponse(error: unknown) {
  return Response.json({
    ok: true,
    persisted: false,
    mode: "bridge_offline",
    message: "Mongo audit bridge is not running.",
    error: error instanceof Error ? error.message : "Mongo audit bridge is not reachable",
  }, { status: 202 });
}

function mongoOfflineResponse(error: unknown) {
  return Response.json({
    ok: true,
    persisted: false,
    mode: "mongo_offline",
    message: "Mongo audit persistence is configured but not reachable.",
    error: error instanceof Error ? error.message : "MongoDB is not reachable",
  }, { status: 202 });
}

async function bridgeFetch(path: string, init?: RequestInit) {
  const baseUrl = auditBridgeUrl();
  if (!baseUrl) return null;
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers || {}),
    },
  });
}

async function mongoClient() {
  const uri = mongoUri();
  if (!uri) return null;
  clientPromise ??= MongoClient.connect(uri, {
    maxPoolSize: 5,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8_000,
  });
  return clientPromise;
}

async function auditCollection() {
  const client = await mongoClient();
  if (!client) return null;
  return client.db(auditDbName()).collection<AuditEvent>(auditCollectionName());
}

function normalizedEvent(event: AuditEvent) {
  return {
    ...event,
    createdAt: event.createdAt || new Date().toISOString(),
    source: event.source || "ai-panel",
  };
}

export async function POST(request: Request) {
  const body = await request.text();
  const bridgeUrl = auditBridgeUrl();
  if (bridgeUrl) {
    try {
      const response = await bridgeFetch("/events", {
        method: "POST",
        headers: { "content-type": request.headers.get("content-type") || "application/json" },
        body,
      });
      if (!response) return unconfiguredResponse();

      const text = await response.text();
      return new Response(text, {
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") || "application/json" },
      });
    } catch (error) {
      return bridgeOfflineResponse(error);
    }
  }

  try {
    const collection = await auditCollection();
    if (!collection) return unconfiguredResponse();
    const parsed = body ? JSON.parse(body) as AuditEvent : {};
    const event = normalizedEvent(parsed);
    const result = await collection.insertOne(event);
    return Response.json({
      ok: true,
      persisted: true,
      mode: "mongo",
      database: auditDbName(),
      collection: auditCollectionName(),
      insertedId: String(result.insertedId),
    });
  } catch (error) {
    return mongoOfflineResponse(error);
  }
}

export async function GET() {
  const bridgeUrl = auditBridgeUrl();
  if (bridgeUrl) {
    try {
      const response = await bridgeFetch("/events", { method: "GET" });
      if (!response) return unconfiguredResponse();

      const text = await response.text();
      return new Response(text, {
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") || "application/json" },
      });
    } catch (error) {
      return bridgeOfflineResponse(error);
    }
  }

  try {
    const collection = await auditCollection();
    if (!collection) return unconfiguredResponse();
    const data = await collection
      .find({}, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    return Response.json({
      ok: true,
      persisted: true,
      mode: "mongo",
      database: auditDbName(),
      collection: auditCollectionName(),
      data,
    });
  } catch (error) {
    return mongoOfflineResponse(error);
  }
}
