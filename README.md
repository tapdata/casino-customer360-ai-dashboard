# AI Loyalty Engine Command Center

An international demo application for casino customer intelligence, real-time operations, and governed next-best-action.

The system tells a complete data-to-decision story:

```text
Source systems → TapData CDC / merge / cleansing → MongoDB MDM → TapData APIs → AI panel → approval / notification / audit
```

The AI panel does not connect directly to Oracle, MSSQL, PostgreSQL, or MongoDB business collections from the browser. It reads server-side APIs, uses an AI provider such as DeepSeek, and keeps all secrets on the server.

## What the demo shows

- Real-time operations dashboard for casino floor status.
- Live table heatmap with clickable AI analysis.
- Customer 360 with profile, preferences, current session, risk signals, and next-best-action.
- AI Chat that can query approved TapData API collections through controlled server-side tools.
- Trusted / governed recommendation flow before customer outreach.
- Risk alert routing and action audit trail.
- Scenario Studio for telling demo stories such as VIP return, table pressure, responsible-play escalation, and offer fatigue.

## Local development

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

`npm run dev` starts the Vercel-compatible Next.js development server. The earlier Cloudflare/Vinext commands are still available as `npm run dev:cloudflare`, `npm run build:cloudflare`, and `npm run start:cloudflare`.

When external credentials are not configured, the AI Chat falls back to simulated collections whose structure mirrors the TapData-published MongoDB collections. The fallback still executes the same logical flow:

```text
identify intent → query approved collection → aggregate evidence → return an explainable answer
```

Responses generated from fallback data are clearly marked as simulated.

## Real-time source feeder

To demo real CDC changes, use the source feeder to continuously insert or update matching customer events in Oracle, MSSQL, and PostgreSQL:

```bash
npm install pg mssql oracledb
cp .env.source-feeder.example .env.source-feeder
npm run source:feed
```

The feeder writes one logical casino customer across the three source systems every 15 seconds by default. TapData CDC can then capture the changes, merge them into MongoDB MDM collections, publish APIs, and refresh the AI panel. See `SOURCE_FEEDER.md` for the full runbook.

## Configure DeepSeek AI and TapData APIs

Copy `.env.example` to `.env.local` and fill in the server-side values:

```bash
cp .env.example .env.local
```

For an external TapData gateway, you can also copy the focused TapData template:

```bash
cp .env.tapdata.example .env.local
```

The AI panel reads TapData only through configuration. To switch from local TapData to an external TapData service, change the `TAPDATA_*` values; no source-code change is required.

Key variables:

- `AI_PROVIDER`: use `deepseek` for the cloud demo.
- `AI_MODEL`: default is `deepseek-chat`.
- `DEEPSEEK_API_KEY`: server-side only; never expose it in browser code.
- `AI_BASE_URL`: DeepSeek default is `https://api.deepseek.com`.
- `LOCAL_AI_PROXY`: optional local-only proxy for development networks that need it.
- `TAPDATA_API_BASE_URL`: TapData published API base URL.
- `TAPDATA_FIND_PATH_TEMPLATE`: current MDM pattern, for example `/api/v1/{collection}/find`.
- `TAPDATA_COLLECTION_MAP`: optional logical-name to published-service-name mapping.
- `TAPDATA_TOKEN_URL`, `TAPDATA_CLIENT_ID`, `TAPDATA_CLIENT_SECRET`: OAuth2 Client Credentials used by the server.
- `TAPDATA_TOKEN_AUTH_METHOD`: `client_secret_post` by default, or `client_secret_basic`.
- `TAPDATA_ACCESS_TOKEN`: optional fixed bearer token for short local debugging only.
- `TAPDATA_SCAN_LIMIT`: maximum records scanned locally if the published API ignores the filter object.
- `PATRONS_CACHE_FRESH_MS`: dashboard snapshot freshness window. The first load waits for TapData; later polls return the last complete snapshot immediately while one background refresh runs, even when the snapshot is older than the freshness window.

Example external TapData configuration:

```bash
TAPDATA_API_BASE_URL=http://<tapdata-api-host>:3080
TAPDATA_FIND_PATH_TEMPLATE=/api/v1/{collection}/find
TAPDATA_TOKEN_URL=http://<tapdata-auth-host>:3030/oauth/token
TAPDATA_CLIENT_ID=<client-id>
TAPDATA_CLIENT_SECRET=<client-secret>
TAPDATA_TOKEN_AUTH_METHOD=client_secret_post
TAPDATA_SCAN_LIMIT=5000
```

Example architecture:

```text
Browser
  ↓
/api/ai/chat
  ↓
DeepSeek Chat Completions
  ↓ controlled tool call
TapData published API
  ↓
MongoDB MDM collections
```

The model never receives database credentials. It can only call server-side whitelisted tools, and those tools perform read-only queries against TapData published APIs.

## Vercel deployment

This project can be deployed as a standard Next.js app on Vercel.

```bash
npm run build
```

Then import the GitHub repository in Vercel and configure the variables from `.env.cloud.example` under Project Settings → Environment Variables. See `VERCEL_DEPLOYMENT.md` for the production checklist.

## MongoDB audit persistence

The panel records operational actions such as:

- risk alert sent
- risk alert closed
- recommendation approved
- recommendation rejected
- recommendation sent

The browser calls:

```text
POST /api/audit/events
```

During local development, the request is forwarded to a local Node audit bridge. The bridge uses the MongoDB driver and writes to the audit database. This avoids bundling the MongoDB driver into the Worker/Sites runtime.

Default audit destination:

- Database: `ai_loyalty_engine`
- Collection: `ai_action_events`

Environment example:

```bash
MONGO_AUDIT_HOST=<mongo-host>:27017
MONGO_AUDIT_USER=<mongo-user>
MONGO_AUDIT_PASSWORD=<mongo-password>
MONGO_AUDIT_AUTH_DB=<auth-db>
MONGO_AUDIT_AUTH_MECHANISM=SCRAM-SHA-256
MONGO_AUDIT_DB=ai_loyalty_engine
MONGO_AUDIT_COLLECTION=ai_action_events
LOCAL_AUDIT_RELAY_PORT=8790
```

You can also configure only `MONGO_AUDIT_URI` if that is preferred.

## Validation

```bash
npm run build
npm test
npm run lint
```

The test suite checks:

- production build
- server-rendered menu-first UI
- AI Chat fallback query flow
- delivery governance
- secrets not rendered to the client

## Security notes

- Do not commit `.env.local`.
- Do not commit API keys, access tokens, database passwords, private keys, or server certificates.
- Public example files must use placeholders rather than real infrastructure addresses.
- All production credentials should be supplied through the deployment environment.
