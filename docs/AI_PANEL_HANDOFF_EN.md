# AI Loyalty Panel Handoff Guide

This document is the operating handoff for the AI Loyalty Engine demo. It explains what the system does, how the three relational source databases feed TapData, how the AI panel reads the resulting APIs, and how to start, stop, validate, and troubleshoot the demo.

The repository already contains the long-running relational feeder and the three bootstrap SQL files. The handoff package is designed for a demo environment. Do not point it at production databases or real customer data.

## 1. System purpose and architecture

The demo shows a governed casino customer-intelligence flow:

```text
Oracle gaming core ─┐
MSSQL hotel / ops ──┼─> TapData CDC, FDM and MDM ─> published MDM APIs ─> AI panel
PostgreSQL CRM ────┘                                      │
                                                          ├─> AI chat
                                                          ├─> recommendations and approvals
                                                          └─> MongoDB audit / demo journey state
```

The browser never connects directly to Oracle, SQL Server, PostgreSQL, or business MongoDB collections. The Next.js server calls the published TapData APIs, keeps OAuth credentials server-side, and normalizes the source documents for the UI.

The current handoff package uses the relational path: Oracle, MSSQL and PostgreSQL feed TapData CDC/FDM/MDM, which then exposes the published APIs consumed by the panel.

## 2. Repository files

All source code, scripts, SQL files and handoff materials are kept in the GitHub repository:

```text
https://github.com/tapdata/casino-customer360-ai-dashboard.git
```

The current feeder and handoff materials are on the `codex/docker-demo-kit` branch. Clone that branch for the current demo:

```bash
git clone --branch codex/docker-demo-kit --single-branch \
  https://github.com/tapdata/casino-customer360-ai-dashboard.git
cd casino-customer360-ai-dashboard
git status
```

Update an existing checkout with fast-forward-only pulls:

```bash
git switch codex/docker-demo-kit
git pull --ff-only origin codex/docker-demo-kit
```

If the repository owner has merged the materials into `main`, replace the branch name consistently. For HTTPS access, use an account with repository permission and a GitHub Personal Access Token; do not put a GitHub password in a command or document.

| File | Purpose |
| --- | --- |
| `scripts/realtime-source-feeder.mjs` | Long-running three-source writer. This is the source of truth for live demo writes. |
| `.env.source-feeder.example` | Redacted feeder configuration template. Copy it to the private `.env.source-feeder`. |
| `scripts/export-realtime-source-sql.mjs` | Reproducible generator for the bootstrap SQL files. |
| `docs/three-source-sql/oracle_c##gaming_realtime_bootstrap.sql` | Oracle DDL and idempotent baseline data. |
| `docs/three-source-sql/mssql_casino_ops_realtime_bootstrap.sql` | MSSQL DDL and idempotent baseline data. |
| `docs/three-source-sql/postgres_casino_loyalty_realtime_bootstrap.sql` | PostgreSQL DDL and idempotent baseline data. |
| `docs/three-source-sql/README.md` | Short SQL handoff and execution notes. |
| `.env.example` / `.env.tapdata.example` | AI panel and TapData API configuration templates. |
| `app/api/data/patrons/route.ts` | Server-side patron snapshot loader and cache. |
| `app/api/ai/chat/route.ts` | Server-side AI chat and allow-listed TapData queries. |
| `app/api/audit/events/route.ts` | Action audit endpoint. |

The SQL files contain no passwords, tokens, or API secrets. Keep the actual `.env.local` and `.env.source-feeder` files outside Git.

### Restore the MongoDB source database

The repository's `seed/demo/` directory is an anonymized snapshot of the MongoDB source database. Its target database is `tapdata_casino_marketing` and it contains 23 collections. This is source-side data for TapData; FDM/MDM target collections must still be produced by the TapData task.

Validate the checked-in snapshot from the repository root:

```bash
node scripts/demo-seed.mjs check
```

The target MongoDB must run as a replica set because TapData CDC needs the oplog. Supply a URI that includes the target database and restore it into an empty database:

```bash
export SOURCE_RESTORE_URI='mongodb://<user>:<password>@<mongo-host>:27017/tapdata_casino_marketing?authSource=admin&replicaSet=<replica-set>'
node scripts/demo-seed.mjs restore
unset SOURCE_RESTORE_URI
```

The restore script creates the collections, inserts the documents, recreates the indexes, and verifies the counts and checksums from `manifest.json`. It refuses to overwrite a non-empty database or silently retry an incomplete restore. Verify the result with `mongosh`:

