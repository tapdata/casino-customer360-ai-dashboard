# TapData import package

This directory is the hand-off boundary between the public demo repository and
an installed TapData instance. It intentionally does **not** contain a TapData
installer, API Server binary, license, OAuth secret, or a fabricated export
format. The bundled Docker profile expects the authorized API Server JAR at
`secrets/tapdata-api/apiserver.jar`; it runs that artifact in a separate
`tapdata-api` container on port 3080 and never depends on an old host process.

## What to place here

Export artifacts from the same TapData edition/version used for the demo and
keep the version in the filename or a subdirectory:

```text
exports/<tapdata-version>/connections/
exports/<tapdata-version>/tasks/
exports/<tapdata-version>/api-services/
exports/<tapdata-version>/apis/
```

For the supplied API module package, copy the reviewed file into
`deploy/tapdata/exports/` (the Compose mount is read-only):

```bash
mkdir -p deploy/tapdata/exports
cp /path/to/module_batch-20260915.json.gz deploy/tapdata/exports/
```

The two MDM merge tasks in this story are:

1. `patron_profiles`: identity resolution from the three FDM source families.
2. `patron_table_sessions`: current table session plus profile/risk context.

The remaining target collections can be one-to-one CDC tasks where a source
FDM collection maps to one MDM collection. A one-to-one task may contain
multiple independent source-to-target pairs, but a source collection must not
fan out to two targets in that task. A Join task produces one target collection.

## Import order

1. Install or start TapData and activate it with the operator-provided license.
2. Restore the 23 source collections into the fixed `tapdata_casino_marketing`
   database, or verify that the supplied empty MongoDB is ready for restore.
3. Create/verify the source and `marketing_mdm` target connections. Do not
   commit credentials.
4. Import the existing `TapData_CDC_Patron_Table_Sessions_To_MongoDB` task.
   The task export already contains all 23 Source→MDM collection mappings; do
   not split it into 23 tasks.
5. Start the task and wait for all 23 MDM collections to exist and contain
   data. The importer must stop before API publication if this check fails.
6. Import/publish the API services. Confirm the actual API base URL, version
   (`v1`, `v2`, etc.), and service names before putting them in `.env.demo`.
7. Use `./scripts/demo-docker.sh up` to run the AI panel against those published APIs.

### External Enterprise one-command onboarding

When a colleague provides an existing TapData Enterprise deployment, use the
external profile rather than starting the bundled TapData services:

```bash
cp .env.external.example .env.external
# Fill .env.external privately with the manager/API URLs, token, and the
# Source/MDM MongoDB URIs. Do not commit the file.
./scripts/external-tapdata-onboard.sh .env.external
```

The command restores the private 23-collection Source archive into
`tapdata_casino_marketing` when enabled, uploads the existing single CDC task
and API package through the provider's manager API, patches the Source and
`marketing_mdm` Target connections, starts CDC, waits for all 23 MDM
collections to contain data, publishes the APIs, and starts the AI panel on
port 3000. The provider's manager API and published API server must be
reachable from the machine running the command.

### Which import path should I use?

For TapData Enterprise 4.21, `scripts/tapdata-import.mjs` calls the same
multipart endpoints used by the web UI, so the task and API packages can be
imported without manual uploads:

* `POST /api/Task/batch/import` with `type=dataflow`;
* `POST /api/Modules/batch/import` with `type=Modules`.

Both uploads default to `import_as_copy`; the importer then checks
`GET /api/Task` and `GET /api/Modules`. The optional XLSX connection export can
be uploaded first when the target edition exposes a configured connection
endpoint. With post-processing enabled, the importer patches the Source and
`marketing_mdm` Target URIs, starts the single CDC task when configured, waits
for all 23 MDM collections to contain data, and only then marks API modules
active. A task is never started unless `TAPDATA_IMPORT_AUTOSTART=true` and a
start route are explicitly configured.

Repeated runs must reconcile by the exact task/API name. Do not create
`MDM_import...` copies. The exact same-name update route or import mode is
TapData-edition-specific and must be confirmed during preflight before the
first external deployment.

For a repeatable environment, the repository has an optional wrapper:

```bash
./scripts/demo-docker.sh prepare-import  # offline validation, redacted manifest
./scripts/demo-docker.sh import          # direct task + API import for 4.21
./scripts/demo-docker.sh task-start     # only with exact start route configured
```

The wrapper sends `TAPDATA_IMPORT_TOKEN` as the `access_token` query parameter,
matching TapData 4.21's browser client. Set
`TAPDATA_IMPORT_API_BASE_URL=http://tapdata:3030` for the Enterprise UI/API;
this is separate from the published API gateway on 3080. Keep the token only
in private `.env.demo`/deployment secrets; it is excluded from the redacted
manifest and logs. For the bundled Mongo service, a container must use
`mongodb://mongo:27017/...`; `127.0.0.1` points back to that container itself.

On startup, the one-shot `bootstrap` service records the selected TapData image,
API paths, export mount, and credential-presence flags in MongoDB. It does not
persist client secrets or access tokens unless `TAPDATA_STORE_CREDENTIALS=true`
is explicitly set for a private environment.

TapData export/import files remain edition and version dependent. The
`module_batch-20260915.json.gz` package currently contains 69 records for 23
API modules, all with `/api/v1` paths. If a different TapData release changes
the routes or multipart fields, override the `TAPDATA_*` importer variables or
fall back to that release's documented UI/API.
