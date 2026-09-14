import { MongoClient } from "mongodb";

const env = process.env;
const uri = env.MONGO_BOOTSTRAP_URI || env.MONGO_AUDIT_URI;
const databaseName = env.MONGO_BOOTSTRAP_DB || env.MONGO_AUDIT_DB || "ai_loyalty_engine";
const configCollection = env.MONGO_BOOTSTRAP_COLLECTION || "tapdata_runtime_config";

if (!uri) {
  throw new Error("MONGO_BOOTSTRAP_URI (or MONGO_AUDIT_URI) is required");
}

const tapdata = {
  image: env.TAPDATA_IMAGE || null,
  apiBaseUrl: env.TAPDATA_API_BASE_URL || null,
  tokenUrl: env.TAPDATA_TOKEN_URL || null,
  findPathTemplate: env.TAPDATA_FIND_PATH_TEMPLATE || null,
  tokenAuthMethod: env.TAPDATA_TOKEN_AUTH_METHOD || "client_secret_post",
  collectionMap: env.TAPDATA_COLLECTION_MAP || null,
  exportRoot: env.TAPDATA_EXPORT_ROOT || "/opt/tapdata-demo/exports",
  credentialsPresent: Boolean(env.TAPDATA_CLIENT_ID && env.TAPDATA_CLIENT_SECRET),
  accessTokenPresent: Boolean(env.TAPDATA_ACCESS_TOKEN),
};

// Never persist credentials by default. This flag exists for a controlled,
// private installation where the operator explicitly chooses to do so.
if (env.TAPDATA_STORE_CREDENTIALS === "true") {
  tapdata.clientId = env.TAPDATA_CLIENT_ID || null;
  tapdata.clientSecret = env.TAPDATA_CLIENT_SECRET || null;
  tapdata.accessToken = env.TAPDATA_ACCESS_TOKEN || null;
}

const now = new Date();
const payload = {
  _id: "default",
  updatedAt: now,
  createdBy: "docker-bootstrap",
  tapdata,
  exports: { mountedReadOnly: true },
};

let lastError;
for (let attempt = 1; attempt <= 30; attempt += 1) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    const db = client.db(databaseName);
    await db.collection(configCollection).updateOne(
      { _id: payload._id },
      { $set: payload, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
    await db.collection(configCollection).createIndex({ updatedAt: -1 });
    console.log(JSON.stringify({ ok: true, database: databaseName, collection: configCollection }));
    await client.close();
    process.exit(0);
  } catch (error) {
    lastError = error;
    await client.close().catch(() => {});
    if (attempt < 30) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

throw new Error(`Mongo bootstrap failed after 30 attempts: ${lastError?.message || "unknown error"}`);
