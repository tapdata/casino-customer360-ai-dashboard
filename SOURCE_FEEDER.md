# Real-Time Source Feeder

This feeder continuously writes demo source data into the three upstream systems so TapData CDC can capture real changes and drive the AI panel.

## Source systems

| Database | TapData connection name | Business system |
|---|---|---|
| Oracle | `Oracle_Gaming_Core` | Casino gaming core: player account, table state, active table sessions, rounds and betting activity. |
| MSSQL | `MSSQL_Hotel_Ops` | Hotel / PMS, host operations, responsible-play cases and operational alerts. |
| PostgreSQL | `PostgreSQL_Loyalty_CRM` | Loyalty CRM, identity links, customer profile, app behavior, POS/F&B and offer response signals. |

## Install drivers

The script uses database drivers only when it runs. Install them once:

```bash
npm install pg mssql oracledb
```

## Configure

Copy the template and fill credentials locally:

```bash
cp .env.source-feeder.example .env.source-feeder
```

Do not commit `.env.source-feeder`.

## Run

Dry run, no database writes:

```bash
npm run source:feed:dry-run
```

Write one cross-system customer event package:

```bash
npm run source:feed:once
```

Write continuously every 15 seconds:

```bash
npm run source:feed
```

Run a bounded local feeder for 10 hours, one batch every 15 seconds:

```bash
node scripts/realtime-source-feeder.mjs --scenario=mixed --interval=15000 --start-player-id=109000 --pool-size=350 --active-limit=220 --duration-hours=10 --max-events=2400
```

For the demo run, `--pool-size=350` means the script rotates through a stable pool of up to 350 demo patrons. `--active-limit=220` keeps the live floor busy but leaves a visible inactive customer population for Customer 360. The first pass creates new customers; later passes update the same source records. Some patrons are periodically marked inactive, so TapData CDC sees both arrivals and departures without creating an uncontrolled number of active VIPs.

The table assignment uses a controlled heat distribution: a few tables become naturally hot, some remain quiet or empty, VIP patrons lean toward VIP tables, and no table is allowed to exceed 25 visible patrons including seated guests and standing observers.

If previous demo runs left too many active patrons on the floor, retire that old generated range before starting the new run:

```bash
node scripts/realtime-source-feeder.mjs --scenario=mixed --interval=15000 --start-player-id=109000 --pool-size=350 --active-limit=220 --duration-hours=10 --max-events=2400 --retire-player-range=105000-108999
```

This does not delete source records. It only marks old generated Oracle table sessions inactive and closes old generated MSSQL risk cases / alerts so the AI panel stops counting stale activity.

Optional parameters:

```bash
node scripts/realtime-source-feeder.mjs --scenario=risk --once
node scripts/realtime-source-feeder.mjs --scenario=high_value_return --interval=15000
node scripts/realtime-source-feeder.mjs --start-player-id=106000
node scripts/realtime-source-feeder.mjs --batch-size=3
node scripts/realtime-source-feeder.mjs --duration-hours=2
node scripts/realtime-source-feeder.mjs --pool-size=350 --active-limit=220
node scripts/realtime-source-feeder.mjs --retire-player-range=105000-108999 --once
```

By default, real writes require all three source connections to be configured. For one-source troubleshooting only:

```bash
FEEDER_ALLOW_PARTIAL=true npm run source:feed:once
```

## What one tick writes

Every tick creates or updates one logical customer across all three source systems:

```text
Oracle Gaming      player_id
MSSQL Hotel/Ops    guest_id
PostgreSQL CRM     customer_id + pos_member_no
        ↓
Master Player ID   P0000xxxxxx
```

Oracle writes:

- `GAMING_PLAYER_ACCOUNT`
- `GAMING_PLAYER_RATINGS`
- `GAMING_TABLE_STATE`
- `GAMING_TABLE_STATE_HISTORY`
- `GAMING_TABLE_SESSIONS`
- `GAMING_PLAYER_ROUND_BETS`
- `GAMING_TABLE_ROUND_COUNTERS`

MSSQL writes:

- `hotel_stays`
- `responsible_play_cases`
- `host_assignments`
- `ops_patron_alerts` for risk scenarios

PostgreSQL writes:

- `crm_identity_links`
- `crm_patron_profiles`
- `app_activity_events`
- `pos_fnb_checks`
- `crm_offer_responses`

The script reads table columns before writing and only sends fields that currently exist. This is intentional because some demo columns, such as embedding arrays, were removed from the source schema.

## Demo scenarios

| Scenario | Effect |
|---|---|
| `normal` | Active healthy customer, suitable for governed recommendation. |
| `high_value_return` | Diamond or high-value patron returns to the floor; AI should recommend hospitality. |
| `risk` | Small number of active responsible-play signals; AI should block incentives and route to administrator review. |
| `offer_fatigue` | Customer shows repeated marketing fatigue; AI should reduce outreach. |
| `host_overdue` | Host follow-up SLA has passed; AI should create or escalate a host action. |
| `inactive` | Customer exists in CRM but is currently not on the floor. |
| `mixed` | Uses a realistic distribution: mostly normal / high-value / host-follow-up, a few risks, and a few inactive patrons. |

## Expected TapData story

```text
Feeder writes source changes
→ TapData CDC captures Oracle / MSSQL / PostgreSQL updates
→ FDM receives source-shaped MongoDB collections
→ TapData MDM merge tasks generate patron_profiles and patron_table_sessions
→ MDM 1:1 tasks publish the remaining AI-ready collections
→ TapData published APIs expose the MDM services
→ AI panel polls every 8 seconds and updates the dashboard / Customer 360 / AI Chat
```