```bash
mongosh '<same MongoDB URI>' --quiet --eval \
  'db.getCollectionNames().length; db.patron_profiles.countDocuments({})'
```

Pass MongoDB credentials through environment variables or a private local file; never commit them. The panel audit database (for example `ai_loyalty_engine`) and the upgrade-journey collection are created on first write and are not restored from this source snapshot.

## 3. Three source databases

The current relational source model has one business area per database.

| Source | Schema | Business responsibility | TapData connection convention |
| --- | --- | --- | --- |
| Oracle | `C##GAMING` | Player account, player rating, table state, table sessions, rounds and bets | `Oracle_Gaming_Core` |
| Microsoft SQL Server | `dbo` in `casino_ops` | Hotel stays, responsible-play cases, host assignments, rules and AI-ready operational records | `MSSQL_Hotel_Ops` |
| PostgreSQL | `casino_loyalty` in database `postgres` | Identity links, CRM profiles, app activity, POS/F&B checks and offer responses | `PostgreSQL_Loyalty_CRM` |

The current rehearsal uses Oracle port `1521`, MSSQL port `2433`, and PostgreSQL port `25432`. Ports are configuration values; confirm them with the database owner before starting the feeder.

### 3.1 Oracle tables

The Oracle bootstrap creates the seven tables written directly by the feeder:

| Table | Primary key | Role |
| --- | --- | --- |
| `GAMING_PLAYER_ACCOUNT` | `PLAYER_ID` | Casino account identity and account-level attributes |
| `GAMING_PLAYER_RATINGS` | `RATING_ID` | ADT, theo, preferred game and rating tier |
| `GAMING_TABLE_STATE` | `TABLE_ID` | Current table metadata and occupancy |
| `GAMING_TABLE_STATE_HISTORY` | `HISTORY_ID` | Table-state snapshots over time |
| `GAMING_TABLE_SESSIONS` | `SESSION_ID` | Current or recent customer seating and wager state |
| `GAMING_PLAYER_ROUND_BETS` | `ROUND_BET_ID` | Individual round-level betting signal |
| `GAMING_TABLE_ROUND_COUNTERS` | `COUNTER_ID` | Current round counter by table and business date |

### 3.2 MSSQL tables

The current MSSQL environment has nine business tables. The three `*_ai_ready` tables are the shape used by the published AI-facing FDM/MDM mappings.

| Table | Primary key | Role |
| --- | --- | --- |
| `hotel_stays` | `stay_id` | Hotel stay, room and benefit eligibility |
| `responsible_play_cases` | `case_id` | Source responsible-play case |
| `host_assignments` | `assignment_id` | Host / PR assignment and SLA status |
| `room_inventory` | `inventory_id` | Reference inventory for room benefits |
| `pr_agent_profiles` | `pr_agent_id` | Host / PR capacity and skills |
| `ops_alert_rules` | `rule_id` | Operational alert rule definitions |
| `host_assignments_ai_ready` | `assignment_id` | Normalized assignment document for MDM/API |
| `responsible_play_cases_ai_ready` | `case_id` | Normalized risk-case document for MDM/API |
| `ops_patron_alerts_ai_ready` | `alert_id` | Normalized alert document for MDM/API |

The SQL file intentionally excludes SQL Server CDC internal tables such as `systranschemas`; those are created and maintained by SQL Server/TapData.

### 3.3 PostgreSQL tables

The PostgreSQL bootstrap creates the five feeder tables:

| Table | Primary key | Role |
| --- | --- | --- |
| `crm_identity_links` | `master_player_id` | Cross-system identity bridge |
| `crm_patron_profiles` | `customer_id` | CRM profile, tier, ADT, points and preferences |
| `app_activity_events` | `event_id` | App engagement signal |
| `pos_fnb_checks` | `check_id` | POS / food-and-beverage preference signal |
| `crm_offer_responses` | `response_id` | Offer response and channel outcome |

The bootstrap files cover the tables that the current long-running feeder writes directly. They do not create FDM/MDM target collections. TapData owns those target collections and published APIs.

## 4. Identity and join model

The most important handoff rule is to preserve the identity keys exactly. A customer is represented across systems by these values:

