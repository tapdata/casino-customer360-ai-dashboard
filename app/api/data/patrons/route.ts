import { tapDataCollectionLabel, tapDataCollectionUrl } from "../../tapdata-collections";

type JsonRecord = Record<string, unknown>;

const DEFAULT_TAPDATA_FIND_PATH_TEMPLATE = "/api/v1/{collection}/find";

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
};

let cachedLoad: { result: LoadPatronsResult; expiresAt: number } | null = null;
let inFlightLoad: Promise<LoadPatronsResult> | null = null;

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

async function fetchPage(current: TapDataConfig, token: string, collection: string, page: number, limit: number): Promise<PageResult> {
  const response = await fetchWithTimeout(collectionUrl(current, collection), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ page, limit, filter: {} }),
  }, timeoutForCollection(collection));
  if (!response.ok) throw new Error(`TapData ${tapDataCollectionLabel(collection)} request failed (${response.status})`);
  const payload = await response.json();
  const records = recordsFromPayload(payload);
  return { collection, records, count: countFromPayload(payload, records.length) };
}

function timeoutForCollection(collection: string) {
  if (["patron_profiles", "patron_table_sessions", "patron_risk_cases"].includes(collection)) return 12_000;
  return 4_000;
}

async function safeFetchPage(current: TapDataConfig, token: string, collection: string, page: number, limit: number): Promise<PageResult> {
  try {
    return await fetchPage(current, token, collection, page, limit);
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

async function loadPatrons(): Promise<LoadPatronsResult> {
  const current = config();
  if (!current) throw new Error("TapData is not configured");
  const token = await accessToken(current);
  const scanLimit = Math.min(Math.max(Number(process.env.TAPDATA_SCAN_LIMIT) || 1000, 50), 5000);
  const [profilePage, sessionPage, riskPage, recommendationPage, messagePage] = await Promise.all([
    // Customer 360 needs tier, region, preferences and host assignment for every
    // active patron. Keep embeddings out of patron_profiles or publish a slim API
    // projection so the panel can enrich the live session queue correctly.
    safeFetchPage(current, token, "patron_profiles", 1, scanLimit),
    safeFetchPage(current, token, "patron_table_sessions", 1, scanLimit),
    safeFetchPage(current, token, "patron_risk_cases", 1, scanLimit),
    safeFetchPage(current, token, "offer_recommendations", 1, 1),
    safeFetchPage(current, token, "chat_messages", 1, 1),
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
  };
}

async function cachedLoadPatrons() {
  const now = Date.now();
  if (cachedLoad && cachedLoad.expiresAt > now) return cachedLoad.result;
  if (inFlightLoad) return inFlightLoad;
  inFlightLoad = loadPatrons()
    .then((result) => {
      cachedLoad = { result, expiresAt: Date.now() + 7_500 };
      return result;
    })
    .finally(() => {
      inFlightLoad = null;
    });
  return inFlightLoad;
}

export async function GET() {
  try {
    const result = await cachedLoadPatrons();
    return Response.json({
      data: result.value,
      count: result.value.length,
      sourceCounts: result.sourceCounts,
      warnings: result.errors,
      mode: "live",
      fetchedAt: new Date().toISOString(),
    }, {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        pragma: "no-cache",
        expires: "0",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load patrons" }, {
      status: 502,
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        pragma: "no-cache",
        expires: "0",
      },
    });
  }
}
