# AI Loyalty Engine Demo — Project Handoff

Last updated: 2026-08-25  
Local project path: `/Users/yangshikun/Documents/ChatGPT/Mogo Demo`

This document is written for the next engineer or AI assistant who needs to continue the project without replaying the full conversation.

## 1. Business objective

The demo objective is to show how a casino can identify a VIP guest while the guest is still active on the floor, understand the guest's value, behavior, current need, and risk context, then generate a governed next-best-action.

The key message is not only “AI recommends an offer.” The stronger story is:

```text
real-time heterogeneous data
→ TapData CDC / merge / cleansing
→ MongoDB MDM collections
→ TapData published APIs
→ AI analysis
→ trusted approval / risk governance
→ customer outreach
→ auditable action trail
```

The AI panel should make this story visible during a live demo.

## 2. Local startup

```bash
cd "/Users/yangshikun/Documents/ChatGPT/Mogo Demo"
npm run dev
```

Do not run `vinext dev` directly. `npm run dev` starts additional local helper processes:

- AI relay for local proxy scenarios.
- Mongo audit bridge for action persistence.
- Vinext dev server.

Expected local audit bridge output:

```text
Local Mongo audit bridge ready on http://127.0.0.1:8790
```

If the UI says the Mongo write bridge is not started, restart with `npm run dev`.

## 3. Important files

| File | Purpose |
|---|---|
| `app/page.tsx` | Legacy approval / workbench page with customer analysis, recommendations, sending, risk alerts, and audit hints. |
| `app/command-center.tsx` | Current menu-based AI panel: overview, table heatmap, AI Chat, Customer 360, Scenario Studio, Data Simulator. |
| `app/api/data/patrons/route.ts` | Server-side data adapter. Reads TapData APIs and aggregates profiles, sessions, risks, offers, alerts, and table state for the UI. |
| `app/api/ai/chat/route.ts` | AI Chat route. Supports DeepSeek / OpenAI-compatible calls and whitelisted data-query tools. |
| `app/api/audit/events/route.ts` | Action audit API. Forwards approval, send, and risk events to the audit bridge. |
| `app/api/tapdata-collections.ts` | Logical collection names and TapData collection mapping support. |
| `scripts/dev.mjs` | Development launcher. Starts the local relay, audit bridge, and app server. |
| `scripts/mongo-audit-bridge.mjs` | Node process that writes audit events to MongoDB using the MongoDB driver. |
| `.env.local` | Local real credentials. Must not be committed. |
| `.env.example` | Local environment template. |
| `.env.cloud.example` | Cloud deployment environment template. |
| `README.md` | Public project overview. |

## 4. Environment model

Real secrets are kept in `.env.local` or in cloud deployment environment variables. Do not copy them into Markdown files or source code.

Representative environment variables:

```env
AI_PROVIDER=deepseek
AI_MODEL=deepseek-chat
AI_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=...

TAPDATA_API_BASE_URL=http://<tapdata-api-host>:3080
TAPDATA_FIND_PATH_TEMPLATE=/api/v1/{collection}/find
TAPDATA_TOKEN_URL=http://<tapdata-token-host>:3030/oauth/token
TAPDATA_CLIENT_ID=...
TAPDATA_CLIENT_SECRET=...
TAPDATA_TOKEN_AUTH_METHOD=client_secret_post
TAPDATA_SCAN_LIMIT=5000

MONGO_AUDIT_HOST=<mongo-host>:27017
MONGO_AUDIT_USER=<mongo-user>
MONGO_AUDIT_PASSWORD=...
MONGO_AUDIT_AUTH_DB=<auth-db>
MONGO_AUDIT_AUTH_MECHANISM=SCRAM-SHA-256
MONGO_AUDIT_DB=ai_loyalty_engine
MONGO_AUDIT_COLLECTION=ai_action_events
LOCAL_AUDIT_RELAY_PORT=8790
MONGO_AUDIT_HTTP_URL=http://127.0.0.1:8790
```

Mongo audit notes:

- Authentication mechanism: `SCRAM-SHA-256`.
- Default audit database: `ai_loyalty_engine`.
- Default audit collection: `ai_action_events`.
- The app does not import the MongoDB driver inside the browser-facing bundle.
- Local audit writes go through `scripts/mongo-audit-bridge.mjs`.

## 5. TapData API model

The current MDM API convention is:

```text
POST /api/v1/{published_service_name}/find
GET  /api/v1/{published_service_name}/
```

The AI panel uses logical collection names internally and maps them to the MDM-published service names through `TAPDATA_COLLECTION_MAP`.

Core logical collections:

```text
alert_rules
campaign_runs
chat_messages
chat_sessions
offer_approval_audit
offer_catalog
offer_recommendations
patron_activity_events
patron_alerts
patron_analysis_reports
patron_interaction_history
patron_profiles
patron_realtime_decision_signals
patron_risk_cases
patron_table_sessions
pr_agent_profiles
pr_assignments
table_minbet_audit
table_minbet_recommendations
table_round_counters
table_round_history
table_state_history
table_state_snapshots
```

