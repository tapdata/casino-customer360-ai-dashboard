import { MongoClient, ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 5;

const JOURNEY_DURATION_MS = 60_000;
// Demo-only visible triggers. Production tiering should use rolling ADT /
// turnover plus governance review, not a single live session alone.
const GOLD_UPGRADE_WAGER = 300_000;
const PLATINUM_UPGRADE_WAGER = 700_000;
const DIAMOND_UPGRADE_WAGER = 1_200_000;
const DEMO_BASE_WAGER = 80_000;
const DEMO_TARGET_WAGER = DIAMOND_UPGRADE_WAGER;

const TIER_ORDER: Record<string, number> = {
  Unclassified: 0,
  Bronze: 1,
  Silver: 2,
  Gold: 3,
  Platinum: 4,
  Diamond: 5,
};
const TIER_BY_RANK = ["Unclassified", "Bronze", "Silver", "Gold", "Platinum", "Diamond"] as const;

type JourneyDoc = {
  _id?: ObjectId;
  journeyId: string;
  patronId: string;
  status: "running" | "completed";
  startedAt: string;
  endsAt: string;
  updatedAt: string;
  baseWager: number;
  targetWager: number;
  startTier: string;
  currentTier: string;
  currentWager: number;
  stage: number;
  recommendation: string;
  thresholds: { gold?: number; platinum?: number; diamond: number };
  // Keep the live-session context with the journey. This lets the operations
  // view restore the customer as active after the source API refreshes, even
  // when the upstream record briefly omits the session.
  tableId?: string;
  seatedAt?: string | null;
  behaviorTags?: string[];
  currentStackEstimate?: number;
};

let clientPromise: Promise<MongoClient> | null = null;

function mongoUri() {
  if (process.env.MONGO_AUDIT_URI) return process.env.MONGO_AUDIT_URI;
  const host = process.env.MONGO_AUDIT_HOST;
  const user = process.env.MONGO_AUDIT_USER;
  const password = process.env.MONGO_AUDIT_PASSWORD;
  if (!host || !user || !password) return null;
  const authDb = process.env.MONGO_AUDIT_AUTH_DB || "admin";
  const mechanism = process.env.MONGO_AUDIT_AUTH_MECHANISM || "SCRAM-SHA-256";
  return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}/?authSource=${encodeURIComponent(authDb)}&authMechanism=${encodeURIComponent(mechanism)}&directConnection=true`;
}

function collectionName() {
  return process.env.MONGO_DEMO_JOURNEY_COLLECTION || "demo_upgrade_journeys";
}

async function journeyCollection() {
  const uri = mongoUri();
  if (!uri) return null;
  clientPromise ??= MongoClient.connect(uri, {
    maxPoolSize: 4,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 4_000,
    connectTimeoutMS: 4_000,
  });
  const client = await clientPromise;
  const dbName = process.env.MONGO_AUDIT_DB || "ai_loyalty_engine";
  return client.db(dbName).collection<JourneyDoc>(collectionName());
}

function finiteNonNegative(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function boundedDemoWager(value: unknown) {
  return Math.min(DIAMOND_UPGRADE_WAGER, finiteNonNegative(value));
}

function tierForWager(wager: number, startTier: string) {
  const normalizedTier = startTier?.trim() || "Bronze";
  const startRank = TIER_ORDER[normalizedTier] ?? TIER_ORDER.Bronze;
  const wagerRank = wager >= DIAMOND_UPGRADE_WAGER
    ? TIER_ORDER.Diamond
    : wager >= PLATINUM_UPGRADE_WAGER
      ? TIER_ORDER.Platinum
      : wager >= GOLD_UPGRADE_WAGER
        ? TIER_ORDER.Gold
        : TIER_ORDER.Unclassified;
  return TIER_BY_RANK[Math.max(startRank, wagerRank)] || "Bronze";
}

function recommendationForTier(tier: string) {
  if (tier === "Diamond") return "套房升级 + 延迟退房 + 豪车接送 + 餐饮体验券";
  if (tier === "Platinum") return "套房升级 + 延迟退房 + 豪车接送";
  return "套房升级 + 延迟退房";
}

function advance(doc: JourneyDoc, now = Date.now()): JourneyDoc {
  const startedAt = new Date(doc.startedAt).getTime();
  const endsAt = new Date(doc.endsAt).getTime();
  const elapsed = Math.max(0, now - startedAt);
  const progress = Math.min(1, elapsed / JOURNEY_DURATION_MS);
  // Legacy journey documents may predate the monotonic-wager fields. Normalize
  // them before interpolation so a missing value never turns the UI into NaN
  // or resets a live source session to the old demo baseline.
  const baseWager = boundedDemoWager(doc.baseWager);
  const targetWager = Math.min(DIAMOND_UPGRADE_WAGER, Math.max(baseWager, boundedDemoWager(doc.targetWager)));
  const calculatedWager = Math.round(baseWager + ((targetWager - baseWager) * progress));
  const currentWager = Math.min(DIAMOND_UPGRADE_WAGER, Math.max(
    baseWager,
    boundedDemoWager(doc.currentWager),
    calculatedWager,
  ));
  const currentTier = tierForWager(currentWager, doc.startTier);
  // Keep the visual stages tied to the same wager thresholds as the
  // recommendation engine. This prevents the UI from showing "Diamond"
  // before the persisted wager has actually crossed the Diamond threshold.
  const stage = progress >= 1
    ? 4
    : TIER_ORDER[currentTier] >= TIER_ORDER.Diamond
      ? 3
      : TIER_ORDER[currentTier] >= TIER_ORDER.Platinum
        ? 2
        : TIER_ORDER[currentTier] >= TIER_ORDER.Gold || progress >= 0.25
          ? 1
          : 0;
  return {
    ...doc,
    status: now >= endsAt ? "completed" : "running",
    currentWager,
    currentTier,
    stage,
    recommendation: recommendationForTier(currentTier),
    updatedAt: new Date(now).toISOString(),
  };
}

function publicJourney(doc: JourneyDoc, now = Date.now()) {
  const advanced = advance(doc, now);
  const startedAt = new Date(advanced.startedAt).getTime();
  const elapsedSeconds = Math.min(60, Math.max(0, Math.floor((now - startedAt) / 1_000)));
  return {
    journeyId: advanced.journeyId,
    patronId: advanced.patronId,
    status: advanced.status,
    stage: advanced.stage,
    elapsedSeconds,
    secondsRemaining: Math.max(0, 60 - elapsedSeconds),
    startedAt: advanced.startedAt,
    endsAt: advanced.endsAt,
    updatedAt: advanced.updatedAt,
    currentTier: advanced.currentTier,
    currentWager: advanced.currentWager,
    recommendation: advanced.recommendation,
    thresholds: {
      gold: advanced.thresholds.gold ?? GOLD_UPGRADE_WAGER,
      platinum: advanced.thresholds.platinum ?? PLATINUM_UPGRADE_WAGER,
      diamond: advanced.thresholds.diamond ?? DIAMOND_UPGRADE_WAGER,
    },
    tableId: advanced.tableId,
    seatedAt: advanced.seatedAt || advanced.startedAt,
    behaviorTags: advanced.behaviorTags || [],
    currentStackEstimate: advanced.currentStackEstimate || 0,
    collection: collectionName(),
    database: process.env.MONGO_AUDIT_DB || "ai_loyalty_engine",
  };
}

function errorResponse(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

async function persistAdvance(collection: Awaited<ReturnType<typeof journeyCollection>>, doc: JourneyDoc) {
  if (!collection) return;
  const advanced = advance(doc);
  // MongoDB adds an _id on insert. Never include it in $set: attempting to
  // update the immutable _id field makes the second poll fail silently from
  // the operator's perspective and breaks the persistent journey.
  const persisted = { ...advanced };
  delete persisted._id;
  await collection.updateOne(
    { journeyId: advanced.journeyId },
    { $set: persisted },
    { upsert: true },
  );
}

export async function POST(request: Request) {
  let body: {
    patronId?: string;
    startTier?: string;
    restart?: boolean;
    tableId?: string;
    seatedAt?: string | null;
    behaviorTags?: string[];
    currentStackEstimate?: number;
    sessionBetAmount?: number;
  } = {};
  try {
    body = await request.json() as typeof body;
  } catch {
    return errorResponse("Invalid JSON request body", 400);
  }
  const patronId = body.patronId?.trim();
  if (!patronId) return errorResponse("patronId is required", 400);

  try {
    const collection = await journeyCollection();
    if (!collection) return errorResponse("Mongo persistence is not configured", 503);
    // Re-entry looks up the newest checkpoint for one patron. Keep that query
    // covered by an index whose sort fields are adjacent; the older
    // patron/status index is no longer sufficient once completed journeys are
    // resumed as well.
    await collection.createIndex({ patronId: 1, updatedAt: -1 });
    const now = Date.now();
    const latest = await collection.findOne(
      { patronId },
      { sort: { updatedAt: -1 } },
    );
    // A completed journey is the durable result of the demo. Re-entering the
    // workspace must restore that result instead of silently resetting the
    // customer to Gold. A new run is opt-in through restart=true.
    if (latest && !body.restart) {
      const sourceWager = boundedDemoWager(body.sessionBetAmount);
      const sourceStack = finiteNonNegative(body.currentStackEstimate);
      const merged: JourneyDoc = {
        ...latest,
        // Adopt a newer, higher source snapshot without ever lowering a
        // persisted journey that has already progressed.
        baseWager: Math.min(DIAMOND_UPGRADE_WAGER, Math.max(boundedDemoWager(latest.baseWager), sourceWager)),
        targetWager: Math.min(DIAMOND_UPGRADE_WAGER, Math.max(boundedDemoWager(latest.targetWager), sourceWager, DEMO_TARGET_WAGER)),
        currentWager: Math.min(DIAMOND_UPGRADE_WAGER, Math.max(boundedDemoWager(latest.currentWager), sourceWager)),
        currentStackEstimate: Math.max(finiteNonNegative(latest.currentStackEstimate), sourceStack),
        tableId: body.tableId?.trim() || latest.tableId,
        seatedAt: latest.seatedAt || body.seatedAt || null,
        behaviorTags: latest.behaviorTags?.length ? latest.behaviorTags : (body.behaviorTags || []),
      };
      const advanced = advance(merged, now);
      await persistAdvance(collection, advanced);
      return Response.json({ ok: true, journey: publicJourney(advanced, now), persisted: true, resumed: true });
    }

    const startedAt = new Date(now).toISOString();
    const sourceWager = boundedDemoWager(body.sessionBetAmount);
    const baseWager = sourceWager || DEMO_BASE_WAGER;
    const targetWager = DEMO_TARGET_WAGER;
    const startTier = body.startTier?.trim() || "Bronze";
    const journey: JourneyDoc = {
      journeyId: `UPGRADE-${patronId}-${now}`,
      patronId,
      status: "running",
      startedAt,
      endsAt: new Date(now + JOURNEY_DURATION_MS).toISOString(),
      updatedAt: startedAt,
      // Start from the real current-session wager when available. The old
      // fixed 18,000 baseline could overwrite a live 48,000+ source value.
      baseWager,
      targetWager,
      startTier,
      currentTier: tierForWager(baseWager, startTier),
      currentWager: baseWager,
      stage: 0,
      recommendation: recommendationForTier(tierForWager(baseWager, startTier)),
      thresholds: { gold: GOLD_UPGRADE_WAGER, platinum: PLATINUM_UPGRADE_WAGER, diamond: DIAMOND_UPGRADE_WAGER },
      tableId: body.tableId?.trim() || "T-0001",
      seatedAt: body.seatedAt || startedAt,
      behaviorTags: Array.isArray(body.behaviorTags) ? body.behaviorTags.filter((tag): tag is string => typeof tag === "string").slice(0, 8) : [],
      currentStackEstimate: finiteNonNegative(body.currentStackEstimate),
    };
    await collection.insertOne(journey);
    return Response.json({ ok: true, journey: publicJourney(journey, now), persisted: true });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Mongo persistence failed", 503);
  }
}

export async function GET(request: Request) {
  const patronId = new URL(request.url).searchParams.get("patronId")?.trim();
  if (!patronId) return errorResponse("patronId is required", 400);
  try {
    const collection = await journeyCollection();
    if (!collection) return errorResponse("Mongo persistence is not configured", 503);
    const doc = await collection.findOne({ patronId }, { sort: { updatedAt: -1 } });
    if (!doc) return Response.json({ ok: true, journey: null, persisted: true });
    const now = Date.now();
    const advanced = advance(doc, now);
    await persistAdvance(collection, advanced);
    return Response.json({ ok: true, journey: publicJourney(advanced, now), persisted: true });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Mongo persistence failed", 503);
  }
}
