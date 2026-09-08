import { MongoClient } from "mongodb";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { tapDataCollectionLabel, tapDataCollectionUrl } from "../../tapdata-collections";

type JsonRecord = Record<string, unknown>;

// Keep the published API path configurable (the current deployment uses v1;
// a future MDM gateway can switch versions without rebuilding the app).
const DEFAULT_TAPDATA_FIND_PATH_TEMPLATE = "/api/v1/{collection}/find";

// Run this data-heavy function close to the TapData gateway when the selected
// Vercel plan supports regional functions. It avoids routing every refresh
// through the default iad1 region before reaching the Macau data endpoint.
export const preferredRegion = "hkg1";
export const maxDuration = 20;

type TapDataConfig = {
  baseUrl: string;
  accessToken?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  tokenAuthMethod: "client_secret_post" | "client_secret_basic";
  findPathTemplate: string;
};

type LivePatron = {
  patronId: string;
  maskedName: string;
  tier: string;
  region: string;
  adt: number;
  pointsBalance: number;
  preferredGames: string[];
  riskFlags: string[];
  lastActiveAt: string | null;
  lastHotelBenefitAt: string | null;
  activeSession: {
    tableId: string;
    seatedAt: string | null;
    lastActionAt: string | null;
    sessionBetAmount: number;
    currentStackEstimate: number;
    behaviorTags: string[];
    isActive: boolean;
  } | null;
  activeRiskCount: number;
};