| Meaning | Example | Where it appears |
| --- | --- | --- |
| Raw gaming player ID | `105001` | Oracle `PLAYER_ID`, PostgreSQL `gaming_player_id`, MSSQL `player_id` |
| MDM master patron ID | `P0000105001` | PostgreSQL `master_player_id`, MSSQL AI-ready `patronId`, MDM `patronId` |
| CRM customer ID | `C105001` | PostgreSQL `crm_customer_id` and `crm_patron_profiles.customer_id` |
| Hotel guest ID | `H105001` | PostgreSQL `hotel_guest_id`, MSSQL `guest_id` |
| POS member number | `VIP105001` | PostgreSQL `pos_member_no`, POS/F&B records |
| Casino card number | `CARD-105001` | Oracle `CASINO_CARD_NO`, PostgreSQL `casino_card_no`, MSSQL `loyalty_card_no` |
| Table ID | `T-0004` | Oracle `TABLE_ID`, MSSQL AI-ready `tableId`, MDM table/session records |

The primary relationship is:

```text
Oracle PLAYER_ID
        = PostgreSQL crm_identity_links.gaming_player_id
        = MSSQL player_id
        -> PostgreSQL crm_identity_links.master_player_id
        -> MDM patronId / customer profile
```

For the example customer, the identity link is:

```text
105001 -> P0000105001 -> C105001 / H105001 / VIP105001
```

Use `crm_identity_links` as the bridge. Do not join Oracle `PLAYER_ID` directly to `master_player_id`; they intentionally have different formats. For FDM merge nodes, the configured join key must be present in the `after` image of an insert/update event. An update without a `before` image can still be processed, but it cannot repair a missing join key.

## 5. Bootstrap the databases

Install Node.js 22.13 or newer and the repository dependencies first:

```bash
cd "/path/to/Mogo Demo"
npm install
```

Run the three SQL files in their corresponding database clients:

- Oracle: run `oracle_c##gaming_realtime_bootstrap.sql` in schema `C##GAMING`.
- SQL Server: run `mssql_casino_ops_realtime_bootstrap.sql` in database `casino_ops`, schema `dbo`.
- PostgreSQL: run `postgres_casino_loyalty_realtime_bootstrap.sql` in database `postgres`; the script creates and selects schema `casino_loyalty`.

The scripts use idempotent DDL and `MERGE` / `ON CONFLICT`. Running them again updates the same bootstrap keys instead of creating duplicate baseline rows. They seed five representative patrons; Oracle also seeds the floor table states and round counters used by the dashboard.

If the target database already contains data, review the IDs before running the bootstrap. The SQL is safe for the demo keys, but it is not a production migration tool.

## 6. Configure and run the relational feeder

Create the private configuration file:

```bash
cp .env.source-feeder.example .env.source-feeder
chmod 600 .env.source-feeder
```

Fill in the three database blocks. Use placeholders in shared documents and provide real passwords through an approved secure channel.

```dotenv
ORACLE_USER=<oracle-user>
ORACLE_PASSWORD=<oracle-password>
ORACLE_CONNECT_STRING=<oracle-host>:1521/orcl
ORACLE_SCHEMA=C##GAMING

MSSQL_SERVER=<mssql-host>
MSSQL_PORT=2433
MSSQL_DATABASE=casino_ops
MSSQL_USER=<mssql-user>
MSSQL_PASSWORD=<mssql-password>
MSSQL_SCHEMA=dbo
MSSQL_ENCRYPT=true
MSSQL_TRUST_SERVER_CERTIFICATE=true

PGHOST=<postgres-host>
PGPORT=25432
PGDATABASE=postgres
PGUSER=<postgres-user>
PGPASSWORD=<postgres-password>
PGSCHEMA=casino_loyalty
PGSSL=false
```

The feeder uses the `pg`, `mssql`, and `oracledb` packages already declared by the project. Run a dry run first:

```bash
node scripts/realtime-source-feeder.mjs --dry-run
```

For a private handoff where the operator should not assemble the three connection blocks manually, use `THREE_SOURCE_FEEDER_RUN_PRIVATE.sh` from the repository root. This executable contains the current demo endpoints, database names, users, and credentials, creates a temporary private feeder environment, and starts the canonical feeder. With no arguments it runs the mixed scenario for 72 hours:

The two files have different responsibilities:

