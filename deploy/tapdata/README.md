# TapData import package

This directory is the hand-off boundary between the public demo repository and
an installed TapData instance. It intentionally does **not** contain a TapData
installer, license, OAuth secret, or a fabricated export format.

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
2. Create/verify the source and target connections. Do not commit credentials.
3. Import connections (if your edition supports connection export).
4. Import/start the one-to-one CDC tasks and confirm initial-load counts.
5. Import/start the two Join tasks and validate the join keys and flat write
   paths against the target schema.
6. Import/publish the API services. Confirm the actual API base URL, version
   (`v1`, `v2`, etc.), and service names before putting them in `.env.demo`.
7. Use `./scripts/demo-docker.sh up` to run the AI panel against those published APIs.

### Which import path should I use?

For TapData Enterprise 4.21, `scripts/tapdata-import.mjs` calls the same
multipart endpoints used by the web UI, so the task and API packages can be
imported without manual uploads:

* `POST /api/Task/batch/import` with `type=dataflow`;
* `POST /api/Modules/batch/import` with `type=Modules`.

Both uploads default to `import_as_copy`; the importer then checks
`GET /api/Task` and `GET /api/Modules`. The optional XLSX connection export can
be uploaded first when the target edition exposes a configured connection
endpoint. A task is never started unless `TAPDATA_IMPORT_AUTOSTART=true` and a
start route are explicitly configured.

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
