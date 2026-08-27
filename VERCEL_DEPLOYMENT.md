# Vercel Deployment Guide

This guide explains how to deploy the AI Loyalty Engine dashboard to Vercel.

The dashboard is now prepared as a Vercel-compatible Next.js application.

## 1. What runs on Vercel

Vercel should run only the request/response AI panel:

- Web UI
- `/api/data/patrons`
- `/api/ai/chat`
- `/api/audit/events`

Do not run these long-running workloads on Vercel:

- TapData CDC tasks
- Oracle / MSSQL / PostgreSQL databases
- MongoDB
- `scripts/realtime-source-feeder.mjs`
- Any 10-hour or 2-day background source simulation

Those should stay on a VM, local machine, or managed database/service.

## 2. Build commands

Use the standard Vercel / Next.js commands:

```bash
npm install
npm run build
npm run start
```

Vercel project settings:

| Setting | Value |
| --- | --- |
| Framework Preset | Next.js |
| Install Command | `npm install` |
| Build Command | `npm run build` |
| Output Directory | leave empty |
| Node.js Version | 22.x |

## 3. Required environment variables

Configure these in:

```text
Vercel Project → Settings → Environment Variables
```

### DeepSeek

```bash
AI_PROVIDER=deepseek
AI_MODEL=deepseek-chat
AI_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=<your-deepseek-api-key>
```

### TapData published APIs

Use public server addresses. Do not use `127.0.0.1` on Vercel. The AI panel is fully configuration-driven for TapData: change these `TAPDATA_*` values to point to another TapData gateway without changing source code.

```bash
TAPDATA_API_BASE_URL=http://<tapdata-api-host>:3080
TAPDATA_FIND_PATH_TEMPLATE=/api/v1/{collection}/find
TAPDATA_TOKEN_URL=http://<tapdata-token-host>:3030/oauth/token
TAPDATA_CLIENT_ID=<client-id>
TAPDATA_CLIENT_SECRET=<client-secret>
TAPDATA_TOKEN_AUTH_METHOD=client_secret_post
TAPDATA_SCAN_LIMIT=5000
```

Local / VM deployments can copy the focused template first:

```bash
cp .env.tapdata.example .env.local
```

If MDM service names differ from the AI panel's logical collection names, also configure:

```bash
TAPDATA_COLLECTION_MAP={"alert_rules":"ops_alert_rules","campaign_runs":"marketing_campaign_runs","chat_messages":"ai_chat_messages_src","chat_sessions":"ai_chat_sessions_src","offer_approval_audit":"ai_offer_approval_audit_src","offer_catalog":"offer_catalog","offer_recommendations":"ai_offer_recommendations_src","patron_activity_events":"patron_activity_events_ai_ready","patron_alerts":"ops_patron_alerts_ai_ready","patron_analysis_reports":"ai_patron_analysis_reports_src","patron_interaction_history":"patron_interaction_history_ai_ready","patron_profiles":"patron_profiles","patron_realtime_decision_signals":"gaming_realtime_decision_signals_ai_ready","patron_risk_cases":"responsible_play_cases_ai_ready","patron_table_sessions":"patron_table_sessions","pr_agent_profiles":"pr_agent_profiles","pr_assignments":"host_assignments_ai_ready","table_minbet_audit":"gaming_table_minbet_audit","table_minbet_recommendations":"gaming_table_minbet_recommendations","table_round_counters":"gaming_table_round_counters","table_round_history":"gaming_player_round_bets","table_state_history":"gaming_table_state_history","table_state_snapshots":"gaming_table_state"}
```

### MongoDB audit persistence

The AI panel uses MongoDB only for action audit trail, for example:

- recommendation approved
- recommendation rejected
- recommendation sent
- risk alert sent
- risk alert closed

```bash
MONGO_AUDIT_HOST=<mongo-host>:27017
MONGO_AUDIT_USER=<mongo-user>
MONGO_AUDIT_PASSWORD=<mongo-password>
MONGO_AUDIT_AUTH_DB=admin
MONGO_AUDIT_AUTH_MECHANISM=SCRAM-SHA-256
MONGO_AUDIT_DB=ai_loyalty_engine
MONGO_AUDIT_COLLECTION=ai_action_events
```

Important:

```bash
MONGO_AUDIT_HTTP_URL=
```

Leave `MONGO_AUDIT_HTTP_URL` empty on Vercel. If it points to `127.0.0.1`, Vercel will try to call itself and audit persistence will appear offline.

## 4. Network requirements

Vercel must be able to reach:

- TapData API host and port, usually `:3080`
- TapData OAuth token host and port, usually `:3030`
- MongoDB audit host and port, usually `:27017`
- DeepSeek API: `https://api.deepseek.com`

If a firewall is enabled on the cloud server, allow inbound access from Vercel or place TapData/MongoDB behind a public HTTPS API gateway.

For production, HTTPS is strongly recommended for TapData and MongoDB access.

## 5. Deploy from GitHub

1. Push the Vercel branch to GitHub.
2. Open Vercel.
3. Import the repository.
4. Select the branch.
5. Add the environment variables above.
6. Click Deploy.

## 6. Post-deploy checks

Open the Vercel URL and check:

- Customer 360 loads real patrons.
- Table heatmap shows active tables and patrons.
- AI Chat returns `mode: live`, not simulated mode.
- Approve / send / close actions write to `ai_action_events`.
- No browser console error mentions `127.0.0.1`.

API checks:

```bash
curl -sS https://<your-vercel-domain>/api/data/patrons
curl -sS https://<your-vercel-domain>/api/audit/events
```

## 7. Source feeder location

The source feeder must run outside Vercel.

Local or VM command:

```bash
node scripts/realtime-source-feeder.mjs \
  --scenario=mixed \
  --interval=15000 \
  --start-player-id=109000 \
  --pool-size=350 \
  --active-limit=220 \
  --duration-hours=10 \
  --max-events=2400
```

This keeps the demo CDC story realistic:

- maximum active customer pool is controlled
- table patron count is capped
- risk/alarm patrons stay around 2% of active floor
- TapData captures source changes and pushes them through FDM/MDM to published APIs
