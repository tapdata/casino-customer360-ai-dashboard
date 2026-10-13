# AI Loyalty Panel: Manual TapData Import Quickstart

This guide is for a colleague who already has a running TapData Enterprise environment and has manually imported and published the prepared tasks and APIs.

This flow only installs and starts the AI Loyalty panel. It does **not** import TapData tasks, import APIs, restore MongoDB data, or start a data generator.

## 1. Clone the repository

On the colleague's computer or Linux server:

```bash
git clone https://github.com/tapdata/casino-customer360-ai-dashboard.git
cd casino-customer360-ai-dashboard
```

The private `.env.local` file is intentionally not stored in Git. The repository contains the safe template `.env.example`.

## 2. Create the private panel configuration

```bash
cp .env.example .env.local
chmod 600 .env.local
```

Open it with an editor:

```bash
nano .env.local
```

`.env.local` is a hidden file in the repository root. Use `ls -la` to find it:

```bash
ls -la .env.local
```

Set the AI provider and the TapData published API connection. For OAuth client credentials:

```env
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
TAPDATA_ACCESS_TOKEN=
```

If TapData provides a fixed token for the published APIs, use this alternative instead:

```env
TAPDATA_API_BASE_URL=http://<tapdata-api-host>:3080
TAPDATA_FIND_PATH_TEMPLATE=/api/v1/{collection}/find
TAPDATA_ACCESS_TOKEN=<published-api-token>

TAPDATA_TOKEN_URL=
TAPDATA_CLIENT_ID=
TAPDATA_CLIENT_SECRET=
```

Use either the OAuth fields or `TAPDATA_ACCESS_TOKEN`; do not mix the two modes. `TAPDATA_CLIENT_ID` and `TAPDATA_CLIENT_SECRET` authenticate panel queries to the published APIs. They are different from the TapData manager token used by the automated importer.

If the published service names differ from the names in the template, update `TAPDATA_COLLECTION_MAP` in `.env.local`. Keep the existing mapping when the prepared APIs use the standard demo names.

## 3. Install dependencies and build the panel

Node.js 22.13.0 or newer is required.

```bash
node --version
npm ci
npm run build
```

## 4. Start the panel

For the default port `3000`:

```bash
npm start
```

Open:

```text
http://<panel-server-ip-or-hostname>:3000
```

To use another port for a manual run:

```bash
npx next start -H 0.0.0.0 -p 3001
```

Then open `http://<panel-server-ip-or-hostname>:3001` and allow that port in the server firewall or security group.

For a quick development test instead of a production build:

```bash
npm run dev -- -H 0.0.0.0
```

## 5. Verify live data

Open the panel and check the dashboard. The server-side API can also be tested locally:

```bash
curl -i http://127.0.0.1:3000/api/data/patrons
```

The response should report live TapData data. If the panel shows simulated data or an authentication error, check the TapData URL, the published API token/OAuth credentials, and the published service names.

## Important command boundary

Do not run the following command for this manual-import scenario:

```bash
bash run-demo.sh
```

`run-demo.sh` is the full deployment workflow. It performs preflight checks, restores the source MongoDB seed, imports or reuses TapData objects, starts the CDC/data-feeder process, and installs the managed panel service. It therefore asks for TapData manager credentials and MongoDB configuration.

For a manually imported TapData environment, the required workflow is only:

```bash
git clone https://github.com/tapdata/casino-customer360-ai-dashboard.git
cd casino-customer360-ai-dashboard
cp .env.example .env.local
nano .env.local
npm ci
npm run build
npm start
```

Keep `.env.local` private. Never commit it or paste its API keys, access tokens, client secrets, or MongoDB passwords into Git.
