import { MongoClient } from "mongodb";

const argv = new Set(process.argv.slice(2));
const asInt = (name, fallback, min = 0) => {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value >= min ? value : fallback;
};
const asFloat = (name, fallback, min = 0, max = 1) => {
  const value = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
};

const user = process.env.MONGO_ROOT_USER ?? "demo_admin";
const password = process.env.MONGO_ROOT_PASSWORD ?? "change-me";
const defaultUri = `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@mongo:27017/casino_source?authSource=admin`;
const uri = process.env.SOURCE_MONGO_URI || defaultUri;
const dbName = process.env.SOURCE_MONGO_DB || "casino_source";
const profileCollection = process.env.SOURCE_PROFILE_COLLECTION || "source_patron_profiles";
const sessionCollection = process.env.SOURCE_SESSION_COLLECTION || "source_table_sessions";
const activityCollection = process.env.SOURCE_ACTIVITY_COLLECTION || "source_activity_events";

const initialPatrons = asInt("SOURCE_INITIAL_PATRONS", 60, 1);
const initialActive = Math.min(asInt("SOURCE_INITIAL_ACTIVE", 18, 0), initialPatrons);
const seedActiveCount = Math.min(initialActive, asInt("FEEDER_MAX_ACTIVE_PATRONS", 350, 1), 30 * asInt("FEEDER_TABLE_CAP", 25, 1));
const intervalMs = asInt("FEEDER_INTERVAL_MS", 15000, 1000);
const durationHours = asFloat("FEEDER_DURATION_HOURS", 0, 0, 24 * 365);
const transitionsPerTick = asInt("FEEDER_TRANSITIONS_PER_TICK", 1, 0);
const sessionUpdatesPerTick = asInt("FEEDER_SESSION_UPDATES_PER_TICK", 1, 0);
const maxActive = asInt("FEEDER_MAX_ACTIVE_PATRONS", 350, 1);
const tableCap = asInt("FEEDER_TABLE_CAP", 25, 1);
const riskRatio = asFloat("FEEDER_RISK_RATIO", 0.02, 0, 1);
const seed = asInt("FEEDER_SEED", 20260915, 0);

const tables = Array.from({ length: 30 }, (_, index) => `T-${String(index + 1).padStart(4, "0")}`);
const games = ["Baccarat", "Blackjack", "Roulette", "Sic Bo", "Poker"];
const regions = ["Macau", "Hong Kong", "Mainland China", "Singapore", "Taiwan"];
const behaviorTags = ["Steady", "PromoSeeker", "Conservative", "LateNight", "HighValueReturn"];

// Small deterministic PRNG: repeatable demo data without relying on Math.random.
let state = (seed >>> 0) || 1;
const random = () => {
  state = (1664525 * state + 1013904223) >>> 0;
  return state / 0x100000000;
};
const pick = (items) => items[Math.floor(random() * items.length)];
const now = () => new Date();
const customerId = (index) => `SRC-P-${String(index + 1).padStart(6, "0")}`;
const profileId = (index) => `src-profile-${String(index + 1).padStart(6, "0")}`;
const sessionId = (index) => `src-session-${String(index + 1).padStart(6, "0")}`;

const tierFor = (adt) => {
  if (adt >= 500000) return "Diamond";
  if (adt >= 200000) return "Platinum";
  if (adt >= 80000) return "Gold";
  if (adt >= 20000) return "Silver";
  return "Bronze";
};

const activeProfileFilter = { is_active: true };

function buildProfile(index, active, generatedAt) {
  const adt = Math.round(5000 + random() * 95000);
  const risk = active && random() < riskRatio;
  return {
    _id: profileId(index),
    source_customer_id: customerId(index),
    source_player_id: `PLAYER-${String(index + 100861).padStart(6, "0")}`,
    display_name: `Demo Patron ${String(index + 1).padStart(3, "0")}`,
    masked_name: `D***${String(index % 10)}`,
    tier: tierFor(adt),
    region: pick(regions),
    is_active: active,
    risk_flags: risk ? ["ResponsiblePlayReview"] : [],
    preferred_games: [pick(games)],
    adt,
    points_balance: Math.round(adt * (1.5 + random() * 2.5)),
    updated_at: generatedAt,
    created_at: generatedAt,
  };
}

