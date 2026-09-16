import { MongoClient } from "mongodb";

export const DEFAULT_TAPDATA_FIND_PATH_TEMPLATE = "/api/v1/{collection}/find";

export type TapDataConfig = {
  baseUrl: string;
  accessToken?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  tokenAuthMethod: "client_secret_post" | "client_secret_basic";
  findPathTemplate: string;
};

type CachedConfig = {
  key: string;
  value: TapDataConfig | null;
  loadedAt: number;
};

let cachedConfig: CachedConfig | null = null;
let inFlightConfig: { key: string; promise: Promise<TapDataConfig | null> } | null = null;

function textEnv(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(textEnv(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseFilter() {
  const raw = textEnv("TAPDATA_METADATA_FILTER_JSON");
  if (!raw) return { name: "Data Explorer" };
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { name: "Data Explorer" };
  } catch {
    return { name: "Data Explorer" };
  }
}

function pathValue(value: unknown, path: string) {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

function configKey() {
  // The key is only used to invalidate the in-process cache when environment
  // variables change during local development. It is never logged or returned.
  return [
    textEnv("TAPDATA_API_BASE_URL") || "",
    textEnv("TAPDATA_ACCESS_TOKEN") || "",
    textEnv("TAPDATA_TOKEN_URL") || "",
    textEnv("TAPDATA_CLIENT_ID") || "",
    textEnv("TAPDATA_CLIENT_SECRET") || "",
    textEnv("TAPDATA_METADATA_URI") || textEnv("TAPDATA_MONGO_URI") || "",
    textEnv("TAPDATA_METADATA_DB") || "tapdata",
    textEnv("TAPDATA_METADATA_COLLECTION") || "Application",
    textEnv("TAPDATA_METADATA_FILTER_JSON") || '{"name":"Data Explorer"}',
    textEnv("TAPDATA_METADATA_CLIENT_ID_PATH") || "clientId",
    textEnv("TAPDATA_METADATA_CLIENT_SECRET_PATH") || "clientSecret",
    textEnv("TAPDATA_TOKEN_AUTH_METHOD") || "client_secret_post",
    textEnv("TAPDATA_FIND_PATH_TEMPLATE") || DEFAULT_TAPDATA_FIND_PATH_TEMPLATE,
  ].join("\u0000");
}

function buildConfig(clientId?: string, clientSecret?: string): TapDataConfig | null {
  const baseUrl = textEnv("TAPDATA_API_BASE_URL")?.replace(/\/$/, "");
  const accessToken = textEnv("TAPDATA_ACCESS_TOKEN");
  const tokenUrl = textEnv("TAPDATA_TOKEN_URL");
  if (!baseUrl) return null;
  if (!accessToken && !(tokenUrl && clientId && clientSecret)) return null;
  return {
    baseUrl,
    accessToken,
    tokenUrl,
    clientId,
    clientSecret,
    tokenAuthMethod: textEnv("TAPDATA_TOKEN_AUTH_METHOD") === "client_secret_basic" ? "client_secret_basic" : "client_secret_post",
    findPathTemplate: textEnv("TAPDATA_FIND_PATH_TEMPLATE") || DEFAULT_TAPDATA_FIND_PATH_TEMPLATE,
  };
}

async function discoverConfig(): Promise<TapDataConfig | null> {
  const direct = buildConfig(textEnv("TAPDATA_CLIENT_ID"), textEnv("TAPDATA_CLIENT_SECRET"));
  if (direct) return direct;

  // TapData stores the OAuth client used by its API explorer in the
  // tapdata.Application document named "Data Explorer". The URI can point to
  // an external TapData metadata MongoDB or, in the Docker kit, the bundled
  // Mongo service used by TapData.
  const metadataUri = textEnv("TAPDATA_METADATA_URI") || textEnv("TAPDATA_MONGO_URI");
  const tokenUrl = textEnv("TAPDATA_TOKEN_URL");
  if (!metadataUri || !tokenUrl) return null;

  const dbName = textEnv("TAPDATA_METADATA_DB") || "tapdata";
  const collectionName = textEnv("TAPDATA_METADATA_COLLECTION") || "Application";
  const clientIdPath = textEnv("TAPDATA_METADATA_CLIENT_ID_PATH") || "clientId";
  const clientSecretPath = textEnv("TAPDATA_METADATA_CLIENT_SECRET_PATH") || "clientSecret";
  const timeoutMs = numberEnv("TAPDATA_METADATA_TIMEOUT_MS", 3_000);
  const filter = parseFilter();
  const projection = { [clientIdPath]: 1, [clientSecretPath]: 1 };
  let client: MongoClient | undefined;
  try {
    client = new MongoClient(metadataUri, {
      connectTimeoutMS: timeoutMs,
      socketTimeoutMS: timeoutMs,
      serverSelectionTimeoutMS: timeoutMs,
      maxPoolSize: 1,
      minPoolSize: 0,
    });
    await client.connect();
    const document = await client.db(dbName).collection(collectionName).findOne(filter, { projection, maxTimeMS: timeoutMs });
    const clientId = pathValue(document, clientIdPath);
    const clientSecret = pathValue(document, clientSecretPath);
    if (
      typeof clientId !== "string" || !clientId.trim() ||
      typeof clientSecret !== "string" || !clientSecret.trim()
    ) return null;
    return buildConfig(clientId.trim(), clientSecret.trim());
  } catch {
    // A missing/unreachable metadata database should not break the dashboard;
    // callers can use the existing demo fallback or return a normal config
    // error. Never include the URI or credential values in an error message.
    return null;
  } finally {
    await client?.close().catch(() => undefined);
  }
}

/**
 * Resolve TapData credentials server-side. Explicit env credentials take
 * precedence; otherwise discover them from tapdata.Application and cache the
 * result briefly to avoid querying metadata on every dashboard refresh.
 */
export async function getTapDataConfig(): Promise<TapDataConfig | null> {
  const key = configKey();
  const cacheTtlMs = numberEnv("TAPDATA_METADATA_CACHE_TTL_MS", 300_000);
  const now = Date.now();
  if (cachedConfig?.key === key && now - cachedConfig.loadedAt < cacheTtlMs) return cachedConfig.value;
  if (inFlightConfig?.key === key) return inFlightConfig.promise;

  const promise = discoverConfig().then((value) => {
    cachedConfig = { key, value, loadedAt: Date.now() };
    return value;
  }).finally(() => {
    if (inFlightConfig?.key === key) inFlightConfig = null;
  });
  inFlightConfig = { key, promise };
  return promise;
}
