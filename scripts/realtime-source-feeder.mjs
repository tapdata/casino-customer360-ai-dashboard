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
const intervalMs = Number(valueArg("--interval") || process.env.FEEDER_INTERVAL_MS || 3000);
const startPlayerId = Number(valueArg("--start-player-id") || process.env.FEEDER_START_PLAYER_ID || 105000);
const maxEvents = Number(valueArg("--max-events") || process.env.FEEDER_MAX_EVENTS || 0);
const durationHours = Number(valueArg("--duration-hours") || process.env.FEEDER_DURATION_HOURS || 0);
const batchSize = Math.max(1, Number(valueArg("--batch-size") || process.env.FEEDER_BATCH_SIZE || 1));
const poolSize = Math.max(0, Number(valueArg("--pool-size") || process.env.FEEDER_POOL_SIZE || 0));
const retirePlayerRange = valueArg("--retire-player-range") || process.env.FEEDER_RETIRE_PLAYER_RANGE || "";
const allowPartial = args.has("--allow-partial") || process.env.FEEDER_ALLOW_PARTIAL === "true";

const floorTables = [
  ["T-0001", "A", "POK", 9, 800],
  ["T-0002", "B", "BLA", 9, 500],
  ["T-0003", "A", "ROU", 9, 1000],
  ["T-0004", "B", "BAC", 9, 1000],
  ["T-0005", "C", "SIC", 9, 300],
  ["T-0006", "C", "BLA", 9, 800],
  ["T-0007", "A", "SIC", 9, 800],
  ["T-0008", "B", "ROU", 9, 300],
  ["T-0009", "A", "BAC", 9, 500],
  ["T-0010", "A", "ROU", 9, 500],
  ["T-0011", "VIP", "BAC", 8, 3000],
  ["T-0012", "C", "BLA", 9, 1000],
  ["T-0013", "B", "ROU", 9, 500],
  ["T-0014", "B", "BLA", 9, 500],
  ["T-0015", "VIP", "BAC", 8, 5000],
  ["T-0016", "A", "POK", 9, 1000],
  ["T-0017", "C", "SIC", 9, 300],
  ["T-0018", "VIP", "POK", 8, 1000],
  ["T-0019", "C", "BLA", 9, 800],
  ["T-0020", "B", "BAC", 9, 1000],
  ["T-0021", "B", "POK", 9, 800],
  ["T-0022", "C", "ROU", 9, 300],
  ["T-0023", "VIP", "ROU", 8, 1000],
  ["T-0024", "A", "SIC", 9, 300],
  ["T-0025", "B", "BAC", 9, 500],
  ["T-0026", "VIP", "BAC", 8, 300],
  ["T-0027", "A", "POK", 9, 1000],
  ["T-0028", "C", "ROU", 9, 300],
  ["T-0029", "B", "SIC", 9, 500],
  ["T-0030", "B", "BLA", 9, 300],
];

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

function scenarioFor(seq) {
  if (scenarioArg !== "mixed") return scenarioArg;
  const bucket = seq % 100;
  if (bucket < 48) return "normal";
  if (bucket < 66) return "high_value_return";
  if (bucket < 78) return "offer_fatigue";
  if (bucket < 88) return "host_overdue";
  if (bucket < 94) return "risk";
  return "inactive";
}

function tableFor(playerOrdinal, scenario) {
  if (scenario === "high_value_return") {
    return floorTables.find(([tableId]) => ["T-0011", "T-0015", "T-0018", "T-0023", "T-0026"].includes(tableId)) || floorTables[0];
  }
  if (scenario === "risk") {
    return floorTables.find(([tableId]) => ["T-0014", "T-0019", "T-0028"].includes(tableId)) || floorTables[0];
  }
  const index = (playerOrdinal * 7 + Math.floor(playerOrdinal / 5)) % floorTables.length;
  return floorTables[index];
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
  const active = scenario !== "inactive";
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
    tablePatronCount: active ? Math.min(capacity, 2 + ((playerOrdinal + seq) % Math.max(capacity - 1, 1))) : 0,
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
    await this.client.query(`SET search_path TO ${quotePgIdent(this.schema)}`);
  }

  async columns(table) {
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
        rule_id: "RULE-RISK-001",
        alert_title: "Responsible play review required",
        alert_message: "Active risk signal detected. Block incentive offers and notify administrator.",
        severity: "HIGH",
        alert_status: "OPEN",
        created_at: person.created,
        closed_at: null,
      });
    }
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
       SET alert_status = 'CLOSED',
           closed_at = COALESCE(closed_at, SYSDATETIME())
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
      `batchSize=${batchSize}, poolSize=${poolSize || "unbounded"}, durationHours=${durationHours || "unbounded"}, ` +
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
              throw new Error(`${sink.sourceName} write failed: ${error.message}`);
            }
          }
          for (const sink of sinks) {
            if (sink.connection?.commit) await sink.connection.commit();
          }
        }
        writtenEvents += 1;
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