function buildSession(index, profile, generatedAt, tableId = null) {
  const selectedTable = profile.is_active ? tableId ?? tables[index % tables.length] : null;
  const amount = profile.is_active ? Math.round(1000 + random() * 30000) : 0;
  return {
    _id: sessionId(index),
    source_customer_id: profile.source_customer_id,
    table_id: selectedTable,
    game_type: profile.is_active ? pick(games) : null,
    session_bet_amount: amount,
    current_stack_estimate: profile.is_active ? Math.round(amount * (0.7 + random() * 1.8)) : 0,
    seated_at: profile.is_active ? generatedAt : null,
    last_action_at: generatedAt,
    is_active: profile.is_active,
    behavior_tags: profile.is_active ? [pick(behaviorTags)] : [],
    updated_at: generatedAt,
  };
}

async function seedData(db) {
  const profiles = [];
  const sessions = [];
  const activities = [];
  const generatedAt = now();
  for (let index = 0; index < initialPatrons; index += 1) {
    const profile = buildProfile(index, index < seedActiveCount, generatedAt);
    profiles.push(profile);
    sessions.push(buildSession(index, profile, generatedAt, profile.is_active ? tables[index % tables.length] : null));
    activities.push({
      _id: `src-activity-${String(index + 1).padStart(6, "0")}`,
      source_customer_id: profile.source_customer_id,
      activity_type: profile.is_active ? "SESSION_OPEN" : "PROFILE_SEEDED",
      amount: profile.is_active ? sessions.at(-1).session_bet_amount : 0,
      occurred_at: generatedAt,
      source: "mongo-source-feeder",
      metadata: { seed },
    });
  }
  await db.collection(profileCollection).bulkWrite(
    profiles.map((document) => ({ updateOne: { filter: { _id: document._id }, update: { $setOnInsert: document }, upsert: true } })),
    { ordered: false },
  );
  await db.collection(sessionCollection).bulkWrite(
    sessions.map((document) => ({ updateOne: { filter: { _id: document._id }, update: { $setOnInsert: document }, upsert: true } })),
    { ordered: false },
  );
  await db.collection(activityCollection).bulkWrite(
    activities.map((document) => ({ updateOne: { filter: { _id: document._id }, update: { $setOnInsert: document }, upsert: true } })),
    { ordered: false },
  );
  return profiles.length;
}

async function loadTableCounts(sessionCol) {
  const rows = await sessionCol.aggregate([
    { $match: { is_active: true, table_id: { $ne: null } } },
    { $group: { _id: "$table_id", count: { $sum: 1 } } },
  ]).toArray();
  return new Map(rows.map((row) => [row._id, row.count]));
}

function pickAvailableTable(tableCounts) {
  const available = tables.filter((tableId) => (tableCounts.get(tableId) ?? 0) < tableCap);
  return available.length > 0 ? pick(available) : null;
}