Typical MDM published service names include:

```text
gaming_table_state
gaming_table_state_history
gaming_table_round_counters
gaming_player_round_bets
gaming_table_minbet_audit
gaming_table_minbet_recommendations
patron_activity_events_ai_ready
patron_interaction_history_ai_ready
responsible_play_cases_ai_ready
ops_patron_alerts_ai_ready
host_assignments_ai_ready
gaming_realtime_decision_signals_ai_ready
```

## 6. TapData task design

The latest integration approach is:

```text
Oracle / MSSQL / PostgreSQL
→ TapData 1:1 CDC into MongoDB FDM
→ TapData rename / normalize into consistent FDM fields
→ TapData master-detail merge into MongoDB MDM
→ TapData API publishing from MDM
→ AI panel reads published APIs
```

The simplified task design keeps only two merge tasks:

1. Generate `patron_profiles`.
2. Generate `patron_table_sessions`.

Other collections can be handled as direct 1:1 CDC / copy tasks into the MDM-ready shape whenever possible. This keeps the demo stable and avoids overloading the live TapData setup with too many join pipelines.

### Join task 1: `patron_profiles`

Purpose: prove that multiple source-system IDs belong to the same guest and build the Customer 360 profile.

Recommended master table:

```text
MongoDB FDM / fdm_pg_crm_identity_links
```

Typical source identity example:

```text
Oracle Gaming      PLAYER_ID   = 100861
MSSQL Hotel/Ops    guest_id    = H002918
PostgreSQL Loyalty customer_id = C88921
PostgreSQL POS     member_no   = VIP100861

Master Player ID   patronId    = P0000100861
```

Join sources:

| Source system | FDM source | Join condition | Output style |
|---|---|---|---|
| PostgreSQL Loyalty | `fdm_pg_crm_patron_profiles` | `crm_identity_links.crm_customer_id = crm_patron_profiles.customer_id` | flatten |
| Oracle Gaming | `fdm_oracle_gaming_player_account` | `crm_identity_links.gaming_player_id = gaming_player_account.player_id` | flatten |
| Oracle Gaming | `fdm_oracle_gaming_player_ratings` | `crm_identity_links.gaming_player_id = gaming_player_ratings.player_id` | flatten or latest rating summary |
| MSSQL Hotel/Ops | `fdm_mssql_hotel_stays` | `crm_identity_links.hotel_guest_id = hotel_stays.guest_id` | embedded document, e.g. `hotelSnapshot` |

### Join task 2: `patron_table_sessions`

Purpose: show who is currently at the table, current wager/stack, behavior tags, active risk count, and service context.

Recommended master table:

```text
MongoDB FDM / fdm_oracle_gaming_table_sessions
```

Join sources:

| Source system | FDM source | Join condition | Output style |
|---|---|---|---|
| PostgreSQL Loyalty | `fdm_pg_crm_identity_links` | `table_sessions.player_id = crm_identity_links.gaming_player_id` | flatten identity fields |
| PostgreSQL Loyalty | `fdm_pg_crm_patron_profiles` | `crm_identity_links.crm_customer_id = crm_patron_profiles.customer_id` | flatten profile fields |
| MSSQL Responsible Play | `fdm_mssql_responsible_play_cases` | `crm_identity_links.hotel_guest_id = responsible_play_cases.guest_id` or normalized `patronId` | embedded array, e.g. `risks` |
| MSSQL Host Ops | `fdm_mssql_host_assignments` | normalized `patronId` or `hotel_guest_id` | embedded document, e.g. `assignment` |
| PostgreSQL App/POS | optional activity tables | normalized `patronId` | embedded arrays, e.g. `recentActivities`, `interactions` |

Important TapData setting:

- If the target field should hold multiple records, use embedded array and fill the array write path.
- If the target field is a single summary object, use embedded document and fill the document write path.
- Avoid mapping one source table to two different targets in a single join task.

## 7. Current UI capabilities

### Menu-based AI panel

Implemented in `app/command-center.tsx`.

Left menu:

- Operations Overview
- Table Heatmap
- AI Chat
- Customer 360
- Scenario Studio
- Data Simulator

This structure was chosen because the demo owner explicitly did not want all modules on one crowded page.

### Operations Overview

Reads live TapData API data and shows:

- total tables
- active patrons
- risk patrons
- hottest zone
- hot table ranking
- zone signal
- floor pulse mini-map

The front end refreshes every 3 seconds when auto-refresh is enabled.

### Table Heatmap

Aggregates table status from sessions and table state data:

- occupancy
- active patrons
- session wager
- risk signals
- VIP count
- live / hot / risk / closed state

Interactions:

- Clicking a table opens a centered Table AI Analysis modal.
- Clicking the backdrop closes the modal.
- `Esc` closes the modal.
- The modal can open AI Chat with a prefilled table-analysis prompt.

### AI Chat

Implemented in `app/api/ai/chat/route.ts`.

The route supports DeepSeek / OpenAI-compatible chat completions and controlled tool calls.