type PageResult = {
  collection: string;
  records: JsonRecord[];
  count: number;
  error?: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;
type LoadPatronsResult = {
  value: LivePatron[];
  sourceCounts: {
    patron_profiles: number;
    patron_table_sessions: number;
    patron_risk_cases: number;
    offer_recommendations: number;
    chat_messages: number;
  };
  errors: Array<{ collection: string; message: string }>;
  partial?: boolean;
};

type PatronCache = {
  result: LoadPatronsResult;
  loadedAt: number;
  complete: boolean;
  version?: number;
};

let cachedLoad: PatronCache | null = null;
let inFlightLoad: Promise<LoadPatronsResult> | null = null;
let snapshotClientPromise: Promise<MongoClient> | null = null;

function positiveEnvMs(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Keep the panel responsive while TapData refreshes a large snapshot. */
const patronCacheFreshMs = () => positiveEnvMs("PATRONS_CACHE_FRESH_MS", 3_000);

function snapshotMongoUri() {
  if (process.env.MONGO_SNAPSHOT_URI) return process.env.MONGO_SNAPSHOT_URI;
  if (process.env.MONGO_AUDIT_URI) return process.env.MONGO_AUDIT_URI;
  const host = process.env.MONGO_SNAPSHOT_HOST || process.env.MONGO_AUDIT_HOST;
  const user = process.env.MONGO_SNAPSHOT_USER || process.env.MONGO_AUDIT_USER;
  const password = process.env.MONGO_SNAPSHOT_PASSWORD || process.env.MONGO_AUDIT_PASSWORD;
  const authDb = process.env.MONGO_SNAPSHOT_AUTH_DB || process.env.MONGO_AUDIT_AUTH_DB || "admin";
  const mechanism = process.env.MONGO_SNAPSHOT_AUTH_MECHANISM || process.env.MONGO_AUDIT_AUTH_MECHANISM || "SCRAM-SHA-256";
  if (!host || !user || !password) return null;
  return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}/?authSource=${encodeURIComponent(authDb)}&authMechanism=${encodeURIComponent(mechanism)}&directConnection=true`;
}

function snapshotDbName() {
  return process.env.MONGO_SNAPSHOT_DB || process.env.MONGO_AUDIT_DB || "ai_loyalty_engine";
}

function snapshotCollectionName() {
  return process.env.MONGO_SNAPSHOT_COLLECTION || "live_patrons_snapshot";
}

async function snapshotCollection() {
  const uri = snapshotMongoUri();
  if (!uri) return null;
  try {
    snapshotClientPromise ??= MongoClient.connect(uri, {
      maxPoolSize: 3,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 3_000,
      connectTimeoutMS: 3_000,
    });
    const client = await snapshotClientPromise;
    return client.db(snapshotDbName()).collection<PatronCache & { _id?: string }>(snapshotCollectionName());
  } catch {
    snapshotClientPromise = null;
    return null;
  }
}

async function readPersistedSnapshot() {
  const collection = await snapshotCollection();
  if (!collection) return null;
  try {
    const document = await collection.findOne({ _id: "live" });
    if (!document || !document.result || !Array.isArray(document.result.value)) return null;
    // Ignore snapshots written by the pre-pagination loader when they contain
    // no sessions. They would otherwise keep the dashboard in a stale
    // "zero active patrons" state until a slow refresh eventually completes.
    if (document.complete === false) return null;
    if (Number(document.version || 0) < 2 && Number(document.result.sourceCounts?.patron_table_sessions || 0) === 0) return null;
    return {
      result: document.result,
      loadedAt: Number(document.loadedAt) || Date.now(),
      complete: Boolean(document.complete),
      version: Number(document.version) || 1,
    } satisfies PatronCache;
  } catch {
    return null;
  }
}

async function writePersistedSnapshot(cache: PatronCache) {
  const collection = await snapshotCollection();
  if (!collection) return;
  try {
    await collection.updateOne({ _id: "live" }, { $set: cache }, { upsert: true });
  } catch {
    // Persistent cache is an optimization; TapData remains the source of truth.
  }
}

function config(): TapDataConfig | null {
  const baseUrl = process.env.TAPDATA_API_BASE_URL?.replace(/\/$/, "");
  const accessToken = process.env.TAPDATA_ACCESS_TOKEN;
  const tokenUrl = process.env.TAPDATA_TOKEN_URL;
  const clientId = process.env.TAPDATA_CLIENT_ID;
  const clientSecret = process.env.TAPDATA_CLIENT_SECRET;
  if (!baseUrl || (!accessToken && !(tokenUrl && clientId && clientSecret))) return null;
  return {
    baseUrl,
    accessToken,
    tokenUrl,
    clientId,
    clientSecret,
    tokenAuthMethod: process.env.TAPDATA_TOKEN_AUTH_METHOD === "client_secret_basic" ? "client_secret_basic" : "client_secret_post",
    findPathTemplate: process.env.TAPDATA_FIND_PATH_TEMPLATE || DEFAULT_TAPDATA_FIND_PATH_TEMPLATE,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readTapDataJson(response: Response, timeoutMs: number, url: string) {
  const body = await (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        response.text(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`TapData response body timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    const contentType = response.headers.get("content-type") || "unknown";
    const preview = body.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`TapData returned non-JSON (${response.status}, ${contentType}) from ${url}: ${preview}`);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function recordsFromPayload(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  if (!payload || typeof payload !== "object") return [];
  const body = payload as JsonRecord;
  for (const key of ["data", "items", "documents", "records", "result"]) {
    if (Array.isArray(body[key])) return body[key].filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    if (body[key] && typeof body[key] === "object") {
      const nested = body[key] as JsonRecord;
      for (const nestedKey of ["data", "items", "documents", "records"]) {
        if (Array.isArray(nested[nestedKey])) return nested[nestedKey].filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
      }
    }
  }
  return [];
}

function countFromPayload(payload: unknown, fallback: number) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = Number((payload as JsonRecord).count);
  return Number.isFinite(value) ? value : fallback;
}

