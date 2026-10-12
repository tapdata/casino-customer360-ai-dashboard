# Casino Customer 360 Demo — Quick Deployment Guide

This guide is for a colleague who already has a **TapData Enterprise** environment. The goal is to restore the prepared demo data, import the TapData task and APIs, start the data feeder, and open the AI panel with one command.

## Requirements

Run the demo on a Linux server with:

- TapData Enterprise Manager and API Server already running;
- MongoDB already running as a replica set or sharded cluster;
- the built-in TapData Enterprise connection named `MDM`;
- `systemd`, `curl`, `xz`, and outbound HTTPS access;
- network access from the panel server to TapData and MongoDB.

The Git repository contains the anonymized MongoDB demo seed, TapData task/API templates, the AI panel, and the source data feeder. It does not contain the TapData Enterprise or MongoDB server binaries, credentials, or licenses.

## One-command deployment

```bash
git clone -b codex/docker-demo-kit \
  https://github.com/tapdata/casino-customer360-ai-dashboard.git

cd casino-customer360-ai-dashboard

bash run-demo.sh
```

`run-demo.sh` automatically requests `sudo` and performs the following steps:

1. Downloads Node.js if it is missing and installs npm dependencies;
2. Builds the AI panel;
3. Restores the 23 anonymized MongoDB collections from Git;
4. Reuses the existing TapData Enterprise `MDM` connection;
5. Imports the CDC task and 23 API modules;
6. Publishes the APIs and starts the CDC task;
7. Starts the source data feeder and the AI panel as a systemd service.

If TapData and MongoDB are on different servers, set their default hosts before running the same command:

```bash
DEMO_TAPDATA_HOST=<tapdata-host> \
DEMO_MONGO_HOST=<mongodb-host> \
DEMO_PUBLIC_HOST=<panel-ip-or-domain> \
bash run-demo.sh
```

## Configuration wizard

When TapData, MongoDB, and the panel are on the same server, press **Enter** to accept these defaults:

| Setting | Default |
| --- | --- |
| TapData Manager | `http://127.0.0.1:3030` |
| TapData API Server | `http://127.0.0.1:3080` |
| Source database | `tapdata_casino_marketing` |
| Panel state database | `marketing_demo` |
| AI provider | `deepseek` |
| AI model | `deepseek-chat` |
| Panel port | `3000` |
| TapData target connection | existing `MDM` |

The following values have no safe default and must be provided:

- TapData Manager access token;
- published API token, or OAuth Client ID/Secret;
- MongoDB authentication URI if MongoDB requires credentials;
- DeepSeek or OpenAI API key.

Secrets are not printed and are saved only in `.env.external` with permission `0600`.

### Example for the current cloud server

For the current cloud server, the private `.env.external` can look like this. Replace every value in angle brackets with the real secret; do not commit this file.

