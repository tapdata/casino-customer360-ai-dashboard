# One-click TapData + AI loyalty demo kit

This branch adds a reproducible local container boundary for the Macau casino
Customer 360 story:

```text
Oracle / MSSQL / PostgreSQL sources
              │  CDC + cleansing + identity merge in TapData
              ▼
       MongoDB MDM collections
              │  published TapData APIs
              ▼
        AI loyalty dashboard (Next.js + DeepSeek)
```

## What is included

- `docker-compose.demo.yml`: MongoDB, TapData, the AI panel, and an optional
  PostgreSQL source profile.
- `docker/ai-panel.Dockerfile`: production Next.js image; secrets are runtime
  environment variables, never build-time source files.
- `.env.demo.example`: redacted configuration template.
- `scripts/demo.sh`: repeatable `up`, `sources`, `down`, `status`, `logs`, and a
  guarded `reset` command.
- `deploy/tapdata/`: the versioned location for TapData-generated exports and
  the import checklist.

The public repository does not redistribute proprietary Oracle/MSSQL/TapData
installers or licenses. PostgreSQL is provided as an optional service because
its container image is straightforward to run; Oracle and MSSQL should be
connected from licensed images or an existing environment. The selected
TapData image and edition must be supplied/approved by the operator. In many
editions Java is already part of the TapData runtime, so a separate Java
container is not required for the panel.

## Quick start

Prerequisites: Docker Desktop or Docker Engine with Compose v2.

```bash
cp .env.demo.example .env.demo
# edit .env.demo: TapData image/version, API URL, OAuth client, and DeepSeek key
./scripts/demo.sh up
```

Open the AI panel at `http://localhost:${AI_PANEL_PORT:-3000}` and TapData at
`http://localhost:${TAPDATA_UI_PORT:-3030}`. The published API URL can point to
the local TapData container or to an externally managed TapData instance.

To include the optional PostgreSQL source container:

```bash
./scripts/demo.sh sources
```

The source feeder is deliberately not started by default. It requires the
Oracle/MSSQL/PostgreSQL endpoints and credentials in a private
`.env.source-feeder`; run it only after those sources are reachable and after
CDC tasks are healthy.

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

## Lifecycle and safety

```bash
./scripts/demo.sh status
SERVICE=ai-panel ./scripts/demo.sh logs
./scripts/demo.sh down                 # keeps data volumes
RESET_VOLUMES_CONFIRM=YES ./scripts/demo.sh reset  # deletes demo volumes
```

`reset` is intentionally opt-in because it deletes the local demo databases.
The compose volumes are local; for a team deployment, use managed MongoDB and
secret storage, pin image versions, restrict TapData/API network exposure, and
rotate OAuth/AI credentials.

