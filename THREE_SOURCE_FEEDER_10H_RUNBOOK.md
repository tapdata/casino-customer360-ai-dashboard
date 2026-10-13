# Three-Source Demo Feeder: 10-Hour Run

This runbook starts the casino demo feeder that writes simulated customer events
to Oracle, Microsoft SQL Server, and PostgreSQL. TapData CDC then carries those
changes to the FDM/MDM collections and the AI panel.

The executable is:

`scripts/realtime-source-feeder.mjs`

It is different from `scripts/generate_full_seed_15plus.mjs`, which only
creates one-time SQL seed files, and from `scripts/mongo-source-feeder.mjs`,
which writes MongoDB only.

## 1. Prepare the server

Run from the repository root:

```bash
node --version
npm install
cp .env.source-feeder.example .env.source-feeder
chmod 600 .env.source-feeder
```

Fill in `.env.source-feeder` with the Oracle, MSSQL, and PostgreSQL connection
values. The expected demo schemas are:

```dotenv
ORACLE_SCHEMA=C##GAMING
MSSQL_DATABASE=casino_ops
MSSQL_SCHEMA=dbo
PGDATABASE=postgres
PGSCHEMA=casino_loyalty
```

Keep `.env.source-feeder` on the server. Do not commit or send it because it
contains database credentials.

Before writing data, validate the command:

```bash
node scripts/realtime-source-feeder.mjs --dry-run
```

## 2. Start the 10-hour run

Use a single backslash at the end of each continued shell line:

```bash
node scripts/realtime-source-feeder.mjs \
  --scenario=mixed \
  --interval=15000 \
  --pool-size=350 \
  --active-limit=220 \
  --duration-hours=10 \
  --max-events=2400
```

The command writes one simulated customer event every 15 seconds. It stops
when either 10 hours have elapsed or 2,400 events have been written. The three
source systems are written as one logical customer event:

- Oracle: gaming account, ratings, table session, round/bet signals;
- MSSQL (`casino_ops.dbo`): `hotel_stays`, `responsible_play_cases`,
  `host_assignments`, and risk-only `ops_patron_alerts`;
- PostgreSQL: identity link, patron profile, app/POS/offer signals.

The MSSQL initialization/rebuild package also creates the static reference
tables `room_inventory`, `pr_agent_profiles`, and `ops_alert_rules`. The
continuous feeder does not rewrite those three tables on every cycle.

## 3. Parameter meaning

| Option | Value | Meaning |
|---|---:|---|
| `--scenario` | `mixed` | Rotates normal, high-value, risk, offer-fatigue, and host-overdue signals. |
| `--interval` | `15000` | Waits 15,000 ms, or 15 seconds, between cycles. |
| `--pool-size` | `350` | Reuses a stable demo pool of up to 350 customers. |
| `--active-limit` | `220` | Keeps the simulated live floor at no more than about 220 active customers. |
| `--duration-hours` | `10` | Stops automatically after 10 hours. |
| `--max-events` | `2400` | Stops automatically after 2,400 customer events. |
| omitted `--batch-size` | default `1` | Writes one customer event per cycle for this command. |

The feeder uses upserts and stable demo identifiers. Restarting it does not
create a new database or delete the existing source records.

## 4. Run in the background

Use this form when the SSH session may close:

```bash
mkdir -p .runtime
nohup node scripts/realtime-source-feeder.mjs \
  --scenario=mixed \
  --interval=15000 \
  --pool-size=350 \
  --active-limit=220 \
  --duration-hours=10 \
  --max-events=2400 \
  > .runtime/source-feeder.log 2>&1 &
echo $! > .runtime/source-feeder.pid
```

Check the process and log:

```bash
PID=$(cat .runtime/source-feeder.pid)
kill -0 "$PID" 2>/dev/null && echo "feeder is running: $PID" || echo "feeder is stopped"
tail -f .runtime/source-feeder.log
```

Expected startup output includes:

```text
Real-time source feeder starting. scenario=mixed, interval=15000ms
Connected Oracle_Gaming_Core.
Connected PostgreSQL_Loyalty_CRM.
Connected MSSQL_Hotel_Ops.
```

## 5. Stop, pause, or resume

Stop a foreground run with `Ctrl+C`. For a background run:

```bash
PID=$(cat .runtime/source-feeder.pid)
kill -INT "$PID"
rm -f .runtime/source-feeder.pid
```

Verify that it stopped:

```bash
pgrep -af 'scripts/realtime-source-feeder.mjs' || echo "feeder is stopped"
```

Resume by running the background command again. No database restore is
required.

## 6. If the panel does not change

Check these in order:

1. The feeder log shows successful writes to all three sources.
2. The TapData Oracle/MSSQL/PostgreSQL CDC tasks are running.
3. FDM/MDM merge and API tasks have finished.
4. The published API points to the expected MDM collections.
5. The AI panel is using the correct API URL and token.

This feeder only writes the source databases. It does not start TapData,
publish APIs, or start the AI panel.
