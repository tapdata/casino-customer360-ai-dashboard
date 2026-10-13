#!/usr/bin/env node

/*
 * Rebuild the casino demo's MSSQL source from the surviving Oracle and
 * PostgreSQL sources. The default mode is read-only. Pass --write before
 * allowing this script to create casino_ops, create missing tables, and
 * upsert the reconstructed MSSQL-side records.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function loadEnv(file = ".env.source-feeder") {
  if (!fs.existsSync(file)) throw new Error(`${file} is required`);
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    let value = rest.join("=").trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key.trim()] = value;
  }
}

loadEnv();

const args = new Set(process.argv.slice(2));
const writeEnabled = args.has("--write");
const emitSqlArg = process.argv.find((arg) => arg.startsWith("--emit-sql="));
const emitSqlPath = emitSqlArg ? emitSqlArg.slice("--emit-sql=".length) : "";
const schema = process.env.MSSQL_SCHEMA || "dbo";
const database = process.env.MSSQL_DATABASE || "casino_ops";
const sourceSchema = process.env.PGSCHEMA || "casino_loyalty";

function assertIdentifier(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_$#]*$/.test(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

function sqlIdentifier(value) {
  return `[${String(value).replaceAll("]", "]]" )}]`;
}

function pgIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

assertIdentifier(schema, "MSSQL schema");
assertIdentifier(database, "MSSQL database");
assertIdentifier(sourceSchema, "PostgreSQL schema");

function pad(value, length) {
  return String(value).padStart(length, "0");
}

function asDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => item != null).map(String) : [];
}

function json(value) {
  return JSON.stringify(value ?? {});
}

function oracleConnectString(raw) {
  const match = String(raw || "").match(/^([^:/\s]+):(\d+):([^:/\s]+)$/);
  if (!match) return raw;
  return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${match[1]})(PORT=${match[2]}))(CONNECT_DATA=(SID=${match[3]})))`;
}

function mssqlConfig(db) {
  return {
    server: process.env.MSSQL_SERVER,
    port: Number(process.env.MSSQL_PORT || 1433),
    database: db,
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    options: {
      encrypt: process.env.MSSQL_ENCRYPT === "true",
      trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== "false",
    },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
  };
}

function requiredEnv(keys) {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(", ")}`);
}

async function readSources() {
  requiredEnv([
    "ORACLE_USER", "ORACLE_PASSWORD", "ORACLE_CONNECT_STRING",
    "PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE",
  ]);
  const [oracleModule, pgModule] = await Promise.all([import("oracledb"), import("pg")]);
  const oracledb = oracleModule.default || oracleModule;
  const { Client } = pgModule;
  let oracle;
  let postgres;
  try {
    oracle = await oracledb.getConnection({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: oracleConnectString(process.env.ORACLE_CONNECT_STRING),
    });
    await oracle.execute("ALTER SESSION SET CURRENT_SCHEMA = C##GAMING");
    const oracleQuery = async (sql) => (await oracle.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows;
    const [accounts, ratings, sessions] = await Promise.all([
      oracleQuery("SELECT PLAYER_ID, CASINO_CARD_NO, FULL_NAME, PASSPORT_HASH, MOBILE_HASH, ACCOUNT_STATUS, CREATED_AT FROM GAMING_PLAYER_ACCOUNT"),
      oracleQuery("SELECT PLAYER_ID, ADT_AMOUNT, THEO_WIN_AMOUNT, LAST_VISIT_AT, PREFERRED_GAME_CODE, RATING_TIER_CODE, UPDATED_AT FROM GAMING_PLAYER_RATINGS"),
      oracleQuery("SELECT SESSION_ID, PLAYER_ID, TABLE_ID, SEATED_AT, LAST_ACTION_AT, SESSION_BET_HKD, PREVIOUS_BET_HKD, CURRENT_STACK_HKD, BEHAVIOR_TAGS, IS_ACTIVE FROM GAMING_TABLE_SESSIONS ORDER BY LAST_ACTION_AT DESC"),
    ]);

    postgres = new Client({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 10000,
    });
    await postgres.connect();
    const pgQuery = async (sql) => (await postgres.query(sql)).rows;
    const [links, profiles] = await Promise.all([
      pgQuery(`SELECT master_player_id, gaming_player_id, hotel_guest_id, pos_member_no, crm_customer_id, casino_card_no, passport_hash, mobile_hash, updated_at FROM ${pgIdentifier(sourceSchema)}.${pgIdentifier("crm_identity_links")}`),
      pgQuery(`SELECT customer_id, master_player_id, name, masked_name, tier, region, adt, points_balance, preferred_games, preferred_benefits, risk_flags, last_active_at, created_at, updated_at FROM ${pgIdentifier(sourceSchema)}.${pgIdentifier("crm_patron_profiles")}`),
    ]);
    return { accounts, ratings, sessions, links, profiles };
  } finally {
    try { await oracle?.close(); } catch {}
    try { await postgres?.end(); } catch {}
  }
}

function reconstructPeople(source) {
  const accounts = new Map(source.accounts.map((row) => [String(row.PLAYER_ID), row]));
  const ratings = new Map(source.ratings.map((row) => [String(row.PLAYER_ID), row]));
  const sessions = new Map();
  for (const row of source.sessions) {
    const playerId = String(row.PLAYER_ID);
    if (!sessions.has(playerId)) sessions.set(playerId, row);
  }
  const links = new Map(source.links.map((row) => [String(row.gaming_player_id), row]));
  const profilesByPlayer = new Map();
  for (const row of source.profiles) {
    const link = source.links.find((candidate) => String(candidate.crm_customer_id) === String(row.customer_id));
    if (link?.gaming_player_id != null) profilesByPlayer.set(String(link.gaming_player_id), row);
  }
  const ids = new Set([...accounts.keys(), ...links.keys(), ...profilesByPlayer.keys()]);
  return [...ids].sort((a, b) => Number(a) - Number(b)).map((playerId, index) => {
    const account = accounts.get(playerId) || {};
    const rating = ratings.get(playerId) || {};
    const session = sessions.get(playerId) || {};
    const link = links.get(playerId) || {};
    const profile = profilesByPlayer.get(playerId) || {};
    const guestId = String(link.hotel_guest_id || `H${pad(playerId, 6)}`);
    const tags = String(session.BEHAVIOR_TAGS || "").split(",").map((value) => value.trim()).filter(Boolean);
    const riskFlags = asArray(profile.risk_flags);
    const risk = riskFlags.some((flag) => /risk|responsible|aggressive/i.test(flag)) || tags.some((tag) => /risk|aggressive|cardcounter/i.test(tag));
    const openCare = !risk && (riskFlags.length > 0 || tags.some((tag) => /fatigue|overdue|followup/i.test(tag)));
    const active = Number(session.IS_ACTIVE || 0) === 1;
    const tier = String(profile.tier || rating.RATING_TIER_CODE || "Gold");
    const createdAt = asDate(profile.created_at || account.CREATED_AT || link.updated_at);
    const updatedAt = asDate(session.LAST_ACTION_AT || profile.updated_at || rating.UPDATED_AT, createdAt);
    return {
      index,
      playerId,
      guestId,
      customerId: String(link.crm_customer_id || profile.customer_id || `C${playerId}`),
      masterPlayerId: String(link.master_player_id || `P${pad(playerId, 10)}`),
      name: String(profile.name || account.FULL_NAME || `Demo Patron ${playerId}`),
      passportHash: String(link.passport_hash || account.PASSPORT_HASH || `PASS-DEMO-${playerId}`),
      mobileHash: String(link.mobile_hash || account.MOBILE_HASH || `MOB-DEMO-${playerId}`),
      cardNo: String(link.casino_card_no || account.CASINO_CARD_NO || `CARD-${playerId}`),
      tier,
      region: String(profile.region || "Macau"),
      preferredGame: String((asArray(profile.preferred_games)[0] || rating.PREFERRED_GAME_CODE || "Baccarat")),
      benefits: asArray(profile.preferred_benefits),
      riskFlags,
      tags,
      tableId: String(session.TABLE_ID || `T-${String((index % 30) + 1).padStart(4, "0")}`),
      active,
      risk,
      openCare,
      adt: Number(profile.adt || rating.ADT_AMOUNT || 0),
      points: Number(profile.points_balance || 0),
      bet: Number(session.SESSION_BET_HKD || 0),
      previousBet: Number(session.PREVIOUS_BET_HKD || 0),
      stack: Number(session.CURRENT_STACK_HKD || 0),
      createdAt,
      updatedAt,
      seatedAt: asDate(session.SEATED_AT || updatedAt),
    };
  });
}

const HOSTS = [
  ["PR-007", "Marcus Lei"], ["PR-012", "Ivy Choi"], ["PR-018", "Ken Wong"],
  ["PR-021", "Tina Wu"], ["PR-003", "Alex Ho"], ["PR-009", "Sofia Chan"],
  ["PR-011", "Ben Wong"], ["PR-016", "Mia Zhang"], ["PR-020", "Oscar Lam"],
  ["PR-025", "Grace Li"],
];

function buildRows(people) {
  const hotel = [];
  const risks = [];
  const assignments = [];
  const alerts = [];
  for (const person of people) {
    const host = HOSTS[person.index % HOSTS.length];
    const caseId = `RPC-${person.playerId}-REBUILT`;
    const riskType = person.risk ? "ResponsiblePlayReview" : person.openCare ? "HostSlaOverdue" : "None";
    const status = person.risk ? "Active" : person.openCare ? "Open" : "Closed";
    const riskScore = person.risk ? 90 + (person.index % 10) : person.openCare ? 45 + (person.index % 20) : 10 + (person.index % 20);
    const roomType = person.tier === "Diamond" ? "Executive Suite" : person.tier === "Platinum" ? "Premium Suite" : "Deluxe King";
    const checkout = new Date(person.updatedAt.getTime() + 18 * 60 * 60 * 1000);
    hotel.push({
      stay_id: `STAY-${person.guestId}-REBUILT`, guest_id: person.guestId, player_id: person.playerId,
      passport_hash: person.passportHash, mobile_hash: person.mobileHash, loyalty_card_no: person.cardNo,
      checkin_at: person.seatedAt, checkout_at: checkout, check_in_at: person.seatedAt,
      planned_check_out_at: checkout, room_type: roomType,
      upgrade_eligible: ["Diamond", "Platinum"].includes(person.tier) ? 1 : 0,
      late_checkout_eligible: person.risk ? 0 : 1, status: person.active ? "CheckedIn" : "CheckedOut",
      stay_status: person.active ? "CheckedIn" : "CheckedOut", updated_at: person.updatedAt,
    });
    risks.push({
      case_id: caseId, guest_id: person.guestId, player_id: person.playerId, table_id: person.tableId,
      risk_type: riskType, risk_score: riskScore, status, reason: person.risk
        ? "Rebuilt from surviving source risk signals; incentive offers must remain blocked."
        : person.openCare ? "Rebuilt from surviving source care/follow-up signals."
          : "Rebuilt from surviving source records; no active risk case.",
      created_at: person.createdAt, updated_at: person.updatedAt,
    });
    assignments.push({
      assignment_id: `HA-${person.playerId}-REBUILT`, guest_id: person.guestId, player_id: person.playerId,
      pr_agent_id: host[0], host_id: host[0], host_name: host[1], case_id: caseId,
      assignment_status: person.openCare ? "Overdue" : "Assigned", status: person.openCare ? "Overdue" : "Assigned",
      fit_score: Math.min(0.98, 0.62 + (person.index % 8) * 0.04), active: 1,
      last_contact_at: person.updatedAt, sla_due_at: new Date(person.updatedAt.getTime() + (person.openCare ? -10 : 90) * 60 * 1000),
      assigned_at: person.createdAt, updated_at: person.updatedAt,
    });
    if (person.risk || person.openCare) {
      alerts.push({
        alert_id: `ALERT-${person.playerId}-REBUILT`, rule_id: person.risk ? "RULE-RISK-001" : "RULE-HOST-001",
        rule_name: person.risk ? "Responsible play review required" : "Host follow-up overdue",
        patron_source_player_id: person.playerId, guest_id: person.guestId, table_id: person.tableId,
        alert_title: person.risk ? "Responsible play review required" : "Host follow-up overdue",
        alert_message: person.risk ? "Block incentive offers and route to administrator review." : "Review host follow-up before customer contact.",
        severity: person.risk ? "HIGH" : "MEDIUM", status: "OPEN", alert_status: "OPEN",
        triggered_conditions_json: json({ riskFlags: person.riskFlags, behaviorTags: person.tags }),
        patron_snapshot_json: json({ playerId: person.playerId, customerId: person.customerId, tier: person.tier, adt: person.adt }),
        table_snapshot_json: json({ tableId: person.tableId, active: person.active }),
        triggered_at: person.updatedAt, llm_rationale: "Rebuilt from surviving Oracle and PostgreSQL signals.", created_at: person.updatedAt,
      });
    }
  }
  return { hotel, risks, assignments, alerts };
}

function riskLevel(score) {
  if (score >= 80) return "High";
  if (score >= 50) return "Medium";
  if (score > 0) return "Low";
  return "Normal";
}

function buildAiReadyRows(rows) {
  return {
    assignments: rows.assignments.map((row) => ({
      assignment_id: row.assignment_id,
      patronId: `P${String(row.player_id).padStart(10, "0")}`,
      prAgentId: row.host_id || row.pr_agent_id,
      caseId: row.case_id,
      status: row.status || row.assignment_status,
      fitScore: row.fit_score,
      active: row.active,
      assignedAt: row.assigned_at,
      acceptedAt: row.accepted_at ?? null,
      completedAt: row.completed_at ?? null,
      agentSnapshot: json({ name: row.host_name, source: "MSSQL.host_assignments" }),
      updatedAt: row.updated_at,
    })),
    risks: rows.risks.map((row) => ({
      case_id: row.case_id,
      patronId: `P${String(row.player_id).padStart(10, "0")}`,
      tableId: row.table_id,
      riskType: row.risk_type,
      riskScore: row.risk_score,
      riskLevel: riskLevel(row.risk_score),
      status: row.status,
      reasoningAssessment: json({ summary: row.reason, source: "MSSQL.responsible_play_cases" }),
      adminReview: json({ status: row.status, reviewedBy: "ADM-01" }),
      timeline: json([{ node: "case_created", at: row.created_at.toISOString() }]),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    alerts: rows.alerts.map((row) => ({
      alert_id: row.alert_id,
      patronId: `P${String(row.patron_source_player_id).padStart(10, "0")}`,
      ruleId: row.rule_id,
      ruleName: row.rule_name,
      tableId: row.table_id,
      status: row.status,
      triggeredAt: row.triggered_at,
      triggeredConditions: row.triggered_conditions_json,
      patronSnapshot: row.patron_snapshot_json,
      tableSnapshot: row.table_snapshot_json,
      llmRationale: row.llm_rationale,
    })),
  };
}

const DDL = [
  `IF OBJECT_ID(N'dbo.hotel_stays', N'U') IS NULL CREATE TABLE dbo.hotel_stays (stay_id NVARCHAR(64) NOT NULL PRIMARY KEY, guest_id NVARCHAR(64) NULL, player_id NVARCHAR(64) NULL, passport_hash NVARCHAR(128) NULL, mobile_hash NVARCHAR(128) NULL, loyalty_card_no NVARCHAR(64) NULL, checkin_at DATETIME2 NULL, checkout_at DATETIME2 NULL, check_in_at DATETIME2 NULL, planned_check_out_at DATETIME2 NULL, room_type NVARCHAR(64) NULL, upgrade_eligible BIT NULL, late_checkout_eligible BIT NULL, status NVARCHAR(32) NULL, stay_status NVARCHAR(32) NULL, updated_at DATETIME2 NULL);`,
  `IF OBJECT_ID(N'dbo.responsible_play_cases', N'U') IS NULL CREATE TABLE dbo.responsible_play_cases (case_id NVARCHAR(64) NOT NULL PRIMARY KEY, guest_id NVARCHAR(64) NULL, player_id NVARCHAR(64) NULL, table_id NVARCHAR(64) NULL, risk_type NVARCHAR(64) NULL, risk_score INT NULL, status NVARCHAR(32) NULL, reason NVARCHAR(500) NULL, created_at DATETIME2 NULL, updated_at DATETIME2 NULL);`,
  `IF OBJECT_ID(N'dbo.host_assignments', N'U') IS NULL CREATE TABLE dbo.host_assignments (assignment_id NVARCHAR(64) NOT NULL PRIMARY KEY, guest_id NVARCHAR(64) NULL, player_id NVARCHAR(64) NULL, pr_agent_id NVARCHAR(64) NULL, host_id NVARCHAR(64) NULL, host_name NVARCHAR(120) NULL, case_id NVARCHAR(64) NULL, assignment_status NVARCHAR(32) NULL, status NVARCHAR(32) NULL, fit_score DECIMAL(6,2) NULL, active BIT NULL, last_contact_at DATETIME2 NULL, sla_due_at DATETIME2 NULL, assigned_at DATETIME2 NULL, accepted_at DATETIME2 NULL, completed_at DATETIME2 NULL, updated_at DATETIME2 NULL);`,
  `IF OBJECT_ID(N'dbo.room_inventory', N'U') IS NULL CREATE TABLE dbo.room_inventory (inventory_id NVARCHAR(64) NOT NULL PRIMARY KEY, room_type NVARCHAR(64) NULL, available_count INT NULL, upgrade_cost_hkd DECIMAL(18,2) NULL, business_date DATE NULL, updated_at DATETIME2 NULL);`,
  `IF OBJECT_ID(N'dbo.pr_agent_profiles', N'U') IS NULL CREATE TABLE dbo.pr_agent_profiles (pr_agent_id NVARCHAR(64) NOT NULL PRIMARY KEY, agent_name NVARCHAR(120) NULL, preferred_languages NVARCHAR(300) NULL, preferred_tiers NVARCHAR(300) NULL, preferred_games NVARCHAR(300) NULL, specialty_tags NVARCHAR(300) NULL, max_active_patrons INT NULL, current_active_patrons INT NULL, active BIT NULL, last_assigned_at DATETIME2 NULL, created_at DATETIME2 NULL, updated_at DATETIME2 NULL);`,
  `IF OBJECT_ID(N'dbo.ops_alert_rules', N'U') IS NULL CREATE TABLE dbo.ops_alert_rules (rule_id NVARCHAR(64) NOT NULL PRIMARY KEY, name NVARCHAR(160) NULL, nl_description NVARCHAR(500) NULL, condition_logic NVARCHAR(32) NULL, conditions_json NVARCHAR(MAX) NULL, status NVARCHAR(32) NULL, total_triggered INT NULL, last_triggered_at DATETIME2 NULL, created_at DATETIME2 NULL);`,
  `IF OBJECT_ID(N'dbo.host_assignments_ai_ready', N'U') IS NULL CREATE TABLE dbo.host_assignments_ai_ready (assignment_id NVARCHAR(64) NOT NULL PRIMARY KEY, patronId NVARCHAR(64) NULL, prAgentId NVARCHAR(64) NULL, caseId NVARCHAR(64) NULL, status NVARCHAR(32) NULL, fitScore DECIMAL(6,2) NULL, active BIT NULL, assignedAt DATETIME2 NULL, acceptedAt DATETIME2 NULL, completedAt DATETIME2 NULL, agentSnapshot NVARCHAR(MAX) NULL, updatedAt DATETIME2 NULL);`,
  `IF OBJECT_ID(N'dbo.responsible_play_cases_ai_ready', N'U') IS NULL CREATE TABLE dbo.responsible_play_cases_ai_ready (case_id NVARCHAR(64) NOT NULL PRIMARY KEY, patronId NVARCHAR(64) NULL, tableId NVARCHAR(64) NULL, riskType NVARCHAR(64) NULL, riskScore INT NULL, riskLevel NVARCHAR(32) NULL, status NVARCHAR(32) NULL, reasoningAssessment NVARCHAR(MAX) NULL, adminReview NVARCHAR(MAX) NULL, timeline NVARCHAR(MAX) NULL, createdAt DATETIME2 NULL, updatedAt DATETIME2 NULL);`,
  `IF OBJECT_ID(N'dbo.ops_patron_alerts_ai_ready', N'U') IS NULL CREATE TABLE dbo.ops_patron_alerts_ai_ready (alert_id NVARCHAR(64) NOT NULL PRIMARY KEY, patronId NVARCHAR(64) NULL, ruleId NVARCHAR(64) NULL, ruleName NVARCHAR(160) NULL, tableId NVARCHAR(64) NULL, status NVARCHAR(32) NULL, triggeredAt DATETIME2 NULL, triggeredConditions NVARCHAR(MAX) NULL, patronSnapshot NVARCHAR(MAX) NULL, tableSnapshot NVARCHAR(MAX) NULL, llmRationale NVARCHAR(1000) NULL);`,
];

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) {
    const iso = value.toISOString().replace("T", " ").replace("Z", "");
    return `'${iso}'`;
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `N'${String(value).replaceAll("'", "''")}'`;
}

function renderInsertStatements(table, primaryKey, rows) {
  if (!rows.length) return `-- No rows reconstructed for ${table}.`;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return rows.map((row) => {
    const values = columns.map((column) => sqlLiteral(row[column])).join(", ");
    const key = sqlLiteral(row[primaryKey]);
    return `IF NOT EXISTS (SELECT 1 FROM ${sqlIdentifier(schema)}.${sqlIdentifier(table)} WHERE ${sqlIdentifier(primaryKey)}=${key})\nBEGIN\n  INSERT INTO ${sqlIdentifier(schema)}.${sqlIdentifier(table)} (${columns.map(sqlIdentifier).join(", ")}) VALUES (${values});\nEND\nGO`;
  }).join("\n");
}

function renderSql(rows, statics) {
  const aiReady = buildAiReadyRows(rows);
  const lines = [
    "-- Generated from the surviving Oracle and PostgreSQL demo sources.",
    "-- This file is a manual SQL script. It does not connect to or modify those source databases.",
    `IF DB_ID(N'${database.replaceAll("'", "''")}') IS NULL`,
    "BEGIN",
    `  CREATE DATABASE ${sqlIdentifier(database)};`,
    "END",
    "GO",
    `USE ${sqlIdentifier(database)};`,
    "GO",
    ...DDL.flatMap((statement) => [statement, "GO"]),
    "-- Static reference tables",
    renderInsertStatements("room_inventory", "inventory_id", statics.rooms),
    renderInsertStatements("pr_agent_profiles", "pr_agent_id", statics.agents),
    renderInsertStatements("ops_alert_rules", "rule_id", statics.rules),
    "-- Reconstructed rows keyed with REBUILT",
    renderInsertStatements("hotel_stays", "stay_id", rows.hotel),
    renderInsertStatements("responsible_play_cases", "case_id", rows.risks),
    renderInsertStatements("host_assignments", "assignment_id", rows.assignments),
    renderInsertStatements("host_assignments_ai_ready", "assignment_id", aiReady.assignments),
    renderInsertStatements("responsible_play_cases_ai_ready", "case_id", aiReady.risks),
    renderInsertStatements("ops_patron_alerts_ai_ready", "alert_id", aiReady.alerts),
    "PRINT 'MSSQL casino_ops rebuild script completed.';",
    "GO",
  ];
  return `${lines.join("\n")}\n`;
}

async function connectMssql() {
  requiredEnv(["MSSQL_SERVER", "MSSQL_USER", "MSSQL_PASSWORD"]);
  const mssql = (await import("mssql")).default;
  const master = new mssql.ConnectionPool(mssqlConfig("master"));
  await master.connect();
  const found = await master.request().input("databaseName", mssql.NVarChar(128), database).query("SELECT DB_ID(@databaseName) AS database_id");
  if (!found.recordset[0]?.database_id) {
    if (!writeEnabled) throw new Error(`MSSQL database ${database} is missing. Re-run with --write to create it.`);
    await master.request().query(`CREATE DATABASE ${sqlIdentifier(database)}`);
    console.log(`Created MSSQL database ${database}.`);
  }
  await master.close();
  const pool = new mssql.ConnectionPool(mssqlConfig(database));
  await pool.connect();
  return { mssql, pool };
}

async function ensureSchema(pool) {
  for (const statement of DDL) await pool.request().batch(statement);
}

async function existingColumns(pool, table) {
  const result = await pool.request()
    .input("schemaName", schema)
    .input("tableName", table)
    .query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@schemaName AND TABLE_NAME=@tableName");
  return new Set(result.recordset.map((row) => row.COLUMN_NAME));
}

async function upsert(pool, table, primaryKey, record, columnsCache) {
  const available = columnsCache.get(table) || await existingColumns(pool, table);
  columnsCache.set(table, available);
  const entries = Object.entries(record).filter(([key, value]) => available.has(key) && value !== undefined && value !== null);
  if (!entries.some(([key]) => key === primaryKey)) throw new Error(`${table}: primary key ${primaryKey} is unavailable`);
  const request = pool.request();
  entries.forEach(([, value], index) => request.input(`p${index}`, value));
  const columns = entries.map(([key]) => key);
  const source = columns.map((column, index) => `@p${index} AS ${sqlIdentifier(column)}`).join(", ");
  const updates = columns.filter((column) => column !== primaryKey).map((column) => `target.${sqlIdentifier(column)}=source.${sqlIdentifier(column)}`).join(", ");
  const statement = `MERGE ${sqlIdentifier(schema)}.${sqlIdentifier(table)} WITH (HOLDLOCK) AS target USING (SELECT ${source}) AS source ON target.${sqlIdentifier(primaryKey)}=source.${sqlIdentifier(primaryKey)} WHEN MATCHED THEN UPDATE SET ${updates || `target.${sqlIdentifier(primaryKey)}=source.${sqlIdentifier(primaryKey)}`} WHEN NOT MATCHED THEN INSERT (${columns.map(sqlIdentifier).join(", ")}) VALUES (${columns.map((column) => `source.${sqlIdentifier(column)}`).join(", ")});`;
  await request.query(statement);
}

function staticRows(now) {
  const rooms = ["Executive Suite", "Fine Dining Voucher", "VIP Show Package", "Premium Suite", "Late Checkout", "Airport Transfer", "Spa Package", "Private Room", "Family Package", "Concert Ticket", "Tea Service", "Buffet Voucher", "Luxury Car", "Host Care", "Weekend Room"];
  const rules = [
    ["RULE-RISK-001", "ACTIVE_RISK_CASE"],
    ["RULE-HOST-001", "HOST_SLA_OVERDUE"],
    ["RULE-REBUILT-003", "CONSECUTIVE_ROUNDS_BET_THRESHOLD"],
    ["RULE-REBUILT-004", "OFFER_FATIGUE"],
    ["RULE-REBUILT-005", "TABLE_OCCUPANCY_PRESSURE"],
  ];
  return {
    rooms: rooms.map((roomType, index) => ({ inventory_id: `INV-REBUILT-${index + 1}`, room_type: roomType, available_count: 3 + (index % 9), upgrade_cost_hkd: 300 + index * 220, business_date: now, updated_at: now })),
    agents: HOSTS.map(([id, name], index) => ({ pr_agent_id: id, agent_name: name, preferred_languages: "en,zh", preferred_tiers: index % 2 ? "Gold,Platinum" : "Platinum,Diamond", preferred_games: "Baccarat,Blackjack", specialty_tags: index % 2 ? "HostCare,FollowUp" : "VIP,RiskReview", max_active_patrons: 8 + (index % 7), current_active_patrons: 3 + (index % 8), active: 1, last_assigned_at: now, created_at: now, updated_at: now })),
    rules: Array.from({ length: 15 }, (_, index) => {
      const [ruleId, ruleName] = rules[index % rules.length];
      return { rule_id: index < rules.length ? ruleId : `RULE-REBUILT-${String(index + 1).padStart(3, "0")}`, name: ruleName, nl_description: `Rebuilt demo alert rule ${index + 1}`, condition_logic: "ALL", conditions_json: json({ type: ruleName, threshold: 10000 + index * 1000 }), status: "Active", total_triggered: 0, last_triggered_at: null, created_at: now };
    }),
  };
}

async function main() {
  const source = await readSources();
  const people = reconstructPeople(source);
  const mode = emitSqlPath ? "emit-sql" : writeEnabled ? "write" : "dry-run";
  console.log(JSON.stringify({ mode, oracleAccounts: source.accounts.length, oracleSessions: source.sessions.length, postgresLinks: source.links.length, postgresProfiles: source.profiles.length, reconstructedPeople: people.length, activeOracleSessions: source.sessions.filter((row) => Number(row.IS_ACTIVE) === 1).length }));
  if (emitSqlPath) {
    const output = path.resolve(emitSqlPath);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, renderSql(buildRows(people), staticRows(new Date())));
    console.log(`Wrote SQL file: ${output}`);
    return;
  }
  if (!writeEnabled) return;

  const { pool, mssql } = await connectMssql();
  const columnsCache = new Map();
  try {
    await ensureSchema(pool);
    const now = new Date();
    const statics = staticRows(now);
    for (const row of statics.rooms) await upsert(pool, "room_inventory", "inventory_id", row, columnsCache);
    for (const row of statics.agents) await upsert(pool, "pr_agent_profiles", "pr_agent_id", row, columnsCache);
    for (const row of statics.rules) await upsert(pool, "ops_alert_rules", "rule_id", row, columnsCache);
    const rows = buildRows(people);
    for (const row of rows.hotel) await upsert(pool, "hotel_stays", "stay_id", row, columnsCache);
    for (const row of rows.risks) await upsert(pool, "responsible_play_cases", "case_id", row, columnsCache);
    for (const row of rows.assignments) await upsert(pool, "host_assignments", "assignment_id", row, columnsCache);
    const aiReady = buildAiReadyRows(rows);
    for (const row of aiReady.assignments) await upsert(pool, "host_assignments_ai_ready", "assignment_id", row, columnsCache);
    for (const row of aiReady.risks) await upsert(pool, "responsible_play_cases_ai_ready", "case_id", row, columnsCache);
    for (const row of aiReady.alerts) await upsert(pool, "ops_patron_alerts_ai_ready", "alert_id", row, columnsCache);
    console.log(JSON.stringify({ restored: { hotelStays: rows.hotel.length, riskCases: rows.risks.length, hostAssignments: rows.assignments.length, aiReadyAssignments: aiReady.assignments.length, aiReadyRiskCases: aiReady.risks.length, aiReadyAlerts: aiReady.alerts.length, roomInventory: statics.rooms.length, agents: statics.agents.length, alertRules: statics.rules.length }, note: "Only reconstructed demo keys were upserted; no source database was modified and no MSSQL table was dropped." }));
  } finally {
    await pool.close();
  }
  void mssql;
}

main().catch((error) => {
  console.error(`MSSQL rebuild failed: ${error.message}`);
  process.exitCode = 1;
});