Supported query themes:

- patron
- session
- table
- offer
- risk
- alert
- real-time decision signal

For next-best-action, offer, governance, or scenario-demo questions, the route should prefer the decision signal collection when available.

If live TapData APIs are unavailable, the route falls back to simulated data.

### Customer 360

Features:

- customer search
- customer filters
- profile, tier, region, preferences
- active session
- risk status
- Trusted Next Best Action
- approval and governance flow

Governance behavior:

- Healthy customers are not labeled as risk cases.
- Healthy customers show governance / approval steps.
- Risk customers show risk control and escalation.
- `LateNight` is a service signal, not a risk signal.
- A selected customer receives a recommendation based on profile, current session, points, preferences, and risk status.
- Once a recommendation has been sent, the UI shows the sent state instead of repeatedly showing the send button.
- A new recommendation becomes available only when the recommendation fingerprint changes.

Risk triggers include:

- `activeRiskCount > 0`
- `CardCounterWatch`
- `Aggressive`
- `HighVariance`
- `ResponsiblePlay`
- `SelfExcluded`
- `RG-*`

### Scenario Studio

Current status: templates and demo scripts are implemented. Full automatic scenario detection from live `patron_realtime_decision_signals` is still a recommended next enhancement.

Current scenario templates:

| Scenario | Trigger | Story |
|---|---|---|
| High-value return | `high_value_return` | Dormant VIP returns and receives non-gaming hospitality. |
| Table capacity pressure | `zone_b_capacity_pressure` | A zone becomes crowded and operations should rebalance capacity. |
| Responsible-play escalation | `responsible_play_review` | Incentives are blocked and an administrator is notified. |
| Offer fatigue | `offer_fatigue` | AI reduces outreach frequency due to repeated ignored offers. |
| Host follow-up overdue | `host_followup_overdue` | A host task is generated for delayed follow-up. |
| Data quality anomaly | `impossible_occupancy` | Data quality and governance are demonstrated. |

Recommended next implementation:

```text
TapData CDC updates source systems
→ MDM collection updates
→ AI panel polls every 3 seconds
→ Scenario Studio highlights the matching story
→ AI Chat explains evidence and next action
→ approval / WhatsApp / audit trail closes the loop
```

### Data Simulator

The simulator is for local rehearsal. It does not write business data into MongoDB. It can inject local browser-level session changes for safe UI rehearsals.

## 8. Audit trail

UI actions call:

```text
POST /api/audit/events
```

Supported action types:

```text
risk_alert_sent
risk_alert_closed
recommendation_approved
recommendation_rejected
recommendation_sent
```

Expected UX:

- Sending an alert or recommendation updates the UI immediately.
- If Mongo audit write succeeds, the UI indicates that the action was persisted.
- If the local bridge is not running, the UI tells the user to restart with `npm run dev`.
- If audit persistence is not configured, the UI still shows the front-end state but indicates that Mongo persistence is unavailable.

## 9. Design preferences from the demo owner

- Use a clear, bright UI. Avoid dark low-contrast colors.
- Use larger, readable typography.
- Keep modules separated by the left menu.
- Support Simplified Chinese, Traditional Chinese, and English in the UI.
- Make the AI story visible; avoid presenting only raw data tables.
- Highlight TapData CDC, merge, cleansing, MongoDB, AI decisioning, governance approval, notification, and audit.
- Table heatmap must be clickable and lead to AI analysis.
- AI Chat must actually call the AI provider and query live TapData data through server-side tools.
- Healthy customers should be described as governance / approval cases, not risk-control cases.

## 10. Regression status

Run:

```bash
npm test
npm run lint
```

The test suite currently covers:

- build
- server rendering
- AI Chat simulated collection flow
- governed delivery
- no secrets rendered to the client

## 11. Recommended next work

Priority: make Scenario Studio detect live MDM scenario signals automatically.

Suggested implementation:

1. Add `app/api/data/scenario-signals/route.ts`.
2. Read the decision signal service, usually mapped from `patron_realtime_decision_signals`.
3. Support filters by `triggerType`, `patronId`, and `tableId`.
4. Poll the endpoint every 3 seconds from `app/command-center.tsx`.
5. Show a live badge on the matching scenario card.
6. When a live scenario is selected, display the real MDM record instead of template JSON.
7. Prefill AI Chat with an evidence-based analysis prompt.

Example prompt:

```text
Analyze the live decision signal for triggerType=<trigger>.
Patron: <patronId>. Table: <tableId>.
Explain the trigger reason, data evidence, AI judgement, governance decision, and next-best-action.
```

## 12. Do not do

- Do not commit `.env.local`.
- Do not put real secrets, API keys, tokens, passwords, private keys, or server certificates into Markdown or source code.
- Do not expose database credentials to the browser.
- Do not import the MongoDB driver directly into browser-facing runtime bundles.
- Do not label healthy customers as risk cases.
- Do not claim Scenario Studio has full live auto-detection until that enhancement is implemented.
- Do not run `vinext dev` directly for local demo work; use `npm run dev`.
