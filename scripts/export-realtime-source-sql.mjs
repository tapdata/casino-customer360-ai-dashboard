#!/usr/bin/env node

/**
 * Export the bootstrap DDL/data used by scripts/realtime-source-feeder.mjs.
 *
 * This file intentionally contains no connection information.  It only emits
 * portable, repeatable bootstrap SQL for the three relational source systems.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outputDir = resolve(process.argv[2] || "artifacts/three-source-sql");
mkdirSync(outputDir, { recursive: true });

const q = (value) => String(value).replaceAll("'", "''");
const ora = (value) => `'${q(value)}'`;
const oraRaw = (value) => ({ raw: value });
const ms = (value) => `N'${q(value)}'`;
const pg = (value) => `'${q(value)}'`;
const date = "2026-10-15 10:00:00";
const iso = "2026-10-15T10:00:00+08:00";

const tables = [
  ["T-0001", "A", "POK", 25, 800], ["T-0002", "B", "BLA", 25, 500],
  ["T-0003", "A", "ROU", 25, 1000], ["T-0004", "B", "BAC", 25, 1000],
  ["T-0005", "C", "SIC", 25, 300], ["T-0006", "C", "BLA", 25, 800],
  ["T-0007", "A", "SIC", 25, 800], ["T-0008", "B", "ROU", 25, 300],
  ["T-0009", "A", "BAC", 25, 500], ["T-0010", "A", "ROU", 25, 500],
  ["T-0011", "VIP", "BAC", 25, 3000], ["T-0012", "C", "BLA", 25, 1000],
  ["T-0013", "B", "ROU", 25, 500], ["T-0014", "B", "BLA", 25, 500],
  ["T-0015", "VIP", "BAC", 25, 5000], ["T-0016", "A", "POK", 25, 1000],
  ["T-0017", "C", "SIC", 25, 300], ["T-0018", "VIP", "POK", 25, 1000],
  ["T-0019", "C", "BLA", 25, 800], ["T-0020", "B", "BAC", 25, 1000],
  ["T-0021", "B", "POK", 25, 800], ["T-0022", "C", "ROU", 25, 300],
  ["T-0023", "A", "BAC", 25, 800], ["T-0024", "B", "SIC", 25, 300],
  ["T-0025", "C", "POK", 25, 500], ["T-0026", "VIP", "BAC", 25, 5000],
  ["T-0027", "A", "BLA", 25, 800], ["T-0028", "B", "ROU", 25, 800],
  ["T-0029", "C", "SIC", 25, 300], ["T-0030", "VIP", "BAC", 25, 3000],
];

const people = [
  { id: "105001", master: "P0000105001", customer: "C105001", guest: "H105001", card: "CARD-105001", name: "Ava Chan", tier: "Diamond", region: "Macau", game: "BAC", table: "T-0004", zone: "B", bet: 72400, stack: 44400, active: 1, risk: 0, seq: 1 },
  { id: "105002", master: "P0000105002", customer: "C105002", guest: "H105002", card: "CARD-105002", name: "Lucas Ho", tier: "Platinum", region: "Hong Kong", game: "BLA", table: "T-0002", zone: "B", bet: 18400, stack: 42400, active: 1, risk: 0, seq: 2 },
  { id: "105003", master: "P0000105003", customer: "C105003", guest: "H105003", card: "CARD-105003", name: "Mia Wong", tier: "Gold", region: "Singapore", game: "ROU", table: "T-0003", zone: "A", bet: 18660, stack: 42600, active: 1, risk: 0, seq: 3 },
  { id: "105004", master: "P0000105004", customer: "C105004", guest: "H105004", card: "CARD-105004", name: "Ethan Lei", tier: "Platinum", region: "Taiwan", game: "BAC", table: "T-0011", zone: "VIP", bet: 97500, stack: 12300, active: 1, risk: 1, seq: 4 },
  { id: "105005", master: "P0000105005", customer: "C105005", guest: "H105005", card: "CARD-105005", name: "Nora Wu", tier: "Silver", region: "Mainland China", game: "POK", table: "T-0001", zone: "A", bet: 0, stack: 42000, active: 0, risk: 0, seq: 5 },
];

const tags = (p) => p.risk ? "Aggressive,LateNight,CardCounterWatch" : "Steady,PromoSeeker";
const benefits = (p) => p.risk ? ["HostCare"] : p.tier === "Diamond" ? ["SuiteUpgrade", "LateCheckout", "FineDining"] : ["Dining", "Points"];
const gameName = (code) => ({ BAC: "Baccarat", BLA: "Blackjack", ROU: "Roulette", POK: "Poker", SIC: "Sic Bo" }[code] || code);
const tierCode = (tier) => tier.slice(0, 3).toUpperCase();

function oracleMerge(table, pk, row) {
  const keys = Object.keys(row);
  const literal = (value) => value && typeof value === "object" && "raw" in value ? value.raw : typeof value === "number" ? String(value) : ora(value);
  const binds = keys.map((key) => `${literal(row[key])} ${key}`).join(", ");
  const updates = keys.filter((key) => key !== pk).map((key) => `t.${key}=s.${key}`).join(", ");
  return `MERGE INTO ${table} t USING (SELECT ${binds} FROM dual) s ON (t.${pk}=s.${pk}) WHEN MATCHED THEN UPDATE SET ${updates} WHEN NOT MATCHED THEN INSERT (${keys.join(", ")}) VALUES (${keys.map((key) => `s.${key}`).join(", ")});`;
}

function writeOracle() {
  const lines = [
    "-- Bootstrap for scripts/realtime-source-feeder.mjs (Oracle source)",
    "-- Target: schema C##GAMING on the ORCL service.",
    "-- The MERGE statements are repeatable and safe to run before the feeder.",
    "ALTER SESSION SET CURRENT_SCHEMA = C##GAMING;",
    "",
  ];
  const ddl = [
    "CREATE TABLE GAMING_PLAYER_ACCOUNT (PLAYER_ID VARCHAR2(32) PRIMARY KEY, CASINO_CARD_NO VARCHAR2(64), FULL_NAME VARCHAR2(120), PASSPORT_HASH VARCHAR2(128), MOBILE_HASH VARCHAR2(128), ACCOUNT_STATUS VARCHAR2(32), CREATED_AT TIMESTAMP)",
    "CREATE TABLE GAMING_PLAYER_RATINGS (RATING_ID VARCHAR2(64) PRIMARY KEY, PLAYER_ID VARCHAR2(32), ADT_AMOUNT NUMBER(18,2), THEO_WIN_AMOUNT NUMBER(18,2), LAST_VISIT_AT TIMESTAMP, PREFERRED_GAME_CODE VARCHAR2(32), RATING_TIER_CODE VARCHAR2(32), UPDATED_AT TIMESTAMP)",
    "CREATE TABLE GAMING_TABLE_STATE (TABLE_ID VARCHAR2(32) PRIMARY KEY, TABLE_NAME VARCHAR2(64), ZONE_CODE VARCHAR2(32), GAME_CODE VARCHAR2(32), CAPACITY NUMBER(10), PATRON_COUNT NUMBER(10), MIN_BET_HKD NUMBER(18,2), MAX_BET_HKD NUMBER(18,2), AVG_BET_HKD NUMBER(18,2), TABLE_STATUS VARCHAR2(32), REFRESHED_AT TIMESTAMP)",
    "CREATE TABLE GAMING_TABLE_STATE_HISTORY (HISTORY_ID VARCHAR2(64) PRIMARY KEY, TABLE_ID VARCHAR2(32), TABLE_NAME VARCHAR2(64), ZONE_CODE VARCHAR2(32), GAME_CODE VARCHAR2(32), CAPACITY NUMBER(10), PATRON_COUNT NUMBER(10), MIN_BET_HKD NUMBER(18,2), MAX_BET_HKD NUMBER(18,2), AVG_BET_HKD NUMBER(18,2), TABLE_STATUS VARCHAR2(32), REFRESHED_AT TIMESTAMP)",
    "CREATE TABLE GAMING_TABLE_SESSIONS (SESSION_ID VARCHAR2(64) PRIMARY KEY, PLAYER_ID VARCHAR2(32), TABLE_ID VARCHAR2(32), SEATED_AT TIMESTAMP, LAST_ACTION_AT TIMESTAMP, SESSION_BET_HKD NUMBER(18,2), PREVIOUS_BET_HKD NUMBER(18,2), CURRENT_STACK_HKD NUMBER(18,2), BEHAVIOR_TAGS VARCHAR2(200), IS_ACTIVE NUMBER(1))",
    "CREATE TABLE GAMING_PLAYER_ROUND_BETS (ROUND_BET_ID VARCHAR2(64) PRIMARY KEY, TABLE_ID VARCHAR2(32), ROUND_NUMBER NUMBER(18), PLAYER_ID VARCHAR2(32), BET_AMOUNT_HKD NUMBER(18,2), BEHAVIOR_TAGS VARCHAR2(200), RECORDED_AT TIMESTAMP)",
    "CREATE TABLE GAMING_TABLE_ROUND_COUNTERS (COUNTER_ID VARCHAR2(64) PRIMARY KEY, TABLE_ID VARCHAR2(32), BUSINESS_DATE DATE, ROUND_NUMBER NUMBER(18), UPDATED_AT TIMESTAMP)",
  ];
  for (const statement of ddl) lines.push(`BEGIN EXECUTE IMMEDIATE '${q(statement)}'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;\n/`);
  for (const p of people) {
    const adt = p.tier === "Diamond" ? 58120 : p.tier === "Platinum" ? 36180 : p.tier === "Gold" ? 24210 : 12250;
    lines.push(oracleMerge("GAMING_PLAYER_ACCOUNT", "PLAYER_ID", { PLAYER_ID: p.id, CASINO_CARD_NO: p.card, FULL_NAME: p.name, PASSPORT_HASH: `PASS-DEMO-${p.id}`, MOBILE_HASH: `MOB-DEMO-${p.id}`, ACCOUNT_STATUS: "ACTIVE", CREATED_AT: oraRaw(`TIMESTAMP '${date}'`) }));
    lines.push(oracleMerge("GAMING_PLAYER_RATINGS", "RATING_ID", { RATING_ID: `R-${p.id}`, PLAYER_ID: p.id, ADT_AMOUNT: adt, THEO_WIN_AMOUNT: Math.round(adt * 3.2), LAST_VISIT_AT: oraRaw(`TIMESTAMP '${date}'`), PREFERRED_GAME_CODE: p.game, RATING_TIER_CODE: tierCode(p.tier), UPDATED_AT: oraRaw(`TIMESTAMP '${date}'`) }));
    lines.push(oracleMerge("GAMING_TABLE_SESSIONS", "SESSION_ID", { SESSION_ID: `LIVE-S-${p.id}`, PLAYER_ID: p.id, TABLE_ID: p.table, SEATED_AT: oraRaw("TIMESTAMP '2026-10-15 09:42:00'"), LAST_ACTION_AT: oraRaw(`TIMESTAMP '${date}'`), SESSION_BET_HKD: p.active ? p.bet : 0, PREVIOUS_BET_HKD: Math.round(p.bet * 0.68), CURRENT_STACK_HKD: p.stack, BEHAVIOR_TAGS: tags(p), IS_ACTIVE: p.active }));
    if (p.active) {
      lines.push(oracleMerge("GAMING_PLAYER_ROUND_BETS", "ROUND_BET_ID", { ROUND_BET_ID: `RB-${p.id}-${p.seq}`, TABLE_ID: p.table, ROUND_NUMBER: 1000 + p.seq, PLAYER_ID: p.id, BET_AMOUNT_HKD: Math.round(p.bet / 10), BEHAVIOR_TAGS: tags(p), RECORDED_AT: oraRaw(`TIMESTAMP '${date}'`) }));
    }
  }
  for (const [tableId, zone, game, capacity, minBet] of tables) {
    const active = people.filter((p) => p.table === tableId && p.active).length;
    lines.push(oracleMerge("GAMING_TABLE_STATE", "TABLE_ID", { TABLE_ID: tableId, TABLE_NAME: `Table ${Number(tableId.slice(2))}`, ZONE_CODE: zone, GAME_CODE: game, CAPACITY: capacity, PATRON_COUNT: active, MIN_BET_HKD: minBet, MAX_BET_HKD: zone === "VIP" ? 200000 : 80000, AVG_BET_HKD: active ? Math.round(people.filter((p) => p.table === tableId && p.active).reduce((sum, p) => sum + p.bet, 0) / active) : minBet, TABLE_STATUS: "OPEN", REFRESHED_AT: oraRaw(`TIMESTAMP '${date}'`) }));
    lines.push(oracleMerge("GAMING_TABLE_STATE_HISTORY", "HISTORY_ID", { HISTORY_ID: `TSH-${tableId}-INIT`, TABLE_ID: tableId, TABLE_NAME: `Table ${Number(tableId.slice(2))}`, ZONE_CODE: zone, GAME_CODE: game, CAPACITY: capacity, PATRON_COUNT: active, MIN_BET_HKD: minBet, MAX_BET_HKD: zone === "VIP" ? 200000 : 80000, AVG_BET_HKD: minBet, TABLE_STATUS: "OPEN", REFRESHED_AT: oraRaw(`TIMESTAMP '${date}'`) }));
    lines.push(oracleMerge("GAMING_TABLE_ROUND_COUNTERS", "COUNTER_ID", { COUNTER_ID: `CTR-${tableId}-20261015`, TABLE_ID: tableId, BUSINESS_DATE: oraRaw("DATE '2026-10-15'"), ROUND_NUMBER: 1000, UPDATED_AT: oraRaw(`TIMESTAMP '${date}'`) }));
  }
  lines.push("COMMIT;", "");
  writeFileSync(resolve(outputDir, "oracle_c##gaming_realtime_bootstrap.sql"), lines.join("\n"));
}

function pgLiteral(value) {
  if (value === null) return "NULL";
  if (Array.isArray(value)) return value.length ? `ARRAY[${value.map(pg).join(", ")}]` : "ARRAY[]::text[]";
  if (typeof value === "object") return `${pg(JSON.stringify(value))}::jsonb`;
  if (typeof value === "number") return String(value);
  return pg(value);
}
function pgUpsert(table, pk, row) {
  const keys = Object.keys(row);
  return `INSERT INTO casino_loyalty.${table} (${keys.join(", ")}) VALUES (${keys.map((key) => pgLiteral(row[key])).join(", ")}) ON CONFLICT (${pk}) DO UPDATE SET ${keys.filter((key) => key !== pk).map((key) => `${key}=EXCLUDED.${key}`).join(", ")};`;
}
function writePostgres() {
  const lines = [
    "-- Bootstrap for scripts/realtime-source-feeder.mjs (PostgreSQL source)",
    "-- Target: database postgres, schema casino_loyalty.",
    "CREATE SCHEMA IF NOT EXISTS casino_loyalty;",
    "SET search_path TO casino_loyalty;",
    "",
    "CREATE TABLE IF NOT EXISTS crm_identity_links (master_player_id TEXT PRIMARY KEY, gaming_player_id TEXT, hotel_guest_id TEXT, pos_member_no TEXT, crm_customer_id TEXT, casino_card_no TEXT, passport_hash TEXT, mobile_hash TEXT, identity_confidence NUMERIC(5,2), identity_status TEXT, updated_at TIMESTAMPTZ);",
    "CREATE TABLE IF NOT EXISTS crm_patron_profiles (customer_id TEXT PRIMARY KEY, master_player_id TEXT, name TEXT, masked_name TEXT, tier TEXT, region TEXT, adt NUMERIC(18,2), points_balance INT, preferred_games TEXT[], preferred_benefits TEXT[], risk_flags TEXT[], last_active_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, last_hotel_benefit_at TIMESTAMPTZ);",
    "CREATE TABLE IF NOT EXISTS app_activity_events (event_id TEXT PRIMARY KEY, customer_id TEXT, activity_type TEXT, source TEXT, amount NUMERIC(18,2), points_delta INT, metadata JSONB, event_time TIMESTAMPTZ);",
    "CREATE TABLE IF NOT EXISTS pos_fnb_checks (check_id TEXT PRIMARY KEY, member_no TEXT, outlet_name TEXT, category TEXT, amount_hkd NUMERIC(18,2), preference_tag TEXT, check_time TIMESTAMPTZ);",
    "CREATE TABLE IF NOT EXISTS crm_offer_responses (response_id TEXT PRIMARY KEY, customer_id TEXT, offer_category TEXT, channel TEXT, outcome TEXT, responded_at TIMESTAMPTZ);",
    "",
  ];
  for (const p of people) {
    const isRisk = p.risk === 1;
    lines.push(pgUpsert("crm_identity_links", "master_player_id", { master_player_id: p.master, gaming_player_id: p.id, hotel_guest_id: p.guest, pos_member_no: `VIP${p.id}`, crm_customer_id: p.customer, casino_card_no: p.card, passport_hash: `PASS-DEMO-${p.id}`, mobile_hash: `MOB-DEMO-${p.id}`, identity_confidence: 0.98, identity_status: "VERIFIED", updated_at: iso }));
    lines.push(pgUpsert("crm_patron_profiles", "customer_id", { customer_id: p.customer, master_player_id: p.master, name: p.name, masked_name: `${p.name.slice(0, 1)}***${p.name.slice(-1)}`, tier: p.tier, region: p.region, adt: p.tier === "Diamond" ? 58120 : p.tier === "Platinum" ? 36180 : p.tier === "Gold" ? 24210 : 12250, points_balance: 314000 + p.seq * 1200, preferred_games: [gameName(p.game)], preferred_benefits: benefits(p), risk_flags: isRisk ? ["ResponsiblePlayReview"] : [], last_active_at: p.active ? iso : "2026-09-25T10:00:00+08:00", created_at: iso, updated_at: iso, last_hotel_benefit_at: isRisk ? null : "2026-10-08T10:00:00+08:00" }));
    lines.push(pgUpsert("app_activity_events", "event_id", { event_id: `APP-${p.customer}-${p.seq}`, customer_id: p.customer, activity_type: isRisk ? "RESPONSIBLE_PLAY_INFO_VIEW" : "APP_VIEW", source: "mobile_app", amount: isRisk ? 0 : 120, points_delta: isRisk ? 0 : 200, metadata: { channel: "AppPush", isVip: ["Diamond", "Platinum"].includes(p.tier), venue: benefits(p)[0], scenario: isRisk ? "risk" : "mixed" }, event_time: iso }));
    lines.push(pgUpsert("pos_fnb_checks", "check_id", { check_id: `FNB-${p.id}-${p.seq}`, member_no: `VIP${p.id}`, outlet_name: isRisk ? "VIP Lounge" : "Robuchon Macau", category: isRisk ? "Lounge" : "FineDining", amount_hkd: isRisk ? 0 : 980 + p.seq * 20, preference_tag: isRisk ? "HostCare" : "FineDiningInterest", check_time: iso }));
    lines.push(pgUpsert("crm_offer_responses", "response_id", { response_id: `OR-${p.customer}-${p.seq}`, customer_id: p.customer, offer_category: isRisk ? "ResponsiblePlay" : benefits(p)[0], channel: "WhatsApp", outcome: isRisk ? "Suppressed" : "Viewed", responded_at: iso }));
  }
  lines.push("COMMIT;", "");
  writeFileSync(resolve(outputDir, "postgres_casino_loyalty_realtime_bootstrap.sql"), lines.join("\n"));
}

function msLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") return ms(JSON.stringify(value));
  return ms(value);
}
function msMerge(table, pk, row) {
  const keys = Object.keys(row);
  const values = keys.map((key) => msLiteral(row[key])).join(", ");
  const updates = keys.filter((key) => key !== pk).map((key) => `target.[${key}]=source.[${key}]`).join(", ");
  return `MERGE dbo.[${table}] AS target USING (VALUES (${values})) AS source (${keys.map((key) => `[${key}]`).join(", ")}) ON target.[${pk}]=source.[${pk}] WHEN MATCHED THEN UPDATE SET ${updates} WHEN NOT MATCHED THEN INSERT (${keys.map((key) => `[${key}]`).join(", ")}) VALUES (${keys.map((key) => `source.[${key}]`).join(", ")});\nGO`;
}
function writeMssql() {
  const lines = [
    "-- Bootstrap for scripts/realtime-source-feeder.mjs (Microsoft SQL Server source)",
    "-- Target: database casino_ops, schema dbo, SQL Server port is configured outside this file.",
    "USE [casino_ops];",
    "GO",
  ];
  const ddl = [
    "IF OBJECT_ID(N'dbo.hotel_stays', N'U') IS NULL CREATE TABLE dbo.hotel_stays (stay_id NVARCHAR(64) NOT NULL PRIMARY KEY, guest_id NVARCHAR(64) NULL, player_id NVARCHAR(64) NULL, passport_hash NVARCHAR(128) NULL, mobile_hash NVARCHAR(128) NULL, loyalty_card_no NVARCHAR(64) NULL, checkin_at DATETIME2 NULL, checkout_at DATETIME2 NULL, check_in_at DATETIME2 NULL, planned_check_out_at DATETIME2 NULL, room_type NVARCHAR(64) NULL, upgrade_eligible BIT NULL, late_checkout_eligible BIT NULL, status NVARCHAR(32) NULL, stay_status NVARCHAR(32) NULL, updated_at DATETIME2 NULL);",
    "IF OBJECT_ID(N'dbo.responsible_play_cases', N'U') IS NULL CREATE TABLE dbo.responsible_play_cases (case_id NVARCHAR(64) NOT NULL PRIMARY KEY, guest_id NVARCHAR(64) NULL, player_id NVARCHAR(64) NULL, table_id NVARCHAR(64) NULL, risk_type NVARCHAR(64) NULL, risk_score INT NULL, status NVARCHAR(32) NULL, reason NVARCHAR(500) NULL, created_at DATETIME2 NULL, updated_at DATETIME2 NULL);",
    "IF OBJECT_ID(N'dbo.host_assignments', N'U') IS NULL CREATE TABLE dbo.host_assignments (assignment_id NVARCHAR(64) NOT NULL PRIMARY KEY, guest_id NVARCHAR(64) NULL, player_id NVARCHAR(64) NULL, pr_agent_id NVARCHAR(64) NULL, host_id NVARCHAR(64) NULL, host_name NVARCHAR(120) NULL, case_id NVARCHAR(64) NULL, assignment_status NVARCHAR(32) NULL, status NVARCHAR(32) NULL, fit_score DECIMAL(6,2) NULL, active BIT NULL, last_contact_at DATETIME2 NULL, sla_due_at DATETIME2 NULL, assigned_at DATETIME2 NULL, accepted_at DATETIME2 NULL, completed_at DATETIME2 NULL, updated_at DATETIME2 NULL);",
    "IF OBJECT_ID(N'dbo.room_inventory', N'U') IS NULL CREATE TABLE dbo.room_inventory (inventory_id NVARCHAR(64) NOT NULL PRIMARY KEY, room_type NVARCHAR(64) NULL, available_count INT NULL, upgrade_cost_hkd DECIMAL(18,2) NULL, business_date DATE NULL, updated_at DATETIME2 NULL);",
    "IF OBJECT_ID(N'dbo.pr_agent_profiles', N'U') IS NULL CREATE TABLE dbo.pr_agent_profiles (pr_agent_id NVARCHAR(64) NOT NULL PRIMARY KEY, agent_name NVARCHAR(120) NULL, preferred_languages NVARCHAR(300) NULL, preferred_tiers NVARCHAR(300) NULL, preferred_games NVARCHAR(300) NULL, specialty_tags NVARCHAR(300) NULL, max_active_patrons INT NULL, current_active_patrons INT NULL, active BIT NULL, last_assigned_at DATETIME2 NULL, created_at DATETIME2 NULL, updated_at DATETIME2 NULL);",
    "IF OBJECT_ID(N'dbo.ops_alert_rules', N'U') IS NULL CREATE TABLE dbo.ops_alert_rules (rule_id NVARCHAR(64) NOT NULL PRIMARY KEY, name NVARCHAR(160) NULL, nl_description NVARCHAR(500) NULL, condition_logic NVARCHAR(32) NULL, conditions_json NVARCHAR(MAX) NULL, status NVARCHAR(32) NULL, total_triggered INT NULL, last_triggered_at DATETIME2 NULL, created_at DATETIME2 NULL);",
    "IF OBJECT_ID(N'dbo.host_assignments_ai_ready', N'U') IS NULL CREATE TABLE dbo.host_assignments_ai_ready (assignment_id NVARCHAR(64) NOT NULL PRIMARY KEY, patronId NVARCHAR(64) NULL, prAgentId NVARCHAR(64) NULL, caseId NVARCHAR(64) NULL, status NVARCHAR(32) NULL, fitScore DECIMAL(6,2) NULL, active BIT NULL, assignedAt DATETIME2 NULL, acceptedAt DATETIME2 NULL, completedAt DATETIME2 NULL, agentSnapshot NVARCHAR(MAX) NULL, updatedAt DATETIME2 NULL);",
    "IF OBJECT_ID(N'dbo.responsible_play_cases_ai_ready', N'U') IS NULL CREATE TABLE dbo.responsible_play_cases_ai_ready (case_id NVARCHAR(64) NOT NULL PRIMARY KEY, patronId NVARCHAR(64) NULL, tableId NVARCHAR(64) NULL, riskType NVARCHAR(64) NULL, riskScore INT NULL, riskLevel NVARCHAR(32) NULL, status NVARCHAR(32) NULL, reasoningAssessment NVARCHAR(MAX) NULL, adminReview NVARCHAR(MAX) NULL, timeline NVARCHAR(MAX) NULL, createdAt DATETIME2 NULL, updatedAt DATETIME2 NULL);",
    "IF OBJECT_ID(N'dbo.ops_patron_alerts_ai_ready', N'U') IS NULL CREATE TABLE dbo.ops_patron_alerts_ai_ready (alert_id NVARCHAR(64) NOT NULL PRIMARY KEY, patronId NVARCHAR(64) NULL, ruleId NVARCHAR(64) NULL, ruleName NVARCHAR(160) NULL, tableId NVARCHAR(64) NULL, status NVARCHAR(32) NULL, triggeredAt DATETIME2 NULL, triggeredConditions NVARCHAR(MAX) NULL, patronSnapshot NVARCHAR(MAX) NULL, tableSnapshot NVARCHAR(MAX) NULL, llmRationale NVARCHAR(1000) NULL);",
  ];
  for (const statement of ddl) lines.push(statement, "GO");
  const agents = [["PR-007", "Marcus Lei"], ["PR-012", "Ivy Choi"], ["PR-018", "Ken Wong"], ["PR-021", "Tina Wu"], ["PR-003", "Alex Ho"]];
  const rooms = ["Executive Suite", "Premium Suite", "Deluxe King", "Late Checkout", "Private Room"];
  for (let i = 0; i < rooms.length; i += 1) lines.push(msMerge("room_inventory", "inventory_id", { inventory_id: `INV-INIT-${i + 1}`, room_type: rooms[i], available_count: 3 + i, upgrade_cost_hkd: 300 + i * 220, business_date: "2026-10-15", updated_at: date }));
  for (let i = 0; i < agents.length; i += 1) lines.push(msMerge("pr_agent_profiles", "pr_agent_id", { pr_agent_id: agents[i][0], agent_name: agents[i][1], preferred_languages: "en,zh", preferred_tiers: "Gold,Platinum", preferred_games: "Baccarat,Blackjack", specialty_tags: i % 2 ? "HostCare,FollowUp" : "VIP,RiskReview", max_active_patrons: 8 + i, current_active_patrons: 3 + i, active: 1, last_assigned_at: date, created_at: date, updated_at: date }));
  const ruleIds = ["RULE-RISK-001", "RULE-HOST-001", "RULE-BET-001", "RULE-OFFER-001", "RULE-OCCUPANCY-001"];
  const ruleNames = ["ACTIVE_RISK_CASE", "HOST_SLA_OVERDUE", "CONSECUTIVE_ROUNDS_BET_THRESHOLD", "OFFER_FATIGUE", "TABLE_OCCUPANCY_PRESSURE"];
  for (let i = 0; i < ruleIds.length; i += 1) lines.push(msMerge("ops_alert_rules", "rule_id", { rule_id: ruleIds[i], name: ruleNames[i], nl_description: `Bootstrap demo alert rule ${i + 1}`, condition_logic: "ALL", conditions_json: { type: "bootstrap", threshold: 10000 + i * 1000 }, status: "Active", total_triggered: 0, last_triggered_at: null, created_at: date }));
  for (const p of people) {
    const riskType = p.risk ? "ResponsiblePlayReview" : "None";
    const caseId = `RPC-${p.id}-CLOSED`;
    const assignmentId = `HA-${p.id}`;
    lines.push(msMerge("hotel_stays", "stay_id", { stay_id: `STAY-${p.guestId}-ACTIVE`, guest_id: p.guest, player_id: p.id, passport_hash: `PASS-DEMO-${p.id}`, mobile_hash: `MOB-DEMO-${p.id}`, loyalty_card_no: p.card, checkin_at: "2026-10-15 09:42:00", checkout_at: "2026-10-16 03:42:00", room_type: p.tier === "Diamond" ? "Executive Suite" : "Deluxe King", upgrade_eligible: ["Diamond", "Platinum"].includes(p.tier) ? 1 : 0, late_checkout_eligible: p.risk ? 0 : 1, status: "CheckedIn", stay_status: "CheckedIn", updated_at: date }));
    lines.push(msMerge("responsible_play_cases", "case_id", { case_id: caseId, guest_id: p.guest, player_id: p.id, table_id: p.table, risk_type: riskType, risk_score: p.risk ? 92 : 12, status: p.risk ? "Active" : "Closed", reason: p.risk ? "High wager velocity; block incentive offers." : "No active responsible play case.", created_at: date, updated_at: date }));
    lines.push(msMerge("host_assignments", "assignment_id", { assignment_id: assignmentId, guest_id: p.guest, player_id: p.id, pr_agent_id: p.risk ? "PR-012" : p.tier === "Diamond" ? "PR-007" : "PR-018", host_id: p.risk ? "PR-012" : p.tier === "Diamond" ? "PR-007" : "PR-018", host_name: p.risk ? "Ivy Choi" : p.tier === "Diamond" ? "Marcus Lei" : "Ken Wong", case_id: p.risk ? `RPC-${p.id}-ACTIVE` : `CASE-${p.id}`, assignment_status: "Assigned", status: "Assigned", fit_score: p.risk ? 0.55 : 0.88, active: 1, last_contact_at: date, sla_due_at: date, assigned_at: date, accepted_at: null, completed_at: null, updated_at: date }));
    lines.push(msMerge("host_assignments_ai_ready", "assignment_id", { assignment_id: assignmentId, patronId: p.master, prAgentId: p.risk ? "PR-012" : p.tier === "Diamond" ? "PR-007" : "PR-018", caseId: p.risk ? `RPC-${p.id}-ACTIVE` : `CASE-${p.id}`, status: "Assigned", fitScore: p.risk ? 0.55 : 0.88, active: 1, assignedAt: date, acceptedAt: null, completedAt: null, agentSnapshot: { name: p.risk ? "Ivy Choi" : "Ken Wong", source: "MSSQL.host_assignments" }, updatedAt: date }));
    lines.push(msMerge("responsible_play_cases_ai_ready", "case_id", { case_id: caseId, patronId: p.master, tableId: p.table, riskType, riskScore: p.risk ? 92 : 12, riskLevel: p.risk ? "High" : "Low", status: p.risk ? "Active" : "Closed", reasoningAssessment: { summary: p.risk ? "High wager velocity; block incentive offers." : "No active responsible play case.", source: "MSSQL.responsible_play_cases" }, adminReview: { status: p.risk ? "Active" : "Closed", reviewedBy: "ADM-01" }, timeline: [{ node: "case_created", at: iso }], createdAt: date, updatedAt: date }));
    if (p.risk) lines.push(msMerge("ops_patron_alerts_ai_ready", "alert_id", { alert_id: `ALERT-${p.id}-ACTIVE`, patronId: p.master, ruleId: "RULE-RISK-001", ruleName: "Responsible play review required", tableId: p.table, status: "OPEN", triggeredAt: date, triggeredConditions: { riskScore: 92, behaviorTags: tags(p), tableId: p.table }, patronSnapshot: { playerId: p.id, guestId: p.guest, tier: p.tier, sessionBetHkd: p.bet }, tableSnapshot: { tableId: p.table, zone: p.zone, game: gameName(p.game) }, llmRationale: "High wager velocity requires administrator review before an offer can be sent." }));
  }
  lines.push("PRINT 'Realtime source bootstrap completed.';", "GO", "");
  writeFileSync(resolve(outputDir, "mssql_casino_ops_realtime_bootstrap.sql"), lines.join("\n"));
}

writeOracle();
writePostgres();
writeMssql();
writeFileSync(resolve(outputDir, "README.md"), [
  "# 三个关系型源库的实时造数交接包",
  "",
  "这三份 SQL 以 scripts/realtime-source-feeder.mjs 当前实现为准，创建它直接写入的源表并插入一组可重复执行的基线数据。长期造数脚本仍然是仓库中的 scripts/realtime-source-feeder.mjs，SQL 文件不包含数据库密码。",
  "",
  "## 文件",
  "",
  "- oracle_c##gaming_realtime_bootstrap.sql：Oracle schema C##GAMING，7 张 feeder 直接写入的表。",
  "- mssql_casino_ops_realtime_bootstrap.sql：SQL Server 数据库 casino_ops、schema dbo，当前环境使用的 9 张业务表（含 3 张 *_ai_ready 表）。",
  "- postgres_casino_loyalty_realtime_bootstrap.sql：PostgreSQL schema casino_loyalty，5 张 feeder 直接写入的表。",
  "",
  "Oracle 表：GAMING_PLAYER_ACCOUNT、GAMING_PLAYER_RATINGS、GAMING_TABLE_STATE、GAMING_TABLE_STATE_HISTORY、GAMING_TABLE_SESSIONS、GAMING_PLAYER_ROUND_BETS、GAMING_TABLE_ROUND_COUNTERS。",
  "MSSQL 表：hotel_stays、responsible_play_cases、host_assignments、room_inventory、pr_agent_profiles、ops_alert_rules、host_assignments_ai_ready、responsible_play_cases_ai_ready、ops_patron_alerts_ai_ready。",
  "PostgreSQL 表：crm_identity_links、crm_patron_profiles、app_activity_events、pos_fnb_checks、crm_offer_responses。",
  "",
  "## 执行顺序",
  "",
  "1. 先在目标数据库分别执行对应 SQL 文件。SQL 使用幂等 DDL 和 MERGE/ON CONFLICT，可重复执行。",
  "2. 再把仓库中的 scripts/realtime-source-feeder.mjs 和 .env.source-feeder 按同事环境填写。MSSQL 端口由环境变量 MSSQL_PORT 控制；当前演示环境是 2433。",
  "3. 在仓库根目录启动长期造数，例如：",
  "",
  "   node scripts/realtime-source-feeder.mjs --scenario=mixed --interval=3000 --batch-size=5 --duration-hours=72",
  "",
  "## 说明",
  "",
  "这些文件只覆盖当前长期 feeder 直接维护的源表，不包含 FDM/MDM 目标表，也不包含仓库旧的 15+ 全量种子脚本中未被当前 feeder 写入的营销、聊天和分析辅助表。这样可以避免把旧字段或旧主键混入同事环境。若同事还要复刻完整 AI 面板的 FDM/MDM 任务，应另外导入对应目标端建表或由 TapData 自动建表。",
  "",
].join("\n"));

console.log(`Wrote realtime bootstrap SQL to ${outputDir}`);
