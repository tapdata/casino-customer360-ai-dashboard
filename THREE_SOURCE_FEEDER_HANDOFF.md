# Three-Source Demo Feeder Handoff

This document is for the legacy casino demo feeder that writes demo events to
all three source systems:

- Oracle: `Oracle_Gaming_Core`
- Microsoft SQL Server: `MSSQL_Hotel_Ops`
- PostgreSQL: `PostgreSQL_Loyalty_CRM`

The executable script is
[`scripts/realtime-source-feeder.mjs`](scripts/realtime-source-feeder.mjs).
It is already included in the Git repository. Do not copy credentials into the
script or commit the local environment file.

## 1. What the feeder does

Each cycle upserts a small number of deterministic demo patrons across Oracle,
MSSQL, and PostgreSQL. TapData CDC then captures those source changes and
updates FDM/MDM and the published APIs used by the AI panel.

The feeder can create or update records in the configured demo range. It does
not drop databases or delete source records. Use it only with demo databases;
do not point it at production systems.

The source mapping is:

| Source | Main data |
| --- | --- |
| Oracle `C##GAMING` | Players, tables, sessions, rounds, and bets |
| MSSQL `dbo` | `hotel_stays`, `responsible_play_cases`, `host_assignments`, plus the AI-ready `host_assignments_ai_ready`, `responsible_play_cases_ai_ready`, and `ops_patron_alerts_ai_ready` tables |
| PostgreSQL `casino_loyalty` | CRM profiles, identity links, app activity, POS/F&B, and offers |

## 2. First-time setup

Use Node.js `22.13` or newer and run these commands from the repository root:

```bash
npm install
cp .env.source-feeder.example .env.source-feeder
chmod 600 .env.source-feeder
```

Edit `.env.source-feeder` and fill in the Oracle, MSSQL, and PostgreSQL
connection values. The template contains these defaults for the demo schemas:

```dotenv
ORACLE_SCHEMA=C##GAMING
MSSQL_DATABASE=casino_ops
MSSQL_SCHEMA=dbo
PGDATABASE=postgres
PGSCHEMA=casino_loyalty
```

The three database credentials and hostnames must be supplied by the operator.
Keep this file on the server only; it is ignored by Git.

## 3. Validate without writing

This command only prints the planned configuration. It does not connect to or
write any source database:

```bash
node scripts/realtime-source-feeder.mjs --dry-run
```

For the normal three-source run, all three source configurations are required.
Do not enable partial mode unless you are deliberately troubleshooting one
source:

```bash
FEEDER_ALLOW_PARTIAL=true node scripts/realtime-source-feeder.mjs --dry-run
```

## 4. Start the feeder

For a foreground rehearsal, run:

```bash
node scripts/realtime-source-feeder.mjs \
  --scenario=mixed \
  --interval=5000 \
  --batch-size=3 \
  --duration-hours=0
```

`--duration-hours=0` means run until stopped. The script prints the source
record identifiers and whether each event is an arrival, refresh, or departure.

To write one cycle only:

```bash
node scripts/realtime-source-feeder.mjs \
  --scenario=mixed \
  --batch-size=3 \
  --once
```

The repository also contains `scripts/mongo-source-feeder.mjs`, which is a
different MongoDB-only feeder for the newer Docker kit. The `npm run source:feed`
package commands point to that MongoDB-only script; they do **not** start the
Oracle/MSSQL/PostgreSQL feeder described in this document.

## 5. Run in the background

Create a small runtime directory and start one background process:

```bash
mkdir -p .runtime
nohup node scripts/realtime-source-feeder.mjs \
  --scenario=mixed \
  --interval=5000 \
  --batch-size=3 \
  --duration-hours=0 \
  > .runtime/source-feeder.log 2>&1 &
echo $! > .runtime/source-feeder.pid
```

Check its status and follow the log:

```bash
PID=$(cat .runtime/source-feeder.pid)
kill -0 "$PID" 2>/dev/null && echo "source feeder is running: $PID" || echo "source feeder is stopped"
tail -f .runtime/source-feeder.log
```

Expected log lines include:

```text
Connected Oracle_Gaming_Core.
Connected PostgreSQL_Loyalty_CRM.
Connected MSSQL_Hotel_Ops.
Wrote Oracle_Gaming_Core.
Wrote PostgreSQL_Loyalty_CRM.
Wrote MSSQL_Hotel_Ops.
```

## 6. Pause and resume

For a foreground run, press `Ctrl+C`. The script catches `SIGINT`, closes the
three database connections, and exits cleanly.

For the background run, send `SIGINT` to the recorded process:

```bash
PID=$(cat .runtime/source-feeder.pid)
kill -INT "$PID"
rm -f .runtime/source-feeder.pid
```

Check that it stopped:

```bash
pgrep -af 'scripts/realtime-source-feeder.mjs' || echo "source feeder is stopped"
```

Resume it by running the background start command again. The feeder uses stable
demo identifiers and upserts, so resuming does not require restoring the
databases again.

## 7. Troubleshooting

- `Missing database driver`: run `npm install` from the repository root.
- `Source connection attempt ... failed`: check host, port, credentials,
  firewall rules, schema names, and that the database service is running.
- `Source feeder expects all three sources`: one of the three connection blocks
  is incomplete. Fill all three blocks, or explicitly use partial mode for a
  one-source test.
- The script reports successful writes but the panel is unchanged: verify that
  the corresponding TapData CDC tasks are running, the MDM/API tasks have
  completed, and the panel is calling the published API. CDC and API refreshes
  can take several seconds.
- To stop old generated activity before a rehearsal, stop the normal feeder
  first, then use the explicit `--retire-player-range=START-END` option. This
  closes matching demo risk cases and sessions; it is not part of a normal tick.

Never put `.env.source-feeder` or database passwords in Git, chat messages, or
the feeder log.
