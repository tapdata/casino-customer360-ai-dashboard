# One-click TapData + AI loyalty demo kit

This branch adds a reproducible local container boundary for the Macau casino
Customer 360 story:

```text
MongoDB tapdata_casino_marketing (restored source backup)
              │  CDC + cleansing + identity merge in TapData
              ▼
       MongoDB marketing_fdm (normalized FDM)
              │  rename + master/child merge in TapData
              ▼
       MongoDB marketing_mdm (AI-ready MDM)
              │  published TapData APIs
              ▼
        AI loyalty dashboard (Next.js + DeepSeek)
```

## What is included

- `docker-compose.demo.yml`: one authenticated MongoDB single-node replica set (`rs1`) with separate source/FDM/MDM
  databases, TapData, the AI panel, and an optional Mongo-only source feeder.
- `docker/ai-panel.Dockerfile`: production Next.js image; secrets are runtime
  environment variables, never build-time source files.
- `.env.demo.example`: redacted configuration template.
- `scripts/demo-docker.sh`: repeatable `up`, `feeder`, `all`, `once`, `down`,
  `restart`, `status`, `logs`, `health`, and a guarded `reset` command.
- `deploy/tapdata/`: the versioned location for TapData-generated exports and
  the import checklist.

The public repository does not redistribute proprietary TapData installers or
licenses. Oracle/MSSQL/PostgreSQL are intentionally not required: the feeder
updates existing profiles and sessions in `tapdata_casino_marketing`, and TapData moves them
through the FDM and MDM databases. Java is already part of the TapData runtime
image; no separate Java container is required for the panel.

## Quick start

Prerequisites: Docker Desktop or Docker Engine with Compose v2, plus Node.js
22.13+ for offline archive validation and the command wrapper.

```bash
cp .env.demo.example .env.demo
# place the private backup and manifests in secrets/mongo-source/
./scripts/demo-docker.sh prepare
# edit .env.demo: Mongo password, DeepSeek key, and TapData API/OAuth values
./scripts/demo-docker.sh up
```

Open the AI panel at `http://localhost:${AI_PANEL_PORT:-3000}` and TapData at
`http://localhost:${TAPDATA_UI_PORT:-3030}`. The published API URL can point to
the local TapData container or to an externally managed TapData instance.

After explicit approval, set `FEEDER_WRITE_ENABLED=true` in the private environment file to update restored source data:

```bash
./scripts/demo-docker.sh feeder
# or start the core stack and feeder together:
./scripts/demo-docker.sh all
```

The default feeder interval is 15 seconds, updating one existing active session
and its linked profile per tick in one transaction. No customers are seeded or
inserted; identity, risk flags, tiers and active status are preserved. The default
bet increment is 500. `FEEDER_DURATION_HOURS=0` means no time limit. Writes are
disabled unless `FEEDER_WRITE_ENABLED=true` is explicitly configured.

### Private source backup

Before `up`, provide these ignored files in `secrets/mongo-source/`:

- `tapdata_casino_marketing.archive.gz`
- `archive.sha256`
- `restore-manifest.json` (database, SHA-256, collection names and actual dump counts)

Run `./scripts/demo-docker.sh prepare` to verify them entirely offline.
`up` restores into the bundled MongoDB before the panel starts. Restoration
checks the checksum and each collection count, preserves indexes through
`mongorestore`, and records completion outside the source database. Repeated
startup skips the same completed backup. An occupied, unmarked database or a
partial restore fails closed; the script never drops collections. Its target is
restricted to `mongo:27017/tapdata_casino_marketing`, not the original cloud DB.
Backups are mounted read-only and never copied into images or Git.

The legacy Oracle/MSSQL/PostgreSQL feeder is not invoked by this deployment;
all `npm run source:feed*` commands now use the restored MongoDB source.

### Automatic TapData OAuth discovery

The AI panel can obtain the API OAuth client without copying the client secret
into a second application configuration. TapData stores the API Explorer client
in the `tapdata.Application` collection; the default lookup is:

```text
database:   tapdata
collection: Application
filter:     { "name": "Data Explorer" }
fields:     clientId, clientSecret
```

At runtime the server uses this order:

1. `TAPDATA_ACCESS_TOKEN`, when supplied;
2. explicit `TAPDATA_CLIENT_ID` + `TAPDATA_CLIENT_SECRET`;
3. a metadata lookup using `TAPDATA_METADATA_URI`, or `TAPDATA_MONGO_URI` when it points to the actual TapData metadata service.

For a remote/managed TapData instance, set `TAPDATA_METADATA_URI` to a MongoDB
URI reachable from the AI server and keep the metadata database credentials
server-side. The database, collection, filter, and field paths are configurable
with `TAPDATA_METADATA_*` variables. The lookup has a 3-second connection
timeout and is cached in the server process for 5 minutes, so dashboard polls
do not query the metadata database repeatedly. Credentials are held only in
server memory; they are never returned to browser code or written to logs.