- `scripts/realtime-source-feeder.mjs` is the canonical data-generation engine. It creates or updates the deterministic customer records and writes them to Oracle, MSSQL, and PostgreSQL.
- `THREE_SOURCE_FEEDER_RUN_PRIVATE.sh` is only a private launcher. It checks Node.js and dependencies, writes the connection values into a temporary `.env.source-feeder`, applies the default 72-hour run parameters, and then invokes `node scripts/realtime-source-feeder.mjs`.
- The shell launcher does not contain a second copy of the data-generation logic. Changes to the `.mjs` file take effect the next time the launcher runs.

The execution path is:

```text
THREE_SOURCE_FEEDER_RUN_PRIVATE.sh
    -> temporary private .env.source-feeder
    -> scripts/realtime-source-feeder.mjs
    -> Oracle + MSSQL + PostgreSQL
    -> TapData CDC / FDM / MDM / published APIs
```

```bash
chmod 700 THREE_SOURCE_FEEDER_RUN_PRIVATE.sh
./THREE_SOURCE_FEEDER_RUN_PRIVATE.sh
```

The same file accepts the feeder arguments, for example `./THREE_SOURCE_FEEDER_RUN_PRIVATE.sh --dry-run`, `./THREE_SOURCE_FEEDER_RUN_PRIVATE.sh --once`, or `./THREE_SOURCE_FEEDER_RUN_PRIVATE.sh --duration-hours=10`. It is intentionally ignored by Git because it contains live demo passwords; share it only through an approved private channel. If a database password or endpoint changes, edit the connection block in that private file before running it again.

Write one event package to all configured sources:

```bash
node scripts/realtime-source-feeder.mjs --scenario=mixed --batch-size=5 --once
```

Run the long-lived demo for three days:

```bash
node scripts/realtime-source-feeder.mjs \
  --scenario=mixed \
  --interval=15000 \
  --batch-size=5 \
  --pool-size=350 \
  --active-limit=220 \
  --max-active=350 \
  --max-table-visible=25 \
  --risk-ratio=0.02 \
  --duration-hours=72
```

The feeder uses stable IDs and upserts. It can be stopped and resumed without rebuilding the databases. Its safety limits are:

- a hard pool ceiling of 350 active patrons;
- an active-patron target of about 220 for the live floor;
- a maximum of 25 visible patrons per table;
- a maximum batch size of five logical customers per cycle;
- a small risk ratio so responsible-play signals remain visible without flooding the demo.

Run it in the background with a PID file:

```bash
mkdir -p .runtime
nohup node scripts/realtime-source-feeder.mjs \
  --scenario=mixed --interval=15000 --batch-size=5 \
  --pool-size=350 --active-limit=220 --max-active=350 \
  --duration-hours=72 > .runtime/source-feeder.log 2>&1 &
echo $! > .runtime/source-feeder.pid
```

Check, follow, pause, and resume it:

```bash
PID=$(cat .runtime/source-feeder.pid)
kill -0 "$PID" 2>/dev/null && echo "feeder is running" || echo "feeder is stopped"
tail -f .runtime/source-feeder.log
kill -INT "$PID"
# start again with the nohup command above when needed
```

For a terminal-managed process, `screen -S source_feeder` starts a session, `Ctrl+A` then `D` detaches, `screen -r source_feeder` reattaches, and `screen -S source_feeder -X quit` stops that session.

## 7. Configure and run the local AI panel

The panel is a Next.js application. For an external TapData installation, the important server-side values are:

```dotenv
AI_PROVIDER=deepseek
AI_MODEL=deepseek-chat
AI_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=<deepseek-api-key>

TAPDATA_API_BASE_URL=http://<tapdata-api-host>:3080
TAPDATA_FIND_PATH_TEMPLATE=/api/v1/{collection}/find
TAPDATA_TOKEN_URL=http://<tapdata-manager-host>:3030/oauth/token
TAPDATA_CLIENT_ID=<oauth-client-id>
TAPDATA_CLIENT_SECRET=<oauth-client-secret>
TAPDATA_TOKEN_AUTH_METHOD=client_secret_post
TAPDATA_DEMO_FALLBACK=false
```

The path template must be exactly `/api/v1/{collection}/find` unless the TapData API uses another published route. A stray closing brace produces a URL such as `%7D` and a guaranteed 404.

The repository contains a default logical-to-published collection map. Override it only when the published service names differ. The most important mappings are:

| Panel logical collection | Published API name in the current demo |
| --- | --- |
| `patron_profiles` | `patron_profiles` |
| `patron_table_sessions` | `patron_table_sessions` |
| `patron_activity_events` | `patron_activity_events_ai_ready` |
| `patron_alerts` | `ops_patron_alerts_ai_ready` |
| `patron_risk_cases` | `responsible_play_cases_ai_ready` |
| `pr_assignments` | `host_assignments_ai_ready` |
| `pr_agent_profiles` | `pr_agent_profiles` |
| `patron_realtime_decision_signals` | `gaming_realtime_decision_signals_ai_ready` |
| `table_state_snapshots` | `gaming_table_state` |
| `table_state_history` | `gaming_table_state_history` |
| `table_round_history` | `gaming_player_round_bets` |
| `table_round_counters` | `gaming_table_round_counters` |
| `table_minbet_audit` | `gaming_table_minbet_audit` |
| `table_minbet_recommendations` | `gaming_table_minbet_recommendations` |

### Clone, configure and start the panel

If the repository has not been cloned yet, run:

```bash
git clone --branch codex/docker-demo-kit --single-branch \
  https://github.com/tapdata/casino-customer360-ai-dashboard.git
cd casino-customer360-ai-dashboard
```

For an existing checkout, update it first:

```bash
git switch codex/docker-demo-kit
git pull --ff-only origin codex/docker-demo-kit
```

Create the private panel environment, fill in the TapData, OAuth and AI values, install dependencies, and start the development panel:

```bash
cp .env.example .env.local
chmod 600 .env.local
# edit .env.local with the server-side values
npm install
npm run dev
```

Open `http://localhost:3000`. The default port is 3000. Stop a foreground panel with `Ctrl+C`. To run a production-style local process:

```bash
npm run build
npm start
```

`npm run dev` may also start the local AI proxy on port 8789 and the MongoDB audit bridge on port 8790 when their environment variables are configured. These helper ports are not the panel port.

Use `screen` if the panel must remain running after logout:

```bash
screen -S ai_panel
npm run dev
# Ctrl+A, then D to detach
screen -r ai_panel
# Ctrl+C to stop, or:
screen -S ai_panel -X quit
```

## 8. Panel behavior and persistence

The panel loads a complete patron snapshot server-side and caches it briefly so the UI remains responsive while TapData refreshes. `PATRONS_CACHE_FRESH_MS` controls the freshness window; `3000` milliseconds is a reasonable demo value. The cache is an optimization only. TapData remains the source of truth.

When `TAPDATA_DEMO_FALLBACK=true`, the panel can show the built-in anonymized dataset if TapData is unavailable. This is useful for UI development but can hide an upstream outage. Set it to `false` for a live-only handoff.

The main UI areas are:

- Live Operations Overview: table occupancy, active patrons and risk signals;
- Table Heatmap: table state, zone activity and table-level analysis;
- Customer 360: profile, tier, ADT, current session, risk and next-best-action;
- AI Chat: allow-listed, read-oriented queries against published APIs;
- Scenario Studio: controlled demo stories such as VIP return and responsible-play review;
- audit and approval flows: recommendations are governed before outreach.

The VIP upgrade journey is demo state, not a replacement for a source-system wagering ledger. It persists to the configured MongoDB audit database and collection `demo_upgrade_journeys`. The one-minute story uses current-session cumulative wager thresholds; it does not represent lifetime wagering.

Operational actions are written through `POST /api/audit/events` to `ai_action_events` in the configured audit database. Keep this audit database separate from the TapData source-of-truth collections.

## 9. TapData task and API checklist

Before blaming the panel, verify the data path in order:

- Each source connection can read the bootstrap tables.
- Each source CDC task is running and has completed its initial sync.
- FDM or merge nodes have the expected join keys and field mappings.
- MDM collections contain records and are not stuck in a failed task state.
- Published APIs are enabled and their names match `TAPDATA_COLLECTION_MAP`.
- The OAuth token endpoint accepts the configured client credentials.
- The panel process was restarted after changing `.env.local`.

The panel cannot see a source-row change until the change has passed through CDC, FDM/merge, MDM, and the published API. A feeder log showing a successful source write is therefore not proof that the panel should already have changed.

## 10. Troubleshooting

### `localhost:3000` refuses the connection

The panel process is not listening. Check:

```bash
ps -ef | grep -E 'next|vinext|npm run dev' | grep -v grep
screen -ls
```

Start it with `npm run dev` or reattach to the existing `screen` session.

### The panel shows demo data or stale data