async function tick(db, tickNumber) {
  const profileCol = db.collection(profileCollection);
  const sessionCol = db.collection(sessionCollection);
  const activityCol = db.collection(activityCollection);
  const active = await profileCol.find(activeProfileFilter, { projection: { _id: 1, source_customer_id: 1, tier: 1, adt: 1 } }).toArray();
  const inactive = await profileCol.find({ is_active: false }, { projection: { _id: 1, source_customer_id: 1, tier: 1, adt: 1 } }).toArray();
  const tableCounts = await loadTableCounts(sessionCol);
  let transitions = 0;
  let sessionUpdates = 0;
  const stamp = now();

  for (let i = 0; i < transitionsPerTick; i += 1) {
    const shouldLeave = active.length > Math.max(1, seedActiveCount) && (inactive.length === 0 || random() < 0.55);
    const selected = shouldLeave ? pick(active) : pick(inactive);
    const nextTable = shouldLeave ? null : pickAvailableTable(tableCounts);
    if (!selected || (!shouldLeave && (active.length >= maxActive || !nextTable))) continue;
    const nextActive = !shouldLeave;
    // Capture the current table before clearing it on a leave transition so
    // the in-memory table occupancy stays consistent with MongoDB.
    const previousSession = shouldLeave
      ? await sessionCol.findOne(
          { source_customer_id: selected.source_customer_id },
          { projection: { table_id: 1 } },
        )
      : null;
    await profileCol.updateOne({ _id: selected._id }, { $set: { is_active: nextActive, updated_at: stamp } });
    await sessionCol.updateOne(
      { source_customer_id: selected.source_customer_id },
      { $set: { is_active: nextActive, table_id: nextTable, game_type: nextActive ? pick(games) : null, seated_at: nextActive ? stamp : null, last_action_at: stamp, updated_at: stamp } },
    );
    await activityCol.insertOne({ source_customer_id: selected.source_customer_id, activity_type: nextActive ? "SESSION_OPEN" : "SESSION_CLOSE", amount: 0, occurred_at: stamp, source: "mongo-source-feeder", metadata: { tick: tickNumber } });
    if (nextActive) {
      tableCounts.set(nextTable, (tableCounts.get(nextTable) ?? 0) + 1);
      active.push(selected);
      const inactiveIndex = inactive.findIndex((item) => item._id === selected._id);
      if (inactiveIndex >= 0) inactive.splice(inactiveIndex, 1);
    } else {
      if (previousSession?.table_id) {
        tableCounts.set(
          previousSession.table_id,
          Math.max(0, (tableCounts.get(previousSession.table_id) ?? 1) - 1),
        );
      }
      const activeIndex = active.findIndex((item) => item._id === selected._id);
      if (activeIndex >= 0) active.splice(activeIndex, 1);
      inactive.push(selected);
    }
    transitions += 1;
  }

  const shuffled = [...active].sort(() => random() - 0.5).slice(0, sessionUpdatesPerTick);
  for (const profile of shuffled) {
    const increment = Math.round(1000 + random() * 9000);
    await sessionCol.updateOne(
      { source_customer_id: profile.source_customer_id },
      { $inc: { session_bet_amount: increment, current_stack_estimate: Math.round(increment * (0.4 + random() * 0.8)) }, $set: { last_action_at: stamp, updated_at: stamp } },
    );
    const adtIncrement = Math.round(increment * 0.25);
    const currentAdt = Number(profile.adt ?? 0);
    const nextAdt = currentAdt + adtIncrement;
    await profileCol.updateOne({ _id: profile._id }, { $inc: { adt: adtIncrement, points_balance: Math.round(increment * 1.5) }, $set: { tier: tierFor(nextAdt), updated_at: stamp } });
    profile.adt = nextAdt;
    profile.tier = tierFor(nextAdt);
    await activityCol.insertOne({ source_customer_id: profile.source_customer_id, activity_type: "BET_UPDATE", amount: increment, occurred_at: stamp, source: "mongo-source-feeder", metadata: { tick: tickNumber } });
    sessionUpdates += 1;
  }
  const activeCount = await profileCol.countDocuments(activeProfileFilter);
  return { transitions, sessionUpdates, activeCount };
}

async function main() {
  if (argv.has("--dry-run")) {
    console.log(`[feeder] dry-run db=${dbName} patrons=${initialPatrons} active=${seedActiveCount} intervalMs=${intervalMs} durationHours=${durationHours || "unlimited"}`);
    return;
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
  let timer;
  let tickNumber = 0;
  const stop = async (signal) => {
    if (timer) clearInterval(timer);
    console.log(`[feeder] stopping signal=${signal}`);
    await client.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
  await client.connect();
  const db = client.db(dbName);
  const seeded = await seedData(db);
  console.log(`[feeder] ready db=${dbName} seeded=${seeded} active=${seedActiveCount}/${initialPatrons} tableCap=${tableCap} intervalMs=${intervalMs}`);
  let tickRunning = false;
  const runTick = async () => {
    if (tickRunning) return;
    tickRunning = true;
    tickNumber += 1;
    try {
      const result = await tick(db, tickNumber);
      console.log(`[feeder] tick=${tickNumber} transitions=${result.transitions} sessionUpdates=${result.sessionUpdates} active=${result.activeCount}/${initialPatrons}`);
    } finally {
      tickRunning = false;
    }
  };
  await runTick();
  if (argv.has("--once")) return stop("once");
  timer = setInterval(() => void runTick().catch((error) => console.error(`[feeder] tick-error ${error.message}`)), intervalMs);
  if (durationHours > 0) setTimeout(() => void stop("duration"), durationHours * 60 * 60 * 1000);
}

main().catch((error) => {
  console.error(`[feeder] fatal ${error.stack || error.message}`);
  process.exitCode = 1;
});
