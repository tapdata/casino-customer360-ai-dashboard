# Rebuild the Deleted MSSQL Demo Source

The original MSSQL database cannot be recovered exactly without a SQL Server
backup. The repository now includes a safe source-derived rebuild script:

```text
scripts/rebuild-mssql-from-live-sources.mjs
```

It reads Oracle and PostgreSQL only, then reconstructs the MSSQL-side demo
records using the shared player/customer identifiers. It never writes to Oracle
or PostgreSQL, never drops an MSSQL database/table, and only upserts the
rebuild keys that it creates.

## What is reconstructed

The script creates `casino_ops` when it does not exist and creates any missing
`dbo` tables needed by the demo:

- `hotel_stays`
- `responsible_play_cases`
- `host_assignments`
- `ops_patron_alerts`
- `room_inventory`
- `pr_agent_profiles`
- `ops_alert_rules`

These names deliberately match the existing `generate_full_seed_15plus.mjs`
and `realtime-source-feeder.mjs` contracts. The rebuild adds nullable
compatibility columns where the feeder already supports them; it does not
rename or remove any of the existing table names.

For each player found in the surviving Oracle accounts/sessions or PostgreSQL
identity links/profiles, it derives:

- `guest_id`, `player_id`, card, passport, and mobile identifiers from the
  surviving identity records;
- hotel stay rows from the Oracle session time and activity state;
- responsible-play cases from PostgreSQL risk flags and Oracle behavior tags;
- host assignments from the deterministic demo host roster;
- alerts only for reconstructed risk or follow-up signals.

MSSQL-specific historical hotel notes, host conversations, and alert changes
that were deleted cannot be recovered without a backup. The rebuilt values are
clearly marked by keys containing `REBUILT`.

## Run it

Use the existing local `.env.source-feeder` with credentials for the surviving
Oracle/PostgreSQL sources and the target SQL Server:

```bash
npm install
node scripts/rebuild-mssql-from-live-sources.mjs
```

The command above is read-only and prints the source counts. In the current
demo environment it reports approximately:

```text
Oracle accounts:       1038
Oracle sessions:       1040
PostgreSQL links:      1038
PostgreSQL profiles:   1037
Reconstructed players: 1038
Active Oracle sessions: 231
```

## Generate a manual SQL file

If you want to review or execute the database changes yourself, generate a
standalone SQL Server script instead of using `--write`:

```bash
node scripts/rebuild-mssql-from-live-sources.mjs \
  --emit-sql=artifacts/seed-data/mssql_casino_ops_rebuilt_from_sources.sql
```

Open the generated file in SSMS or DBeaver and execute it as a script. It
creates `casino_ops` if needed, creates the missing `dbo` tables, and inserts
the reconstructed rows. Each insert is guarded by `IF NOT EXISTS` and uses a
`REBUILT` key, so rerunning the file does not duplicate the generated rows.
The Node command only reads Oracle/PostgreSQL while producing this file; the
SQL file is the step that writes to SQL Server when you execute it manually.

The generated SQL is intentionally ignored by Git because it contains a copy
of the demo data. A colleague can regenerate the same file after configuring
their own source credentials.

After reviewing that output, explicitly enable the rebuild:

```bash
node scripts/rebuild-mssql-from-live-sources.mjs --write
```

`--write` performs these actions in order:

1. Connects to SQL Server `master` and creates `casino_ops` only if it is
   missing.
2. Connects to `casino_ops` and creates missing tables. Existing tables are
   retained.
3. Upserts reconstructed demo rows by their `REBUILT` primary keys.
4. Leaves Oracle and PostgreSQL untouched.

The script requires these environment values:

```dotenv
ORACLE_USER=...
ORACLE_PASSWORD=...
ORACLE_CONNECT_STRING=<host>:1521:<sid>
MSSQL_SERVER=...
MSSQL_PORT=1433
MSSQL_DATABASE=casino_ops
MSSQL_USER=...
MSSQL_PASSWORD=...
PGHOST=...
PGPORT=5432
PGDATABASE=postgres
PGUSER=...
PGPASSWORD=...
PGSCHEMA=casino_loyalty
```

Do not commit `.env.source-feeder` or send its passwords through Git/chat.

## Verify after the write

Run these queries in SQL Server:

```sql
USE casino_ops;

SELECT name FROM sys.tables ORDER BY name;

SELECT COUNT(*) AS hotel_stays FROM dbo.hotel_stays;
SELECT COUNT(*) AS risk_cases FROM dbo.responsible_play_cases;
SELECT COUNT(*) AS host_assignments FROM dbo.host_assignments;
SELECT COUNT(*) AS alerts FROM dbo.ops_patron_alerts;

SELECT TOP (10) player_id, guest_id, status
FROM dbo.responsible_play_cases
WHERE case_id LIKE '%-REBUILT';
```

After the data is present, refresh the MSSQL connection model in TapData and
restart or resume the affected CDC tasks. The AI panel will not show the
reconstructed records until the MSSQL-to-FDM/MDM tasks and published APIs are
running.