async function accessToken(current: TapDataConfig) {
  if (current.accessToken) return current.accessToken;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  if (!current.tokenUrl || !current.clientId || !current.clientSecret) throw new Error("TapData OAuth is not configured");

  const form = new URLSearchParams({ grant_type: "client_credentials" });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (current.tokenAuthMethod === "client_secret_basic") {
    headers.authorization = `Basic ${btoa(`${current.clientId}:${current.clientSecret}`)}`;
  } else {
    form.set("client_id", current.clientId);
    form.set("client_secret", current.clientSecret);
  }
  const response = await fetchWithTimeout(current.tokenUrl, { method: "POST", headers, body: form.toString() }, 8_000);
  if (!response.ok) throw new Error(`TapData token request failed (${response.status})`);
  const payload = await response.json() as JsonRecord;
  const nested = payload.data && typeof payload.data === "object" ? payload.data as JsonRecord : null;
  const value = payload.access_token ?? payload.accessToken ?? nested?.access_token ?? nested?.accessToken;
  const expiresIn = Number(payload.expires_in ?? payload.expiresIn ?? nested?.expires_in ?? nested?.expiresIn ?? 300);
  if (typeof value !== "string" || !value) throw new Error("TapData token response does not contain access_token");
  cachedToken = { value, expiresAt: Date.now() + Math.max(expiresIn, 60) * 1000 };
  return value;
}

function collectionUrl(current: TapDataConfig, collection: string) {
  return tapDataCollectionUrl(current.baseUrl, current.findPathTemplate, collection);
}

function collectionListUrl(current: TapDataConfig, collection: string, page: number, limit: number) {
  const findUrl = collectionUrl(current, collection);
  // TapData exposes the same published service as a fast paginated GET at the
  // collection root. Keep POST /find as a compatibility fallback for gateways
  // that only enable the query endpoint.
  const listUrl = findUrl.replace(/\/find\/?(?=$|\?)/i, "/");
  const url = new URL(listUrl);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

type FetchPageOptions = {
  requestTimeoutMs?: number;
  bodyTimeoutMs?: number;
};

async function fetchPage(current: TapDataConfig, token: string, collection: string, page: number, limit: number, options: FetchPageOptions = {}): Promise<PageResult> {
  const requestTimeoutMs = options.requestTimeoutMs ?? timeoutForCollection(collection);
  const bodyTimeoutMs = options.bodyTimeoutMs ?? bodyTimeoutForCollection(collection);
  const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
  const findUrl = collectionUrl(current, collection);
  // TapData's published /find endpoint is materially faster than the root
  // GET list endpoint for the same page size. Prefer it and retain GET as a
  // compatibility fallback for gateways that do not expose POST /find.
  let response = await fetchWithTimeout(findUrl, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ page, limit, filter: {} }),
  }, requestTimeoutMs);
  if (response.status === 404 || response.status === 405 || response.status === 415) {
    response = await fetchWithTimeout(collectionListUrl(current, collection, page, limit), {
      method: "GET",
      headers,
    }, requestTimeoutMs);
  }
  if (!response.ok) throw new Error(`TapData ${tapDataCollectionLabel(collection)} request failed (${response.status})`);
  const payload = await readTapDataJson(response, bodyTimeoutMs, response.url || findUrl);
  const records = recordsFromPayload(payload);
  return { collection, records, count: countFromPayload(payload, records.length) };
}

const coreCollections = ["patron_profiles", "patron_table_sessions", "patron_risk_cases"] as const;

/**
 * TapData becomes unreliable when a published endpoint is asked for 500+
 * records in one response. Read the complete configured range in predictable
 * 200-row pages instead. Pages are independent, so a single slow page can be
 * retried without discarding the other pages or the last good snapshot.
 */
async function fetchPagedCollection(current: TapDataConfig, token: string, collection: string, maxRecords: number): Promise<PageResult> {
  const pageSize = Math.min(Math.max(Number(process.env.TAPDATA_PAGE_SIZE) || 200, 50), 300);
  const first = await safeFetchPage(current, token, collection, 1, pageSize);
  if (first.error || first.records.length === 0) return first;

  const advertisedCount = Math.max(first.count, first.records.length);
  const targetCount = Math.min(maxRecords, advertisedCount);
  const pageCount = Math.ceil(targetCount / pageSize);
  if (pageCount <= 1) return { ...first, records: first.records.slice(0, targetCount) };

  const pages = await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) =>
    safeFetchPage(current, token, collection, index + 2, pageSize),
  ));
  const errors = pages.filter((page) => page.error).map((page) => page.error);
  return {
    collection,
    records: [first, ...pages].flatMap((page) => page.records).slice(0, targetCount),
    count: first.count,
    error: errors.length ? `page refresh failed: ${errors.join("; ")}` : undefined,
  };
}