```dotenv
AI_PANEL_PUBLIC_HOST=47.119.130.230
AI_PANEL_PORT=3000
AI_PROVIDER=deepseek
AI_MODEL=deepseek-chat
AI_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=<your-deepseek-api-key>

TAPDATA_API_BASE_URL=http://47.119.130.230:3080
TAPDATA_FIND_PATH_TEMPLATE=/api/v1/{collection}/find
TAPDATA_TOKEN_URL=http://47.119.130.230:3030/oauth/token
TAPDATA_CLIENT_ID=<your-oauth-client-id-if-used>
TAPDATA_CLIENT_SECRET=<your-oauth-client-secret-if-used>
TAPDATA_ACCESS_TOKEN=<your-published-api-token-if-used>
TAPDATA_TOKEN_AUTH_METHOD=client_secret_post

TAPDATA_IMPORT_API_BASE_URL=http://47.119.130.230:3030
TAPDATA_IMPORT_TOKEN=<your-tapdata-manager-token>
TAPDATA_IMPORT_MODE=api
TAPDATA_IMPORT_POSTPROCESS=true
TAPDATA_IMPORT_AUTOSTART=true
TAPDATA_IMPORT_SKIP_EXISTING=true
TAPDATA_TASK_START_METHOD=PUT
TAPDATA_TASK_START_PATH_TEMPLATE=/api/Task/batchStart?taskIds={taskId}

TAPDATA_IMPORT_SOURCE_MONGODB_URI=mongodb://<mongo-user>:<mongo-password>@47.119.130.230:27017/tapdata_casino_marketing?authSource=admin&replicaSet=rs1
TAPDATA_IMPORT_SOURCE_MONGODB_DB=tapdata_casino_marketing
TAPDATA_IMPORT_SOURCE_CONNECTION_NAME=MongoDB_Source
TAPDATA_IMPORT_TARGET_CONNECTION_NAME=MDM
TAPDATA_IMPORT_USE_EXISTING_TARGET=true
TAPDATA_IMPORT_RESTORE_SOURCE=true

MONGO_AUDIT_URI=mongodb://<mongo-user>:<mongo-password>@47.119.130.230:27017/marketing_demo?authSource=admin&replicaSet=rs1
MONGO_AUDIT_DB=marketing_demo
MONGO_SNAPSHOT_DB=marketing_demo

FEEDER_ENABLED=true
FEEDER_INTERVAL_MS=15000
FEEDER_SESSION_UPDATES_PER_TICK=1
FEEDER_BET_INCREMENT=500
SOURCE_RESTORE_BACKUP_DIR=seed/demo
TAPDATA_IMPORT_ROOT=deploy/tapdata/templates
```

Use either `TAPDATA_ACCESS_TOKEN` or the OAuth client fields. For token mode, leave the OAuth fields empty; for OAuth mode, leave `TAPDATA_ACCESS_TOKEN` empty. URL-encode special characters in the MongoDB password.

To use the file instead of answering the wizard, create it before the first run:

```bash
cp .env.external.example .env.external
chmod 600 .env.external
# Edit .env.external and replace the placeholders above.
bash run-demo.sh
```

When `.env.external` already exists, the installer uses it and does not ask the same questions again.

## After deployment

The installer prints the panel URL. The default is:

```text
http://<panel-ip-or-domain>:3000/
```

The data path is:

```text
Source MongoDB → TapData CDC → Enterprise MDM → Published APIs → AI panel
```

The source database must be empty for the first restore. The installer refuses to overwrite an existing source database.

## Existing tasks or APIs

Before uploading, the importer checks exact names:

- if the task and all 23 API modules already exist, it reuses them and skips the upload;
- if only some objects exist, it stops and asks for manual inspection;
- if none exist, it imports, configures, publishes, and starts them.

This prevents duplicate `import_as_copy` objects.

## Source data feeder

The current Enterprise demo feeder is:

```text
scripts/mongo-source-feeder.mjs
```

It updates existing active customers in `tapdata_casino_marketing` every 15 seconds. It changes session amount, stack estimate, ADT, points, and timestamps. It does not create customers or delete collections.

Check the service and feeder logs:

```bash
sudo systemctl status tapdata-casino-demo.service
sudo journalctl -u tapdata-casino-demo.service -f
```

Pause or resume the panel and feeder:

```bash
sudo systemctl stop tapdata-casino-demo.service
sudo systemctl start tapdata-casino-demo.service
```

Seeing `updated: 1` in the log means that one source update was written successfully.

## Safe re-test

To test a fresh import without losing the current source data:

1. Stop the existing CDC task, feeder, and panel;
2. Move `tapdata_casino_marketing` to a backup database name;
3. Keep the expected empty name `tapdata_casino_marketing`;
4. Run `bash run-demo.sh` again.

Do not rename or delete the Enterprise `MDM` connection, `marketing_mdm`, or `marketing_demo`.

## Private files

Do not commit or share these files through Git:

- `.env.local` and `.env.source-feeder`;
- `secrets/`;
- `runtime/`;
- `deploy/tapdata/exports/`;
- `node_modules/` and `.next/`.

Use an approved password manager or secure file-transfer method for credentials and private exports.