The `TAPDATA_STORE_CREDENTIALS` bootstrap option controls whether the bootstrap
record stores credential values; leave it `false` (the default). Changing
environment variables requires restarting the AI-panel container, as with any
container environment change. Changing the TapData `Application` record does
not require a code change; it is picked up after the cache expires or the
container restarts. If metadata discovery is unavailable, provide the explicit
client pair or a short-lived `TAPDATA_ACCESS_TOKEN` as a fallback.

The source feeder is deliberately not started by `up`; use the `feeder` or
`all` command after the TapData tasks are healthy.

## Configuration contract

The Next.js server reads `process.env` at request time. Compose injects the
values from `.env.demo` into the `ai-panel` container. Browser code never needs
`DEEPSEEK_API_KEY`, `TAPDATA_CLIENT_SECRET`, or the Mongo URI.

Important variables:

- `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `DEEPSEEK_API_KEY`
- `TAPDATA_API_BASE_URL`, `TAPDATA_FIND_PATH_TEMPLATE`
- `TAPDATA_TOKEN_URL`, `TAPDATA_CLIENT_ID`, `TAPDATA_CLIENT_SECRET`
- `TAPDATA_TOKEN_AUTH_METHOD` (`client_secret_post` or
  `client_secret_basic`)
- `MONGO_AUDIT_URI`, `MONGO_SNAPSHOT_URI`

If your published service uses `/api/v2/{collection}/find` or a different
service-name suffix, set the template and `TAPDATA_COLLECTION_MAP` accordingly.
Do not assume a path version from a previous environment.

## TapData task/API hand-off

TapData exports are release-specific. Put only redacted, reviewed exports in
`deploy/tapdata/exports/<version>/`, then import them using the matching
TapData UI/API. Keep these checks in the demo runbook:

1. Source FDM collections arrive with normalized names/types.
2. `patron_profiles` resolves the Oracle player ID, MSSQL guest ID, PostgreSQL
   POS member number, and CRM customer ID into one `master_player_id`.
3. `patron_table_sessions` produces one current session document per active
   patron/table context; embedded arrays/documents follow the MDM schema.
4. API services are published from the MDM target, return JSON, and support the
   filter body expected by the panel.
5. A small test mutation in each source is visible through CDC, the MDM target,
   and the corresponding API before the AI demo starts.

### Direct task and API import automation

The repository contains an opt-in importer at `scripts/tapdata-import.mjs`.
For the TapData Enterprise 4.21 build used by this project it calls the same
multipart endpoints as the browser UI, so no manual UI upload is required:

| Artifact | Endpoint | Multipart fields |
| --- | --- | --- |
| CDC task export | `POST /api/Task/batch/import` | `file`, `type=dataflow`, `importMode`, `listtags` |
| API module export | `POST /api/Modules/batch/import` | `file`, `type=Modules`, `importMode`, `listtags` |

The default mode is `import_as_copy`, which creates new task/API records and
does not replace or start existing records. After both uploads the importer
performs read-only checks against `GET /api/Task` and `GET /api/Modules`.
`TAPDATA_IMPORT_AUTOSTART` remains false unless an operator explicitly
configures the start endpoint.

The supplied `module_batch-20260915.json.gz` is a published-API module package
(69 records/23 modules, `/api/v1`); it must be sent to `/api/Modules/batch/import`
and must not be treated as a CDC task export. The task package contains the
task plus its embedded connection/metadata records. The optional XLSX
connection export can still be uploaded first when the target edition exposes
an approved connection-import route.

```bash
# Put private exports in the local, ignored mount (do not commit them):
mkdir -p deploy/tapdata/exports/connections deploy/tapdata/exports/tasks
cp /path/to/MongoDB_Source-20260915.xlsx deploy/tapdata/exports/connections/
cp /path/to/TapData_CDC_Patron_Table_Sessions_To_MongoDB-20260915.json.gz \
  deploy/tapdata/exports/tasks/
cp /path/to/module_batch-20260915.json.gz deploy/tapdata/exports/

# Offline validation + a redacted manifest; no TapData network call:
./scripts/demo-docker.sh prepare-import

