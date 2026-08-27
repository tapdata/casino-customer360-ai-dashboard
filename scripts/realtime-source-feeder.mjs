#!/usr/bin/env node

import process from "node:process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

function loadSourceFeederEnv(filePath) {
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadSourceFeederEnv(resolve(".env.source-feeder"));

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const once = args.has("--once") || dryRun;
const scenarioArg = valueArg("--scenario") || process.env.FEEDER_SCENARIO || "mixed";
const intervalMs = Number(valueArg("--interval") || process.env.FEEDER_INTERVAL_MS || 15000);
const startPlayerId = Number(valueArg("--start-player-id") || process.env.FEEDER_START_PLAYER_ID || 105000);
const maxEvents = Number(valueArg("--max-events") || process.env.FEEDER_MAX_EVENTS || 0);
const durationHours = Number(valueArg("--duration-hours") || process.env.FEEDER_DURATION_HOURS || 0);
const batchSize = Math.max(1, Number(valueArg("--batch-size") || process.env.FEEDER_BATCH_SIZE || 1));
const activePatronLimit = Math.max(1, Number(valueArg("--active-limit") || process.env.FEEDER_ACTIVE_PATRON_LIMIT || 220));
const poolSize = Math.max(0, Number(valueArg("--pool-size") || process.env.FEEDER_POOL_SIZE || activePatronLimit));
const managedPlayerStart = Number(valueArg("--managed-player-start") || process.env.FEEDER_MANAGED_PLAYER_START || 100000);
const managedPlayerEnd = Number(valueArg("--managed-player-end") || process.env.FEEDER_MANAGED_PLAYER_END || 119999);
const retirePlayerRange = valueArg("--retire-player-range") || process.env.FEEDER_RETIRE_PLAYER_RANGE || "";
const allowPartial = args.has("--allow-partial") || process.env.FEEDER_ALLOW_PARTIAL === "true";

const floorTables = [
  ["T-0001", "A", "POK", 25, 800],
  ["T-0002", "B", "BLA", 25, 500],
  ["T-0003", "A", "ROU", 25, 1000],
  ["T-0004", "B", "BAC", 25, 1000],
  ["T-0005", "C", "SIC", 25, 300],
  ["T-0006", "C", "BLA", 25, 800],
  ["T-0007", "A", "SIC", 25, 800],
  ["T-0008", "B", "ROU", 25, 300],
  ["T-0009", "A", "BAC", 25, 500],
  ["T-0010", "A", "ROU", 25, 500],
  ["T-0011", "VIP", "BAC", 25, 3000],
  ["T-0012", "C", "BLA", 25, 1000],
  ["T-0013", "B", "ROU", 25, 500],
  ["T-0014", "B", "BLA", 25, 500],
  ["T-0015", "VIP", "BAC", 25, 5000],
  ["T-0016", "A", "POK", 25, 1000],
  ["T-0017", "C", "SIC", 25, 300],
  ["T-0018", "VIP", "POK", 25, 1000],
  ["T-0019", "C", "BLA", 25, 800],
  ["T-0020", "B", "BAC", 25, 1000],
  ["T-0021", "B", "POK", 25, 800],
  ["T-0022", "C", "ROU", 25, 300],
  ["T-0023", "VIP", "ROU", 25, 1000],
  ["T-0024", "A", "SIC", 25, 300],
  ["T-0025", "B", "BAC", 25, 500],
  ["T-0026", "VIP", "BAC", 25, 300],
  ["T-0027", "A", "POK", 25, 1000],
  ["T-0028", "C", "ROU", 25, 300],
  ["T-0029", "B", "SIC", 25, 500],
  ["T-0030", "B", "BLA", 25, 300],
];

const targetSeatsByTable = {
  "T-0001": 0,
  "T-0002": 12,
  "T-0003": 6,
  "T-0004": 10,
  "T-0005": 0,
  "T-0006": 6,
  "T-0007": 10,
  "T-0008": 22,
  "T-0009": 5,
  "T-0010": 0,
  "T-0011": 14,
  "T-0012": 5,
  "T-0013": 9,
  "T-0014": 20,
  "T-0015": 9,
  "T-0016": 0,
  "T-0017": 0,
  "T-0018": 5,
  "T-0019": 18,
  "T-0020": 8,
  "T-0021": 8,
  "T-0022": 0,
  "T-0023": 4,
  "T-0024": 11,
  "T-0025": 7,
  "T-0026": 16,
  "T-0027": 4,
  "T-0028": 4,
  "T-0029": 7,
  "T-0030": 0,
};

const plannedActiveSeats = floorTables.flatMap((table) => {
  const [tableId] = table;
  return Array.from({ length: targetSeatsByTable[tableId] ?? 7 }, (_, seatIndex) => ({ table, seatIndex }));
}).sort((left, right) => left.seatIndex - right.seatIndex || left.table[0].localeCompare(right.table[0]));

const effectiveActivePatronLimit = Math.min(activePatronLimit, plannedActiveSeats.length);

function valueArg(name) {
  const prefix = `${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function parseNumberRange(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d+)-(\d+)$/);
  if (!match) throw new Error(`Invalid range "${raw}". Expected format: 105000-108999`);
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
    throw new Error(`Invalid range "${raw}". Start must be <= end.`);
  }
  return { start, end };
}

function requireIdent(value, fallback) {
  const raw = String(value || fallback || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_$#]*$/.test(raw)) throw new Error(`Invalid SQL identifier: ${raw}`);
  return raw;
}

function quotePgIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteMssqlIdent(value) {
  return `[${String(value).replaceAll("]", "]]")}]`;
}

function maskName(name) {
  const clean = String(name || "Guest").replace(/\s+/g, "");
  if (clean.length <= 2) return `${clean[0] || "G"}*`;
  return `${clean[0]}****${clean.at(-1)}`;
}

function pad(value, length) {
  return String(value).padStart(length, "0");
}

function nowDate() {
  return new Date();
}

function oracleTimestamp(date = nowDate()) {
  return date;
}

function oracleConnectString(rawValue) {
  const raw = String(rawValue || "").trim();
  const sidMatch = raw.match(/^([^:/\s]+):(\d+):([^:/\s]+)$/);
  if (!sidMatch) return raw;
  const [, host, port, sid] = sidMatch;
  return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${sid})))`;
}

function pick(list, index) {
  return list[index % list.length];
}

function seededUnit(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function scenarioFor(seq) {
  if (scenarioArg !== "mixed") return scenarioArg;
  const playerOrdinal = poolSize > 0 ? ((seq - 1) % poolSize) + 1 : seq;
  const cycle = poolSize > 0 ? Math.floor((seq - 1) / poolSize) : 0;
  if (playerOrdinal > effectiveActivePatronLimit) return "inactive";
  if (cycle > 0 && (seq + playerOrdinal * 13) % 37 === 0) return "inactive";
  const bucket = seq % 100;
  if (bucket < 50) return "normal";
  if (bucket < 70) return "high_value_return";
  if (bucket < 82) return "offer_fatigue";
  if (bucket < 90) return "host_overdue";
  if (bucket < 92) return "risk";
  return "inactive";
}

function tableWeight(table, playerOrdinal, scenario) {
  const [tableId, zone] = table;
  const hotWeights = {
    "T-0008": 3.4,
    "T-0014": 3.0,
    "T-0026": 2.4,
    "T-0019": 2.1,
    "T-0011": 1.9,
    "T-0002": 1.6,
    "T-0024": 1.4,
  };
  const quietWeights = {
    "T-0001": 0.55,
    "T-0005": 0.7,
    "T-0010": 0.72,
    "T-0016": 0.78,
    "T-0022": 0.8,
    "T-0030": 0.82,
  };
  let weight = hotWeights[tableId] ?? quietWeights[tableId] ?? 1;
  if (scenario === "high_value_return") weight *= zone === "VIP" ? 3.8 : 0.65;
  if (scenario === "risk") weight *= ["T-0014", "T-0019", "T-0028"].includes(tableId) ? 3.1 : 0.75;
  if (scenario === "host_overdue") weight *= ["A", "VIP"].includes(zone) ? 1.35 : 0.95;
  if (scenario === "offer_fatigue") weight *= zone === "VIP" ? 0.7 : 1.05;
  weight *= 0.82 + seededUnit(playerOrdinal + Number(tableId.slice(-2)) * 17) * 0.36;
  return weight;
}

function oracleTableTargetCountCase(tableExpr = "TABLE_ID") {
  const clauses = Object.entries(targetSeatsByTable)
    .map(([tableId, count]) => `WHEN '${tableId}' THEN ${Math.min(25, Math.max(0, count))}`)
    .join(" ");
  return `CASE ${tableExpr} ${clauses} ELSE 0 END`;
}

function tableFor(playerOrdinal, scenario) {
  if (scenario === "inactive") {
    return floorTables[(playerOrdinal * 7 + 11) % floorTables.length];
  }
  const planned = plannedActiveSeats[playerOrdinal - 1];
  if (planned) return planned.table;
  const weights = floorTables.map((table) => tableWeight(table, playerOrdinal, scenario));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = seededUnit(playerOrdinal * 97 + scenario.length * 31) * total;
  for (let index = 0; index < floorTables.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return floorTables[index];
  }
  return floorTables.at(-1);
}

function buildPerson(seq) {
  const scenario = scenarioFor(seq);
  const playerOrdinal = poolSize > 0 ? ((seq - 1) % poolSize) + 1 : seq;
  const playerNumber = startPlayerId + playerOrdinal;
  const playerId = String(playerNumber);
  const masterPlayerId = `P${pad(playerNumber, 10)}`;
  const customerId = `C${playerNumber}`;
  const guestId = `H${pad(playerNumber, 6)}`;
  const posMemberNo = `VIP${playerId}`;
  const cardNo = `CARD-${playerId}`;
  const [tableId, zone, game, capacity, minBet] = tableFor(playerOrdinal, scenario);
  const tier = scenario === "high_value_return" ? "Diamond" : scenario === "risk" ? "Platinum" : pick(["Diamond", "Platinum", "Gold", "Silver"], seq);
  const region = pick(["Macau", "Hong Kong", "Singapore", "Taiwan", "Mainland China"], seq);
  const preferredGame = game === "BAC" ? "Baccarat" : game === "ROU" ? "Roulette" : game === "BLA" ? "Blackjack" : game === "POK" ? "Poker" : "Sic Bo";
  const preferredBenefits = scenario === "risk" ? ["HostCare"] : tier === "Diamond" ? ["SuiteUpgrade", "LateCheckout", "FineDining"] : ["Dining", "Points"];
  const active = scenario !== "inactive" && playerOrdinal <= effectiveActivePatronLimit;
  const risky = scenario === "risk";
  const riskFlags = risky ? ["ResponsiblePlayReview"] : scenario === "offer_fatigue" ? ["OfferFatigue"] : [];
  const behaviorTags = risky
    ? ["Aggressive", "LateNight", "CardCounterWatch"]
    : scenario === "high_value_return"
      ? ["HighValueReturn", "PromoSeeker"]
      : scenario === "offer_fatigue"
        ? ["OfferFatigue", "Conservative"]
        : scenario === "host_overdue"
          ? ["HostFollowupOverdue", "PromoSeeker"]
          : ["Steady", "PromoSeeker"];
  const adt = tier === "Diamond" ? 58000 + seq * 120 : tier === "Platinum" ? 36000 + seq * 90 : tier === "Gold" ? 24000 + seq * 70 : 12000 + seq * 50;
  const sessionBet = risky ? 96000 + seq * 500 : scenario === "high_value_return" ? 72000 + seq * 400 : 18000 + seq * 260;
  const stack = risky ? 12000 + seq * 100 : 42000 + seq * 200;
  const name = pick(["Ava Chan", "Lucas Ho", "Mia Wong", "Ethan Lei", "Nora Wu", "Ryan Lam", "Iris Tang", "Marcus Fong"], seq);
  const created = nowDate();
  const seatedAt = new Date(created.getTime() - 18 * 60 * 1000);
  const lastActionAt = created;
  return {
    seq,
    scenario,
    active,
    risky,
    playerId,
    masterPlayerId,
    customerId,
    guestId,
    posMemberNo,
    cardNo,
    passportHash: `PASS-DEMO-${playerId}`,
    mobileHash: `MOB-DEMO-${playerId}`,
    name,
    maskedName: maskName(name),
    tableId,
    tableName: `Table ${Number(tableId.slice(2))}`,
    game,
    preferredGame,
    zone,
    tier,
    region,
    preferredBenefits,
    riskFlags,
    behaviorTags,
    adt,
    theoWin: Math.round(adt * 3.2),
    points: Math.round(adt * 5.4),
    sessionId: `LIVE-S-${playerId}`,
    roundNumber: 1000 + seq,
    sessionBet,
    previousBet: Math.round(sessionBet * 0.68),
    stack,
    tablePatronCount: active ? Math.min(capacity, targetSeatsByTable[tableId] ?? 6) : 0,
    capacity,
    minBet,
    created,
    seatedAt,
    lastActionAt,
  };
}

async function optionalImport(packageName, installHint) {
  try {
    return await import(packageName);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" || String(error?.message || "").includes("Cannot find package")) {
      throw new Error(`Missing database driver "${packageName}". Install it with: ${installHint}`);
    }
    throw error;
  }
}

class PgSink {
  constructor() {
    this.schema = requireIdent(process.env.PGSCHEMA, "casino_loyalty");
    this.cache = new Map();
  }

  static enabled() {
    return Boolean(process.env.PGHOST && process.env.PGUSER && process.env.PGDATABASE);
  }

  async connect() {
    const { Client } = await optionalImport("pg", "npm install pg");
    this.client = new Client({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
    });
    await this.client.connect();
    this.client.on("error", (error) => {
      console.warn(`PostgreSQL connection event: ${error.message}`);
      this.client = null;
      this.cache.clear();
    });
    await this.client.query(`SET search_path TO ${quotePgIdent(this.schema)}`);
  }

  async reconnect() {
    try {
      await this.client?.end();
    } catch {}
    this.client = null;
    this.cache.clear();
    await this.connect();
  }

  async ensureConnected() {
    if (!this.client || this.client._ending || this.client._ended) {
      await this.reconnect();
    }
  }

  async columns(table) {
    await this.ensureConnected();
    if (this.cache.has(table)) return this.cache.get(table);
    const result = await this.client.query(
      "select column_name from information_schema.columns where table_schema=$1 and table_name=$2",
      [this.schema, table],
    );
    const cols = new Set(result.rows.map((row) => row.column_name));
    this.cache.set(table, cols);
    return cols;
  }

  async upsert(table, pk, record) {
    await this.ensureConnected();
    const available = await this.columns(table);
    const entries = Object.entries(record).filter(([key, value]) => available.has(key) && value !== undefined);
    if (!entries.some(([key]) => key === pk)) throw new Error(`PG ${table}: missing primary key ${pk}`);
    if (entries.length === 0) return;
    const cols = entries.map(([key]) => key);
    const values = entries.map(([, value]) => value);
    const placeholders = cols.map((_, index) => `$${index + 1}`);
    const updates = cols.filter((col) => col !== pk).map((col) => `${quotePgIdent(col)}=excluded.${quotePgIdent(col)}`);
    const sql = `insert into ${quotePgIdent(this.schema)}.${quotePgIdent(table)} (${cols.map(quotePgIdent).join(", ")}) values (${placeholders.join(", ")}) on conflict (${quotePgIdent(pk)}) ${updates.length ? `do update set ${updates.join(", ")}` : "do nothing"}`;
    await this.client.query(sql, values);
  }

  async write(person) {
    await this.upsert("crm_identity_links", "master_player_id", {
      master_player_id: person.masterPlayerId,
      gaming_player_id: person.playerId,
      hotel_guest_id: person.guestId,
      pos_member_no: person.posMemberNo,
      crm_customer_id: person.customerId,
      casino_card_no: person.cardNo,
      passport_hash: person.passportHash,
      mobile_hash: person.mobileHash,
      identity_confidence: 0.98,
      identity_status: "VERIFIED",
      updated_at: person.created,
    });
    await this.upsert("crm_patron_profiles", "customer_id", {
      customer_id: person.customerId,
      master_player_id: person.masterPlayerId,
      name: person.name,
      masked_name: person.maskedName,
      tier: person.tier,
      region: person.region,
      adt: person.adt,
      points_balance: person.points,
      preferred_games: [person.preferredGame],
      preferred_benefits: person.preferredBenefits,
      risk_flags: person.riskFlags,
      last_active_at: person.active ? person.lastActionAt : new Date(person.created.getTime() - 20 * 24 * 60 * 60 * 1000),
      created_at: person.created,
      updated_at: person.created,
      last_hotel_benefit_at: person.scenario === "high_value_return" ? null : new Date(person.created.getTime() - 7 * 24 * 60 * 60 * 1000),
    });
    await this.upsert("app_activity_events", "event_id", {
      event_id: `APP-${person.customerId}-${person.seq}`,
      customer_id: person.customerId,
      activity_type: person.risky ? "RESPONSIBLE_PLAY_INFO_VIEW" : "APP_VIEW",
      source: "mobile_app",
      amount: person.risky ? 0 : 120,
      points_delta: person.risky ? 0 : 200,
      metadata: { channel: "AppPush", isVip: ["Diamond", "Platinum"].includes(person.tier), venue: person.preferredBenefits[0], scenario: person.scenario },
      event_time: person.created,
    });
    await this.upsert("pos_fnb_checks", "check_id", {
      check_id: `FNB-${person.playerId}-${person.seq}`,
      member_no: person.posMemberNo,
      outlet_name: person.risky ? "VIP Lounge" : "Robuchon Macau",
      category: person.risky ? "Lounge" : "FineDining",
      amount_hkd: person.risky ? 0 : 980 + person.seq * 20,
      preference_tag: person.risky ? "HostCare" : "FineDiningInterest",
      check_time: person.created,
    });
    await this.upsert("crm_offer_responses", "response_id", {
      response_id: `OR-${person.customerId}-${person.seq}`,
      customer_id: person.customerId,
      offer_category: person.risky ? "ResponsiblePlay" : person.preferredBenefits[0],
      channel: "WhatsApp",
      outcome: person.risky ? "Suppressed" : "Viewed",
      responded_at: person.created,
    });
  }

  async retirePlayerRange() {}

  async close() {
    await this.client?.end();
  }
}

class OracleSink {
  constructor() {
    this.schema = requireIdent(process.env.ORACLE_SCHEMA, "C##GAMING").toUpperCase();
    this.cache = new Map();
  }

  static enabled() {
    return Boolean(process.env.ORACLE_USER && process.env.ORACLE_PASSWORD && process.env.ORACLE_CONNECT_STRING);
  }

  async connect() {
    const oracledb = await optionalImport("oracledb", "npm install oracledb");
    this.oracledb = oracledb.default || oracledb;
    this.connection = await this.oracledb.getConnection({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: oracleConnectString(process.env.ORACLE_CONNECT_STRING),
    });
    await this.connection.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${this.schema}`);
  }

  async columns(table) {
    const normalized = table.toUpperCase();
    if (this.cache.has(normalized)) return this.cache.get(normalized);
    const result = await this.connection.execute(
      "select column_name from all_tab_columns where owner = :ownerName and table_name = :tableName",
      { ownerName: this.schema, tableName: normalized },
      { outFormat: this.oracledb.OUT_FORMAT_OBJECT },
    );
    const cols = new Set(result.rows.map((row) => row.COLUMN_NAME));
    this.cache.set(normalized, cols);
    return cols;
  }

  async upsert(table, pk, record) {
    const normalized = table.toUpperCase();
    const available = await this.columns(normalized);
    const entries = Object.entries(record)
      .map(([key, value]) => [key.toUpperCase(), value])
      .filter(([key, value]) => available.has(key) && value !== undefined);
    const pkUpper = pk.toUpperCase();
    if (!entries.some(([key]) => key === pkUpper)) throw new Error(`Oracle ${table}: missing primary key ${pk}`);
    if (entries.length === 0) return;
    const cols = entries.map(([key]) => key);
    const binds = Object.fromEntries(entries.map(([, value], index) => [`b${index}`, value]));
    const selectList = cols.map((col, index) => `:b${index} AS ${col}`).join(", ");
    const updates = cols.filter((col) => col !== pkUpper).map((col) => `t.${col}=s.${col}`);
    const sql = `MERGE INTO ${normalized} t USING (SELECT ${selectList} FROM dual) s ON (t.${pkUpper}=s.${pkUpper}) ${updates.length ? `WHEN MATCHED THEN UPDATE SET ${updates.join(", ")}` : ""} WHEN NOT MATCHED THEN INSERT (${cols.join(", ")}) VALUES (${cols.map((col) => `s.${col}`).join(", ")})`;
    try {
      await this.connection.execute(sql, binds, { autoCommit: false });
    } catch (error) {
      throw new Error(`${normalized} merge failed: ${error.message}`);
    }
  }

  async write(person) {
    await this.upsert("GAMING_PLAYER_ACCOUNT", "PLAYER_ID", {
      PLAYER_ID: person.playerId,
      CASINO_CARD_NO: person.cardNo,
      FULL_NAME: person.name,
      PASSPORT_HASH: person.passportHash,
      MOBILE_HASH: person.mobileHash,
      ACCOUNT_STATUS: "ACTIVE",
      CREATED_AT: oracleTimestamp(person.created),
    });
    await this.upsert("GAMING_PLAYER_RATINGS", "RATING_ID", {
      RATING_ID: `R-${person.playerId}`,
      PLAYER_ID: person.playerId,
      ADT_AMOUNT: person.adt,
      THEO_WIN_AMOUNT: person.theoWin,
      LAST_VISIT_AT: oracleTimestamp(person.created),
      PREFERRED_GAME_CODE: person.game,
      RATING_TIER_CODE: person.tier.slice(0, 3).toUpperCase(),
      UPDATED_AT: oracleTimestamp(person.created),
    });
    await this.upsert("GAMING_TABLE_STATE", "TABLE_ID", {
      TABLE_ID: person.tableId,
      TABLE_NAME: person.tableName,
      ZONE_CODE: person.zone,
      GAME_CODE: person.game,
      CAPACITY: person.capacity,
      PATRON_COUNT: person.active ? person.tablePatronCount : 0,
      MIN_BET_HKD: person.minBet,
      MAX_BET_HKD: person.zone === "VIP" ? 200000 : 80000,
      AVG_BET_HKD: Math.round(person.sessionBet / Math.max(person.tablePatronCount, 1)),
      TABLE_STATUS: person.active ? (person.tablePatronCount >= 8 ? "HOT" : "OPEN") : "OPEN",
      REFRESHED_AT: oracleTimestamp(person.created),
    });
    await this.upsert("GAMING_TABLE_STATE_HISTORY", "HISTORY_ID", {
      HISTORY_ID: `TSH-${person.tableId}-${Date.now()}-${person.seq}`,
      TABLE_ID: person.tableId,
      TABLE_NAME: person.tableName,
      ZONE_CODE: person.zone,
      GAME_CODE: person.game,
      CAPACITY: person.capacity,
      PATRON_COUNT: person.active ? person.tablePatronCount : 0,
      MIN_BET_HKD: person.minBet,
      MAX_BET_HKD: person.zone === "VIP" ? 200000 : 80000,
      AVG_BET_HKD: Math.round(person.sessionBet / Math.max(person.tablePatronCount, 1)),
      TABLE_STATUS: person.active ? (person.tablePatronCount >= 8 ? "HOT" : "OPEN") : "OPEN",
      REFRESHED_AT: oracleTimestamp(person.created),
    });
    await this.upsert("GAMING_TABLE_SESSIONS", "SESSION_ID", {
      SESSION_ID: person.sessionId,
      PLAYER_ID: person.playerId,
      TABLE_ID: person.tableId,
      SEATED_AT: oracleTimestamp(person.seatedAt),
      LAST_ACTION_AT: oracleTimestamp(person.lastActionAt),
      SESSION_BET_HKD: person.active ? person.sessionBet : 0,
      PREVIOUS_BET_HKD: person.previousBet,
      CURRENT_STACK_HKD: person.stack,
      BEHAVIOR_TAGS: person.behaviorTags.join(","),
      IS_ACTIVE: person.active ? 1 : 0,
    });
    if (person.active) {
      await this.upsert("GAMING_PLAYER_ROUND_BETS", "ROUND_BET_ID", {
        ROUND_BET_ID: `RB-${person.playerId}-${person.seq}`,
        TABLE_ID: person.tableId,
        ROUND_NUMBER: person.roundNumber,
        PLAYER_ID: person.playerId,
        BET_AMOUNT_HKD: Math.round(person.sessionBet / 10),
        BEHAVIOR_TAGS: person.behaviorTags.join(","),
        RECORDED_AT: oracleTimestamp(person.created),
      });
      await this.upsert("GAMING_TABLE_ROUND_COUNTERS", "COUNTER_ID", {
        COUNTER_ID: `CTR-${person.tableId}`,
        TABLE_ID: person.tableId,
        BUSINESS_DATE: person.created,
        ROUND_NUMBER: person.roundNumber,
        UPDATED_AT: oracleTimestamp(person.created),
      });
    }
    await this.normalizeFloor();
  }

  async normalizeFloor() {
    const targetCountCase = oracleTableTargetCountCase("TABLE_ID");
    await this.connection.execute(
      `MERGE INTO GAMING_TABLE_SESSIONS t
       USING (
         SELECT SESSION_ID,
                CASE WHEN RN <= TARGET_COUNT THEN 1 ELSE 0 END AS NEXT_ACTIVE
         FROM (
           SELECT SESSION_ID,
                  TABLE_ID,
                  ROW_NUMBER() OVER (
                    PARTITION BY TABLE_ID
                    ORDER BY LAST_ACTION_AT DESC NULLS LAST, SESSION_ID DESC
                  ) AS RN,
                  ${targetCountCase} AS TARGET_COUNT
           FROM GAMING_TABLE_SESSIONS
           WHERE REGEXP_LIKE(PLAYER_ID, '^[0-9]+$')
             AND TO_NUMBER(PLAYER_ID) BETWEEN :managedPlayerStart AND :managedPlayerEnd
         )
       ) s
       ON (t.SESSION_ID = s.SESSION_ID)
       WHEN MATCHED THEN UPDATE
       SET t.IS_ACTIVE = s.NEXT_ACTIVE,
           t.LAST_ACTION_AT = CASE WHEN s.NEXT_ACTIVE = 0 THEN CURRENT_TIMESTAMP ELSE t.LAST_ACTION_AT END
       WHERE NVL(t.IS_ACTIVE, -1) <> s.NEXT_ACTIVE`,
      { managedPlayerStart, managedPlayerEnd },
      { autoCommit: false },
    );

    const floorSelect = floorTables
      .map(([tableId, zone, game, capacity, minBet]) => {
        const tableName = `Table ${Number(tableId.slice(2))}`;
        return (
          `SELECT '${tableId}' AS TABLE_ID, '${tableName}' AS TABLE_NAME, '${zone}' AS ZONE_CODE, ` +
          `'${game}' AS GAME_CODE, ${capacity} AS CAPACITY, ${minBet} AS MIN_BET_HKD FROM dual`
        );
      })
      .join(" UNION ALL ");

    await this.connection.execute(
      `MERGE INTO GAMING_TABLE_STATE t
       USING (
         SELECT f.TABLE_ID,
                f.TABLE_NAME,
                f.ZONE_CODE,
                f.GAME_CODE,
                f.CAPACITY,
                NVL(a.ACTIVE_COUNT, 0) AS PATRON_COUNT,
                f.MIN_BET_HKD,
                CASE WHEN f.ZONE_CODE = 'VIP' THEN 200000 ELSE 80000 END AS MAX_BET_HKD,
                CASE
                  WHEN NVL(a.ACTIVE_COUNT, 0) > 0 THEN ROUND(NVL(a.TOTAL_BET, 0) / a.ACTIVE_COUNT)
                  ELSE f.MIN_BET_HKD
                END AS AVG_BET_HKD,
                CASE
                  WHEN NVL(a.ACTIVE_COUNT, 0) >= 18 THEN 'HOT'
                  WHEN NVL(a.ACTIVE_COUNT, 0) = 0 THEN 'OPEN'
                  ELSE 'OPEN'
                END AS TABLE_STATUS
         FROM (${floorSelect}) f
         LEFT JOIN (
           SELECT TABLE_ID,
                  COUNT(*) AS ACTIVE_COUNT,
                  SUM(SESSION_BET_HKD) AS TOTAL_BET
           FROM GAMING_TABLE_SESSIONS
           WHERE IS_ACTIVE = 1
             AND REGEXP_LIKE(PLAYER_ID, '^[0-9]+$')
             AND TO_NUMBER(PLAYER_ID) BETWEEN :managedPlayerStart AND :managedPlayerEnd
           GROUP BY TABLE_ID
         ) a ON a.TABLE_ID = f.TABLE_ID
       ) s
       ON (t.TABLE_ID = s.TABLE_ID)
       WHEN MATCHED THEN UPDATE SET
         t.TABLE_NAME = s.TABLE_NAME,
         t.ZONE_CODE = s.ZONE_CODE,
         t.GAME_CODE = s.GAME_CODE,
         t.CAPACITY = s.CAPACITY,
         t.PATRON_COUNT = s.PATRON_COUNT,
         t.MIN_BET_HKD = s.MIN_BET_HKD,
         t.MAX_BET_HKD = s.MAX_BET_HKD,
         t.AVG_BET_HKD = s.AVG_BET_HKD,
         t.TABLE_STATUS = s.TABLE_STATUS,
         t.REFRESHED_AT = CURRENT_TIMESTAMP
       WHEN NOT MATCHED THEN INSERT (
         TABLE_ID, TABLE_NAME, ZONE_CODE, GAME_CODE, CAPACITY, PATRON_COUNT,
         MIN_BET_HKD, MAX_BET_HKD, AVG_BET_HKD, TABLE_STATUS, REFRESHED_AT
       ) VALUES (
         s.TABLE_ID, s.TABLE_NAME, s.ZONE_CODE, s.GAME_CODE, s.CAPACITY, s.PATRON_COUNT,
         s.MIN_BET_HKD, s.MAX_BET_HKD, s.AVG_BET_HKD, s.TABLE_STATUS, CURRENT_TIMESTAMP
       )`,
      { managedPlayerStart, managedPlayerEnd },
      { autoCommit: false },
    );
  }

  async retirePlayerRange(range) {
    if (!range) return;
    await this.connection.execute(
      `UPDATE GAMING_TABLE_SESSIONS
       SET IS_ACTIVE = 0, LAST_ACTION_AT = CURRENT_TIMESTAMP
       WHERE REGEXP_LIKE(PLAYER_ID, '^[0-9]+$')
         AND TO_NUMBER(PLAYER_ID) BETWEEN :startPlayerId AND :endPlayerId
         AND SESSION_ID LIKE 'LIVE-S-%'`,
      { startPlayerId: range.start, endPlayerId: range.end },
      { autoCommit: false },
    );
    await this.connection.commit();
    console.log(`Retired Oracle demo sessions for player range ${range.start}-${range.end}.`);
  }

  async close() {
    if (this.connection) await this.connection.close();
  }
}

class MssqlSink {
  constructor() {
    this.schema = requireIdent(process.env.MSSQL_SCHEMA, "dbo");
    this.cache = new Map();
  }

  static enabled() {
    return Boolean(process.env.MSSQL_SERVER && process.env.MSSQL_USER && process.env.MSSQL_DATABASE);
  }

  async connect() {
    const mssql = await optionalImport("mssql", "npm install mssql");
    this.mssql = mssql.default || mssql;
    this.pool = await this.mssql.connect({
      server: process.env.MSSQL_SERVER,
      port: Number(process.env.MSSQL_PORT || 1433),
      database: process.env.MSSQL_DATABASE,
      user: process.env.MSSQL_USER,
      password: process.env.MSSQL_PASSWORD,
      options: {
        encrypt: process.env.MSSQL_ENCRYPT === "true",
        trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== "false",
      },
    });
  }

  async columns(table) {
    if (this.cache.has(table)) return this.cache.get(table);
    const request = this.pool.request();
    request.input("schema", this.schema);
    request.input("table", table);
    const result = await request.query("select COLUMN_NAME from INFORMATION_SCHEMA.COLUMNS where TABLE_SCHEMA=@schema and TABLE_NAME=@table");
    const cols = new Set(result.recordset.map((row) => row.COLUMN_NAME));
    this.cache.set(table, cols);
    return cols;
  }

  async upsert(table, pk, record) {
    const available = await this.columns(table);
    const entries = Object.entries(record).filter(([key, value]) => available.has(key) && value !== undefined);
    if (!entries.some(([key]) => key === pk)) throw new Error(`MSSQL ${table}: missing primary key ${pk}`);
    if (entries.length === 0) return;
    const cols = entries.map(([key]) => key);
    const request = this.pool.request();
    entries.forEach(([, value], index) => request.input(`p${index}`, value));
    const source = cols.map((col, index) => `@p${index} AS ${quoteMssqlIdent(col)}`).join(", ");
    const updates = cols.filter((col) => col !== pk).map((col) => `t.${quoteMssqlIdent(col)}=s.${quoteMssqlIdent(col)}`);
    const sql = `MERGE ${quoteMssqlIdent(this.schema)}.${quoteMssqlIdent(table)} WITH (HOLDLOCK) AS t USING (SELECT ${source}) AS s ON t.${quoteMssqlIdent(pk)}=s.${quoteMssqlIdent(pk)} ${updates.length ? `WHEN MATCHED THEN UPDATE SET ${updates.join(", ")}` : ""} WHEN NOT MATCHED THEN INSERT (${cols.map(quoteMssqlIdent).join(", ")}) VALUES (${cols.map((col) => `s.${quoteMssqlIdent(col)}`).join(", ")});`;
    await request.query(sql);
  }

  async write(person) {
    await this.upsert("hotel_stays", "stay_id", {
      stay_id: `STAY-${person.guestId}-ACTIVE`,
      guest_id: person.guestId,
      player_id: person.playerId,
      passport_hash: person.passportHash,
      mobile_hash: person.mobileHash,
      loyalty_card_no: person.cardNo,
      checkin_at: person.created,
      checkout_at: new Date(person.created.getTime() + 18 * 60 * 60 * 1000),
      room_type: person.tier === "Diamond" ? "Executive Suite" : "Deluxe King",
      upgrade_eligible: person.risky ? 0 : Number(["Diamond", "Platinum"].includes(person.tier)),
      late_checkout_eligible: person.risky ? 0 : 1,
      status: "CheckedIn",
      updated_at: person.created,
    });
    await this.upsert("responsible_play_cases", "case_id", {
      case_id: person.risky ? `RPC-${person.playerId}-ACTIVE` : `RPC-${person.playerId}-CLOSED`,
      guest_id: person.guestId,
      player_id: person.playerId,
      risk_type: person.risky ? "ResponsiblePlayReview" : "None",
      risk_score: person.risky ? 92 : 12,
      status: person.risky ? "Active" : "Closed",
      reason: person.risky ? "High wager velocity and card-counter-watch behavior; block incentive offers." : "No active responsible play case.",
      created_at: person.created,
      updated_at: person.created,
    });
    if (!person.risky) {
      await this.closeActiveRiskForPlayer(person.playerId);
    }
    await this.upsert("host_assignments", "assignment_id", {
      assignment_id: `HA-${person.playerId}`,
      guest_id: person.guestId,
      player_id: person.playerId,
      pr_agent_id: person.risky ? "PR-012" : person.tier === "Diamond" ? "PR-007" : "PR-018",
      host_name: person.risky ? "Ivy Choi" : person.tier === "Diamond" ? "Marcus Lei" : "Ken Wong",
      case_id: person.risky ? `RPC-${person.playerId}-ACTIVE` : `CASE-${person.playerId}`,
      assignment_status: person.scenario === "host_overdue" ? "Overdue" : "Assigned",
      fit_score: person.risky ? 0.55 : 0.88,
      active: 1,
      assigned_at: person.created,
      sla_due_at: person.scenario === "host_overdue" ? new Date(person.created.getTime() - 10 * 60 * 1000) : new Date(person.created.getTime() + 90 * 60 * 1000),
      accepted_at: null,
      completed_at: null,
      updated_at: person.created,
    });
    if (person.risky) {
      await this.upsert("ops_patron_alerts", "alert_id", {
        alert_id: `ALERT-${person.playerId}-ACTIVE`,
        patron_source_player_id: person.playerId,
        guest_id: person.guestId,
        table_id: person.tableId,
        rule_id: "RULE-RISK-001",
        rule_name: "Responsible play review required",
        alert_title: "Responsible play review required",
        alert_message: "Active risk signal detected. Block incentive offers and notify administrator.",
        severity: "HIGH",
        status: "OPEN",
        alert_status: "OPEN",
        triggered_conditions_json: JSON.stringify({ riskScore: 92, behaviorTags: person.behaviorTags, tableId: person.tableId }),
        patron_snapshot_json: JSON.stringify({ playerId: person.playerId, guestId: person.guestId, tier: person.tier, sessionBetHkd: person.sessionBet }),
        table_snapshot_json: JSON.stringify({ tableId: person.tableId, zone: person.zone, game: person.preferredGame }),
        triggered_at: person.created,
        llm_rationale: "High wager velocity and sensitive behavior tags require administrator review before any offer can be sent.",
        created_at: person.created,
        closed_at: null,
      });
    }
  }

  async closeActiveRiskForPlayer(playerId) {
    const closeCase = this.pool.request();
    closeCase.input("playerId", String(playerId));
    await closeCase.query(
      `UPDATE ${quoteMssqlIdent(this.schema)}.${quoteMssqlIdent("responsible_play_cases")}
       SET status = 'Closed',
           risk_score = CASE WHEN risk_score > 20 THEN 20 ELSE risk_score END,
           reason = 'Risk signal cleared by source feeder normalization.',
           updated_at = SYSDATETIME()
       WHERE player_id = @playerId
         AND status = 'Active'`,
    );

    const closeAlert = this.pool.request();
    closeAlert.input("playerId", String(playerId));
    await closeAlert.query(
      `UPDATE ${quoteMssqlIdent(this.schema)}.${quoteMssqlIdent("ops_patron_alerts")}
       SET status = 'CLOSED'
       WHERE patron_source_player_id = @playerId
         AND status = 'OPEN'`,
    );
  }

  async retirePlayerRange(range) {
    if (!range) return;
    const closeCases = this.pool.request();
    closeCases.input("startPlayerId", String(range.start));
    closeCases.input("endPlayerId", String(range.end));
    await closeCases.query(
      `UPDATE ${quoteMssqlIdent(this.schema)}.${quoteMssqlIdent("responsible_play_cases")}
       SET status = 'Closed',
           risk_score = CASE WHEN risk_score > 20 THEN 20 ELSE risk_score END,
           updated_at = SYSDATETIME()
       WHERE TRY_CONVERT(INT, player_id) BETWEEN TRY_CONVERT(INT, @startPlayerId) AND TRY_CONVERT(INT, @endPlayerId)`,
    );

    const closeAlerts = this.pool.request();
    closeAlerts.input("startPlayerId", String(range.start));
    closeAlerts.input("endPlayerId", String(range.end));
    await closeAlerts.query(
      `UPDATE ${quoteMssqlIdent(this.schema)}.${quoteMssqlIdent("ops_patron_alerts")}
       SET status = 'CLOSED'
       WHERE TRY_CONVERT(INT, patron_source_player_id) BETWEEN TRY_CONVERT(INT, @startPlayerId) AND TRY_CONVERT(INT, @endPlayerId)`,
    );
    console.log(`Closed MSSQL risk cases and alerts for player range ${range.start}-${range.end}.`);
  }

  async close() {
    await this.pool?.close();
  }
}

async function connectSinks() {
  const sources = [
    ["PostgreSQL_Loyalty_CRM", PgSink, PgSink.enabled()],
    ["Oracle_Gaming_Core", OracleSink, OracleSink.enabled()],
    ["MSSQL_Hotel_Ops", MssqlSink, MssqlSink.enabled()],
  ];
  const missing = sources.filter(([, , enabled]) => !enabled).map(([name]) => name);
  if (!allowPartial && missing.length > 0) {
    throw new Error(`Source feeder expects all three sources by default. Missing configuration for: ${missing.join(", ")}. Set FEEDER_ALLOW_PARTIAL=true or pass --allow-partial for one-source testing.`);
  }
  const sinks = sources
    .filter(([, , enabled]) => enabled)
    .map(([name, Sink]) => {
      const sink = new Sink();
      sink.sourceName = name;
      return sink;
    });
  if (sinks.length === 0 && !dryRun) {
    throw new Error("No source database is configured. Copy .env.source-feeder.example to .env.source-feeder and fill at least one source connection.");
  }
  if (missing.length > 0) {
    console.warn(`Partial source mode: missing ${missing.join(", ")}.`);
  }
  for (const sink of sinks) {
    try {
      console.log(`Connecting ${sink.sourceName}...`);
      await sink.connect();
      console.log(`Connected ${sink.sourceName}.`);
    } catch (error) {
      throw new Error(`${sink.sourceName} connect failed: ${error.message}`);
    }
  }
  return sinks;
}

async function maintainRiskRatio(sinks) {
  const oracleSink = sinks.find((sink) => sink instanceof OracleSink);
  const mssqlSink = sinks.find((sink) => sink instanceof MssqlSink);
  const pgSink = sinks.find((sink) => sink instanceof PgSink);
  if (!oracleSink || !mssqlSink) return;

  const activeResult = await oracleSink.connection.execute(
    `SELECT PLAYER_ID
     FROM GAMING_TABLE_SESSIONS
     WHERE IS_ACTIVE = 1
       AND REGEXP_LIKE(PLAYER_ID, '^[0-9]+$')
       AND TO_NUMBER(PLAYER_ID) BETWEEN :managedPlayerStart AND :managedPlayerEnd`,
    { managedPlayerStart, managedPlayerEnd },
    { outFormat: oracleSink.oracledb.OUT_FORMAT_OBJECT },
  );
  const activePlayers = activeResult.rows.map((row) => String(row.PLAYER_ID));
  if (activePlayers.length === 0) return;

  const targetRiskCount = Math.max(1, Math.round(activePlayers.length * 0.02));
  const activeSet = new Set(activePlayers);
  const riskRows = (
    await mssqlSink.pool
      .request()
      .query(
        `SELECT case_id, player_id, risk_score, updated_at
         FROM ${quoteMssqlIdent(mssqlSink.schema)}.${quoteMssqlIdent("responsible_play_cases")}
         WHERE UPPER(status) = 'ACTIVE'
           AND TRY_CONVERT(INT, player_id) BETWEEN ${managedPlayerStart} AND ${managedPlayerEnd}`,
      )
  ).recordset;

  const activeRiskRows = riskRows.filter((row) => activeSet.has(String(row.player_id)));
  const keepPlayers = activeRiskRows
    .sort((left, right) => Number(right.risk_score || 0) - Number(left.risk_score || 0) || String(right.updated_at || "").localeCompare(String(left.updated_at || "")))
    .slice(0, targetRiskCount)
    .map((row) => String(row.player_id));
  const keepSet = new Set(keepPlayers);
  const closePlayers = riskRows.map((row) => String(row.player_id)).filter((playerId) => !keepSet.has(playerId));
  if (closePlayers.length === 0) return;

  const closeCaseRequest = mssqlSink.pool.request();
  closePlayers.forEach((playerId, index) => closeCaseRequest.input(`p${index}`, playerId));
  const closeParams = closePlayers.map((_, index) => `@p${index}`).join(",");
  await closeCaseRequest.query(
    `UPDATE ${quoteMssqlIdent(mssqlSink.schema)}.${quoteMssqlIdent("responsible_play_cases")}
     SET status = 'Closed',
         risk_score = CASE WHEN risk_score > 20 THEN 20 ELSE risk_score END,
         reason = 'Demo risk ratio guardrail: keep active floor risk near 2 percent.',
         updated_at = SYSDATETIME()
     WHERE player_id IN (${closeParams})
       AND UPPER(status) = 'ACTIVE'`,
  );

  const closeAlertRequest = mssqlSink.pool.request();
  closePlayers.forEach((playerId, index) => closeAlertRequest.input(`p${index}`, playerId));
  await closeAlertRequest.query(
    `UPDATE ${quoteMssqlIdent(mssqlSink.schema)}.${quoteMssqlIdent("ops_patron_alerts")}
     SET status = 'CLOSED'
     WHERE patron_source_player_id IN (${closeParams})
       AND UPPER(status) = 'OPEN'`,
  );

  if (pgSink) {
    await pgSink.ensureConnected();
    await pgSink.client.query(
      `UPDATE ${quotePgIdent(pgSink.schema)}.${quotePgIdent("crm_patron_profiles")}
       SET risk_flags = ARRAY[]::text[],
           updated_at = now()
       WHERE customer_id = ANY($1::text[])`,
      [closePlayers.map((playerId) => `C${playerId}`)],
    );
  }

  const oracleBinds = Object.fromEntries(closePlayers.map((playerId, index) => [`p${index}`, playerId]));
  const oracleParams = closePlayers.map((_, index) => `:p${index}`).join(",");
  await oracleSink.connection.execute(
    `UPDATE GAMING_TABLE_SESSIONS
     SET BEHAVIOR_TAGS = 'Steady,PromoSeeker',
         LAST_ACTION_AT = CURRENT_TIMESTAMP
     WHERE PLAYER_ID IN (${oracleParams})
       AND IS_ACTIVE = 1`,
    oracleBinds,
    { autoCommit: false },
  );
  await oracleSink.connection.commit();
  console.log(`Risk guardrail normalized active risks: target=${targetRiskCount}, closed=${closePlayers.length}.`);
}

function printPlan(person) {
  console.log(
    `[${new Date().toLocaleTimeString()}] ${person.scenario} ${person.masterPlayerId} ` +
      `Oracle:${person.playerId} MSSQL:${person.guestId} PG:${person.customerId}/${person.posMemberNo} ` +
      `${person.active ? `active@${person.tableId}` : "inactive"} ${person.risky ? "RISK" : "OK"}`,
  );
}

let seq = Number(valueArg("--seq") || 1);
let stopped = false;

process.on("SIGINT", () => {
  stopped = true;
  console.log("\nStopping source feeder...");
});

async function main() {
  const durationMs = durationHours > 0 ? durationHours * 60 * 60 * 1000 : 0;
  const stopAt = durationMs > 0 ? Date.now() + durationMs : 0;
  console.log(
    `Real-time source feeder starting. scenario=${scenarioArg}, interval=${intervalMs}ms, ` +
      `batchSize=${batchSize}, poolSize=${poolSize || "unbounded"}, activeLimit=${activePatronLimit}, durationHours=${durationHours || "unbounded"}, ` +
      `dryRun=${dryRun}, maxEvents=${maxEvents || "unbounded"}`,
  );
  const sinks = dryRun ? [] : await connectSinks();
  const rangeToRetire = parseNumberRange(retirePlayerRange);
  if (rangeToRetire) {
    console.log(`Retiring previous demo activity for player range ${rangeToRetire.start}-${rangeToRetire.end}...`);
    for (const sink of sinks) {
      await sink.retirePlayerRange(rangeToRetire);
    }
  }
  let writtenEvents = 0;
  try {
    do {
      for (let batchIndex = 0; batchIndex < batchSize; batchIndex += 1) {
        const person = buildPerson(seq++);
        printPlan(person);
        if (!dryRun) {
          for (const sink of sinks) {
            try {
              await sink.write(person);
              console.log(`Wrote ${sink.sourceName}.`);
            } catch (error) {
              if (typeof sink.reconnect === "function") {
                console.warn(`${sink.sourceName} write failed once, reconnecting and retrying: ${error.message}`);
                await sink.reconnect();
                await sink.write(person);
                console.log(`Wrote ${sink.sourceName} after reconnect.`);
              } else {
                throw new Error(`${sink.sourceName} write failed: ${error.message}`);
              }
            }
          }
          for (const sink of sinks) {
            if (sink.connection?.commit) await sink.connection.commit();
          }
        }
        writtenEvents += 1;
        if (!dryRun && writtenEvents % 10 === 0) {
          await maintainRiskRatio(sinks);
        }
        if (maxEvents > 0 && writtenEvents >= maxEvents) {
          console.log(`Reached maxEvents=${maxEvents}. Stopping source feeder.`);
          break;
        }
      }
      if (maxEvents > 0 && writtenEvents >= maxEvents) {
        break;
      }
      if (stopAt > 0 && Date.now() >= stopAt) {
        console.log(`Reached durationHours=${durationHours}. Stopping source feeder.`);
        break;
      }
      if (!once && !stopped) await new Promise((resolveSleep) => setTimeout(resolveSleep, intervalMs));
    } while (!once && !stopped);
  } finally {
    for (const sink of sinks.reverse()) await sink.close();
  }
}

main().catch((error) => {
  console.error(`Source feeder failed: ${error.message}`);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 250);
});