function timeoutForCollection(collection: string) {
  const fallback = ["patron_profiles", "patron_table_sessions", "patron_risk_cases"].includes(collection) ? 15_000 : 6_000;
  return positiveEnvMs("TAPDATA_REQUEST_TIMEOUT_MS", fallback);
}

function bodyTimeoutForCollection(collection: string) {
  const fallback = ["patron_profiles", "patron_table_sessions", "patron_risk_cases"].includes(collection) ? 15_000 : 6_000;
  return positiveEnvMs("TAPDATA_BODY_TIMEOUT_MS", fallback);
}

async function safeFetchPage(current: TapDataConfig, token: string, collection: string, page: number, limit: number, options?: FetchPageOptions): Promise<PageResult> {
  try {
    return await fetchPage(current, token, collection, page, limit, options);
  } catch (error) {
    return {
      collection,
      records: [],
      count: 0,
      error: error instanceof Error ? error.message : `TapData ${collection} request failed`,
    };
  }
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value ? value : fallback;
}

function pick(record: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key];
  }
  return undefined;
}

function textField(record: JsonRecord, fallback: string, ...keys: string[]) {
  return text(pick(record, ...keys), fallback);
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function derivedTier(adt: number, fallback = "Unclassified") {
  if (fallback && fallback !== "Unclassified") return fallback;
  if (adt >= 50000) return "Diamond";
  if (adt >= 25000) return "Platinum";
  if (adt >= 10000) return "Gold";
  if (adt >= 3000) return "Silver";
  if (adt > 0) return "Bronze";
  return fallback;
}

function numberField(record: JsonRecord, ...keys: string[]) {
  return number(pick(record, ...keys));
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
    } catch { /* fall through to delimiter split */ }
    return value
      .replace(/[{}[\]"]/g, "")
      .split(/[,;,|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function stringArrayField(record: JsonRecord, ...keys: string[]) {
  return stringArray(pick(record, ...keys));
}

function nullableDate(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function dateField(record: JsonRecord, ...keys: string[]) {
  return nullableDate(pick(record, ...keys));
}

function boolField(record: JsonRecord, ...keys: string[]) {
  const value = pick(record, ...keys);
  return value === true || value === 1 || value === "1" || value === "true" || value === "TRUE" || value === "Y";
}

function sanitizeProfile(record: JsonRecord): Omit<LivePatron, "activeSession" | "activeRiskCount"> | null {
  const patronId = textField(record, "", "patronId", "patron_id", "PATRON_ID", "masterPlayerId", "master_player_id", "MASTER_PLAYER_ID", "playerId", "player_id", "PLAYER_ID", "_id");
  if (!patronId) return null;
  const adt = numberField(record, "adt", "ADT", "avgDailyTheoretical", "avg_daily_theoretical");
  const rawTier = textField(record, "Unclassified", "tier", "TIER", "vipTier", "vip_tier", "VIP_TIER", "rating", "RATING", "rating_name", "RATING_NAME");
  return {
    patronId,
    maskedName: textField(record, patronId.replace(/.(?=.{2})/g, "*"), "maskedName", "masked_name", "MASKED_NAME", "name", "NAME"),
    tier: derivedTier(adt, rawTier),
    region: textField(record, "—", "region", "REGION"),
    adt,
    pointsBalance: numberField(record, "pointsBalance", "points_balance", "POINTS_BALANCE"),
    preferredGames: stringArrayField(record, "preferredGames", "preferred_games", "PREFERRED_GAMES"),
    riskFlags: stringArrayField(record, "riskFlags", "risk_flags", "RISK_FLAGS"),
    lastActiveAt: dateField(record, "lastActiveAt", "last_active_at", "LAST_ACTIVE_AT", "updatedAt", "updated_at"),
    lastHotelBenefitAt: dateField(record, "lastHotelBenefitAt", "last_hotel_benefit_at", "LAST_HOTEL_BENEFIT_AT"),
  };
}

function sanitizeSession(record: JsonRecord) {
  const patronId = textField(record, "", "patronId", "patron_id", "PATRON_ID", "masterPlayerId", "master_player_id", "MASTER_PLAYER_ID", "playerId", "player_id", "PLAYER_ID");
  const isActive = boolField(record, "isActive", "is_active", "IS_ACTIVE", "active", "ACTIVE");
  if (!patronId || !isActive) return null;
  return {
    patronId,
    tableId: textField(record, "—", "tableId", "table_id", "TABLE_ID"),
    seatedAt: dateField(record, "seatedAt", "seated_at", "SEATED_AT"),
    lastActionAt: dateField(record, "lastActionAt", "last_action_at", "LAST_ACTION_AT", "updatedAt", "updated_at"),
    sessionBetAmount: numberField(record, "sessionBetAmount", "session_bet_amount", "SESSION_BET_HKD", "session_bet_hkd"),
    currentStackEstimate: numberField(record, "currentStackEstimate", "current_stack_estimate", "CURRENT_STACK_HKD", "current_stack_hkd"),
    behaviorTags: stringArrayField(record, "behaviorTags", "behavior_tags", "BEHAVIOR_TAGS"),
    isActive: true,
  };
}

function activeRisk(record: JsonRecord) {
  const status = textField(record, "", "status", "STATUS").toLocaleLowerCase();
  return ["active", "open", "awaitingadmin", "inreview", "new", "pending"].includes(status);
}

async function loadPatrons(requestedScanLimit?: number): Promise<LoadPatronsResult> {
  const current = config();
  if (!current) throw new Error("TapData is not configured");
  const token = await accessToken(current);
  const configuredScanLimit = Number(process.env.TAPDATA_SCAN_LIMIT) || 1000;
  const scanLimit = Math.min(Math.max(requestedScanLimit ?? configuredScanLimit, 50), 5000);
  const [profilePage, sessionPage, riskPage, recommendationPage, messagePage] = await Promise.all([
    // Customer 360 needs tier, region, preferences and host assignment for every
    // active patron. Keep embeddings out of patron_profiles or publish a slim API
    // projection so the panel can enrich the live session queue correctly.
    fetchPagedCollection(current, token, "patron_profiles", scanLimit),
    fetchPagedCollection(current, token, "patron_table_sessions", scanLimit),
    fetchPagedCollection(current, token, "patron_risk_cases", scanLimit),
    // These counts are informative only. Keep a slow or unavailable auxiliary
    // endpoint from holding up the customer snapshot on a cold start.
    safeFetchPage(current, token, "offer_recommendations", 1, 1, { requestTimeoutMs: 1_200, bodyTimeoutMs: 1_200 }),
    safeFetchPage(current, token, "chat_messages", 1, 1, { requestTimeoutMs: 1_200, bodyTimeoutMs: 1_200 }),
  ]);
  const profileByPatron = new Map<string, Omit<LivePatron, "activeSession" | "activeRiskCount">>();
  for (const profile of profilePage.records.map(sanitizeProfile).filter((item): item is NonNullable<typeof item> => Boolean(item))) {
    const currentProfile = profileByPatron.get(profile.patronId);
    if (!currentProfile
      || String(profile.lastActiveAt || "") > String(currentProfile.lastActiveAt || "")
      || profile.adt > currentProfile.adt) {
      profileByPatron.set(profile.patronId, profile);
    }
  }
  const profiles = {
    records: [...profileByPatron.values()],
    count: profilePage.count,
  };

  const sessions = sessionPage.records.map(sanitizeSession).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const sessionByPatron = new Map<string, (typeof sessions)[number]>();
  for (const session of sessions) {
    const currentSession = sessionByPatron.get(session.patronId);
    if (!currentSession || String(session.lastActionAt || "") > String(currentSession.lastActionAt || "")) {
      sessionByPatron.set(session.patronId, session);
    }
  }

  const riskCountByPatron = new Map<string, number>();
  for (const risk of riskPage.records) {
    const patronId = textField(risk, "", "patronId", "patron_id", "PATRON_ID", "masterPlayerId", "master_player_id", "MASTER_PLAYER_ID", "playerId", "player_id", "PLAYER_ID");
    if (patronId && activeRisk(risk)) riskCountByPatron.set(patronId, (riskCountByPatron.get(patronId) || 0) + 1);
  }

  const known = new Set(profiles.records.map((profile) => profile.patronId));
  const patrons: LivePatron[] = profiles.records.map((profile) => ({
    ...profile,
    activeSession: sessionByPatron.get(profile.patronId) || null,
    activeRiskCount: riskCountByPatron.get(profile.patronId) || 0,
  }));
  for (const session of sessionByPatron.values()) {
    if (known.has(session.patronId)) continue;
    patrons.push({
      patronId: session.patronId,
      maskedName: session.patronId.replace(/.(?=.{2})/g, "*"),
      tier: "Unclassified",
      region: "—",
      adt: 0,
      pointsBalance: 0,
      preferredGames: [],
      riskFlags: [],
      lastActiveAt: session.lastActionAt,
      lastHotelBenefitAt: null,
      activeSession: session,
      activeRiskCount: riskCountByPatron.get(session.patronId) || 0,
    });
    known.add(session.patronId);
  }
  patrons.sort((left, right) => {
    const activeDelta = Number(Boolean(right.activeSession)) - Number(Boolean(left.activeSession));
    return activeDelta || right.activeRiskCount - left.activeRiskCount || right.adt - left.adt || left.patronId.localeCompare(right.patronId);
  });

  const errors = [profilePage, sessionPage, riskPage, recommendationPage, messagePage]
    .filter((page) => page.error)
    .map((page) => ({ collection: page.collection, message: page.error! }));

  return {
    value: patrons,
    sourceCounts: {
      patron_profiles: profiles.count,
      patron_table_sessions: sessionPage.count,
      patron_risk_cases: riskPage.count,
      offer_recommendations: recommendationPage.count,
      chat_messages: messagePage.count,
    },
    errors,
    partial: scanLimit < Math.min(Math.max(configuredScanLimit, 50), 5000),
  };
}

async function cachedLoadPatrons() {
  const now = Date.now();
  const configuredScanLimit = Math.min(Math.max(Number(process.env.TAPDATA_SCAN_LIMIT) || 1000, 50), 5000);
  const startLoad = () => {
    if (inFlightLoad) return inFlightLoad;
    const loadPromise = withTimeout(
      loadPatrons(configuredScanLimit),
      positiveEnvMs("PATRONS_LOAD_TIMEOUT_MS", 18_000),
      "TapData patron snapshot timed out; retrying on the next refresh",
    )
      .then(async (result) => {
        // A transient upstream outage must not poison the in-memory cache with
        // an empty snapshot. Keep the last known-good data available so the
        // next request can render it while the shared refresh retries.
        const coreErrors = result.errors.filter((item) => coreCollections.includes(item.collection as typeof coreCollections[number]));
        if (coreErrors.length) {
          if (cachedLoad) {
            // A partial refresh must never replace a complete snapshot (for
            // example, profiles succeeded while sessions timed out).
            throw new Error(coreErrors.map((item) => item.message).join("; "));
          }
          // On a cold start, return the partial response to the caller but do
          // not cache it. The next request will retry the failed page rather
          // than persisting an incomplete Customer 360 snapshot.
          return { ...result, partial: true };
        }
        // A published endpoint can briefly return HTTP 200 with an empty
        // payload while TapData is still catching up. Never let that empty
        // response overwrite a known-good in-memory or Mongo snapshot.
        if (result.value.length === 0 && cachedLoad) {
          throw new Error("TapData returned an empty patron snapshot; retaining the last good snapshot");
        }
        const nextResult = { ...result, partial: false };
        cachedLoad = { result: nextResult, loadedAt: Date.now(), complete: true, version: 2 };
        await writePersistedSnapshot(cachedLoad);
        return nextResult;
      })
      .finally(() => {
        inFlightLoad = null;
      });
    inFlightLoad = loadPromise;
    return inFlightLoad;
  };

  const scheduleRefresh = () => {
    // Do not attach the refresh to the current request lifecycle. In a
    // long-running `next start` process, Next's `after()` can keep the chunked
    // response open until the upstream TapData refresh finishes or times out.
    // A detached timer lets the cached snapshot return immediately while the
    // shared in-flight load refreshes in the background.
    if (inFlightLoad) return;
    setTimeout(() => {
      void startLoad().catch(() => undefined);
    }, 0);
  };

  if (!cachedLoad) {
    const persisted = await readPersistedSnapshot();
    if (persisted) {
      cachedLoad = persisted;
      scheduleRefresh();
      return { result: persisted.result, cacheState: "persisted" as const, loadedAt: persisted.loadedAt };
    }
    const result = await startLoad();
    return { result, cacheState: "miss" as const, loadedAt: Date.now() };
  }

  const age = now - cachedLoad.loadedAt;
  if (age <= patronCacheFreshMs()) {
    return { result: cachedLoad.result, cacheState: "fresh" as const, loadedAt: cachedLoad.loadedAt };
  }

  // Do not make the browser wait for the slow TapData snapshot. The promise
  // is deliberately shared so overlapping polls never create a request herd.
  // Once a complete snapshot exists, never block the dashboard on a slow
  // upstream refresh. This also prevents a temporary TapData slowdown after
  // the stale window from turning the whole page into an endless spinner.
  scheduleRefresh();
  return { result: cachedLoad.result, cacheState: "stale" as const, loadedAt: cachedLoad.loadedAt };
}

/**
 * The live snapshot can contain hundreds of patrons. Next's built-in
 * compression does not consistently compress dynamic route responses when
 * running with `next start`, so negotiate gzip explicitly for browser clients.
 * Keeping Vary: Accept-Encoding prevents a proxy from serving compressed JSON
 * to a client that did not request it.
 */
function jsonResponse(payload: unknown, request: Request, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("vary", "Accept-Encoding");
  const body = JSON.stringify(payload);
  const etag = headers.get("etag");
  if (etag && request.headers.get("if-none-match") === etag) {
    headers.delete("content-type");
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(null, { ...init, status: 304, headers });
  }
  if (request.headers.get("accept-encoding")?.toLowerCase().includes("gzip")) {
    const compressed = gzipSync(body);
    headers.set("content-encoding", "gzip");
    headers.set("content-length", String(compressed.byteLength));
    return new Response(compressed as unknown as BodyInit, { ...init, headers });
  }
  return new Response(body, { ...init, headers });
}

export async function GET(request: Request) {
  try {
    const { result, cacheState, loadedAt } = await cachedLoadPatrons();
    const payload = {
      data: result.value,
      count: result.value.length,
      sourceCounts: result.sourceCounts,
      warnings: result.errors,
      partial: result.partial ?? false,
      mode: "live",
      fetchedAt: new Date(loadedAt).toISOString(),
      servedAt: new Date().toISOString(),
      cacheState,
    };
    // Hash only the stable snapshot fields. `servedAt` and cache labels change
    // on every request and must not force the browser to download the same
    // patron payload again during an unchanged polling interval.
    const snapshotTag = `"${createHash("sha1").update(JSON.stringify({
      data: payload.data,
      count: payload.count,
      sourceCounts: payload.sourceCounts,
      warnings: payload.warnings,
      partial: payload.partial,
    })).digest("hex")}"`;
    return jsonResponse(payload, request, {
      headers: {
        // Keep the browser uncached while allowing Vercel's edge to reuse a
        // completed snapshot for one polling interval. This removes the cold
        // function/TapData round-trip from every 3-second dashboard refresh.
        "cache-control": "public, max-age=0, s-maxage=3, stale-while-revalidate=30",
        "x-patrons-cache": cacheState,
        "x-patrons-cache-age-ms": String(Math.max(0, Date.now() - loadedAt)),
        "x-patrons-partial": String(result.partial ?? false),
        etag: snapshotTag,
      },
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unable to load patrons" }, request, {
      status: 502,
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        pragma: "no-cache",
        expires: "0",
      },
    });
  }
}