Check `TAPDATA_DEMO_FALLBACK`, the browser network request, the panel log, and the TapData API directly. Confirm that the published API returns records for the same logical collections in the map. Then verify CDC/FDM/MDM task status and restart the panel after editing `.env.local`.

### TapData returns 404 with `%7D`

Use:

```dotenv
TAPDATA_FIND_PATH_TEMPLATE=/api/v1/{collection}/find
```

Remove any extra `}` after `{collection}` or `/find`. Also check that the published API name, not the source table name, is used in `TAPDATA_COLLECTION_MAP`.

### TapData OAuth returns 401 or token timeout

Check `TAPDATA_TOKEN_URL`, client ID, client secret, and `TAPDATA_TOKEN_AUTH_METHOD`. The panel supports `client_secret_post` and `client_secret_basic`. Do not put the credentials in browser code or a public Vercel variable.

### FDM merge reports a missing join key

Inspect the event after-image and the configured join fields. The common bridge is PostgreSQL `crm_identity_links.gaming_player_id` to Oracle `GAMING_TABLE_SESSIONS.PLAYER_ID`. The value must be present in the after image. The absence of a before image is not itself a reason to lose the after-image key.

### FDM target reports a unique-key violation

Check that the target primary key matches the source business key and that duplicate source records are not being generated. Typical keys are `master_player_id`, `customer_id`, `SESSION_ID`, `case_id`, and `assignment_id`. Clean or recreate the target table only after confirming the task's intended key; do not blindly delete source data.

### The feeder connects but no panel data changes

Check the feeder log, then check the matching TapData CDC task. If the task is full-sync only, it will not consume later updates. If the API is cached or the panel is using fallback data, the UI can remain unchanged even though the source write succeeded.

### One source is unavailable

The normal run expects all three sources. For a deliberate one-source diagnostic only, use `--allow-partial`; do not use partial mode for the final demo because it breaks cross-system joins.

## 11. Vercel deployment

Vercel runs the panel serverless application; it does not run the three-source feeder. Keep the feeder on a host that can reach Oracle, MSSQL, PostgreSQL and TapData. Vercel must reach the published TapData API over a routable address; `http://127.0.0.1:3080` only works when the panel and TapData are on the same machine.

Configure the Vercel project with the server-side variables from `.env.cloud.example`:

- AI provider and model;
- `DEEPSEEK_API_KEY` or the selected AI provider key;
- TapData API base URL, token URL and OAuth credentials;
- collection map and request timeouts;
- MongoDB audit/snapshot variables if persistence is required.

After changing environment variables, redeploy the Vercel project. The public URL is only the panel endpoint; it does not replace the TapData API, database connections, or feeder process.

## 12. Validation commands

Run these from the repository root before handoff:

```bash
npm run build
npm test
npm run lint
node scripts/realtime-source-feeder.mjs --dry-run
```

For a live rehearsal, verify all of the following:

- Each bootstrap SQL file completed without errors.
- The feeder reports successful writes to all three source systems.
- TapData CDC shows new source events.
- FDM/MDM tasks are running and published APIs return records.
- `http://localhost:3000` displays live data with fallback disabled.
- AI Chat returns evidence and names the queried collections.
- A recommendation action creates an audit record.

## 13. Security and ownership checklist

- Do not commit `.env.local`, `.env.source-feeder`, API keys, OAuth secrets, database passwords, SSH keys, licenses, or private TapData exports.
- Use a separate demo database and demo credentials.
- Keep TapData and MongoDB credentials server-side.
- Share the SQL and the feeder script through Git; share secrets through an approved password manager or secure transfer channel.
- Record the TapData task names, API names, hostnames, ports, and current owner before handing over.
- Record which process manager is used (`screen`, `systemd`, PM2, or Vercel) and where its logs are stored.

## 14. Handoff acceptance checklist

The receiving engineer should be able to complete this sequence without asking for implementation details:

```text
[ ] Clone the repository and install Node dependencies.
[ ] Run the three bootstrap SQL files in the correct databases.
[ ] Fill the private feeder environment and pass --dry-run.
[ ] Start one feeder cycle and confirm all three source writes.
[ ] Confirm CDC, FDM/merge, MDM and published APIs in TapData.
[ ] Fill the private panel environment and start npm run dev.
[ ] Open the panel on port 3000 with fallback disabled.
[ ] Confirm Customer 360, table heatmap, AI Chat and audit behavior.
[ ] Start the bounded feeder run and document the PID/log location.
[ ] Store credentials and operational ownership through the approved channel.
```