# Direct task + API import through the TapData API (token stays in .env.demo):
./scripts/demo-docker.sh import
# Optional, and only when an exact start route is configured:
./scripts/demo-docker.sh task-start
```

For TapData 4.21 installations where the import creates installation-specific
connection copies, the importer can finish the wiring without UI actions. Set
the private values `TAPDATA_IMPORT_POSTPROCESS=true`,
`TAPDATA_IMPORT_SOURCE_MONGODB_URI`, and
`TAPDATA_IMPORT_TARGET_MONGODB_URI`. The post-processing step tests the source,
target, and API-referenced connections until they report `ready`, publishes
the imported modules, and (when `TAPDATA_IMPORT_AUTOSTART=true`) starts the
imported task using `TAPDATA_TASK_START_PATH_TEMPLATE`, for example:

```text
/api/Task/batchStart?taskIds={taskId}
```

The URIs and import token remain private environment variables. The public
community image still does not include a 3080 API Server process; provide an
authorized API Server component or an external TapData API gateway before
calling the published `/api/v1/...` routes.

Set `TAPDATA_IMPORT_MODE=api` and `TAPDATA_IMPORT_TOKEN` in the private
`.env.demo` file. The importer base is `TAPDATA_IMPORT_API_BASE_URL` (3030 for
the Enterprise UI/API; it is separate from the published API gateway on 3080).
The token is sent as the `access_token` query parameter, matching TapData
4.21's web client; it is never written to the manifest or logs. The task/API
paths, types and import modes are prefilled for 4.21 and can be overridden for
another edition. Set `TAPDATA_CONNECTION_IMPORT_PATH` only when the target
edition supports the separate XLSX connection endpoint.
The source MongoDB URI must be reachable **from the importer/TapData
container**; use `mongodb://mongo:27017/...` for the bundled service, not
`127.0.0.1`.

## Lifecycle and safety

```bash
./scripts/demo-docker.sh status
SERVICE=ai-panel ./scripts/demo-docker.sh logs
./scripts/demo-docker.sh health
./scripts/demo-docker.sh down                 # keeps data volumes
RESET_VOLUMES_CONFIRM=YES ./scripts/demo-docker.sh reset  # deletes volumes
```

`reset` is intentionally opt-in because it deletes the local demo databases.
The compose volumes are local; for a team deployment, use managed MongoDB and
secret storage, pin the TapData image instead of `latest`, restrict
TapData/API network exposure, and rotate OAuth/AI credentials.

## What is still required for a true one-command hand-off

The current kit starts the containers and mounts reviewed exports. For the
TapData Enterprise 4.21 build, `./scripts/demo-docker.sh import` also uploads
the task and API package directly through `/api/Task/batch/import` and
`/api/Modules/batch/import`, then performs read-only list checks. The only
instance-specific item still required is an access token from the TapData
login (stored in private `.env.demo` as `TAPDATA_IMPORT_TOKEN`). A connection
XLSX route is optional because the task package carries embedded connection
records; configure it only if the target edition requires a separate upload.

The supplied `module_batch-20260915.json.gz` contains 69 records covering 23
API modules (all `/api/v1`) and is imported as an API module package, never as
a task export. A task is not started automatically.

After those two items are supplied, the remaining setup is environment
configuration only: `MONGO_ROOT_PASSWORD`, `DEEPSEEK_API_KEY`, TapData API
base/token URLs, and (if needed) the collection map. Then
`./scripts/demo-docker.sh all` brings up the complete local demo.

## Validation and remaining local setup (2026-09-16)

The bundled MongoDB initializes `rs1` with the container address `mongo:27017`
and keeps its internal authentication key in its data volume. This enables CDC
inside the Compose network. Host-side tools need `directConnection=true` when
using the published localhost port. No original business database is restored
or backed up by these commands.

The separate demo MongoDB does not contain TapData's embedded metadata. Leave
`TAPDATA_MONGO_URI` empty unless it is the actual metadata endpoint; otherwise
supply the explicit OAuth client pair.

Private exports and database archives are excluded from Git and Docker build
contexts. The importer runs with `--no-deps`, so preparing exports does not
start TapData. Private connection/task/API exports were located locally and
are excluded from Git. The connection/task/API packages pass offline
validation (1 task, 2 connections, 48 task metadata records, 23 API modules).
Live import requires a valid TapData access token and is intentionally a
separate command.

Verified locally: production Next.js build and 7 tests pass; Compose config
validation and changed-module lint pass. An isolated MongoDB container became
healthy with `rs1` primary. A one-shot feeder seeded 12 synthetic patrons with
a configured active limit of 3 and retained that limit after its first tick.
This does not verify the TapData image, live imports, or the full CDC pipeline.

## Cloud regression (2026-09-17)

The backup of `tapdata_casino_marketing` contains 23 collections and 128,368
documents. It was restored and verified in a separate cloud Docker project.
Default write blocking, a single feeder tick, unchanged identities/risk flags/
collection counts, repeat-restore preservation, restart persistence and the
AI panel HTTP 200 check all passed. The original cloud services remain running.
No port cutover or live TapData import was performed.

`docker-compose.cloud-test.yml` binds only localhost ports 37017 and 33000 and
limits memory. Set `COMPOSE_PROFILES=` to omit the bundled TapData service when
testing alongside an existing installation. The default example instead enables
`bundled-tapdata` for a standalone deployment. TapData metadata is persisted in
`demo_tapdata_data` at the official image's `/tapdata/data` path.

The original server uses TapData Enterprise 4.21; the downloaded public image
is the community distribution. Task/API compatibility and licensed features
must be checked before replacing that existing installation. The current user
instruction is to keep the original services running.
