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
7. Use `scripts/demo.sh up` to run the AI panel against those published APIs.

On startup, the one-shot `bootstrap` service records the selected TapData image,
API paths, export mount, and credential-presence flags in MongoDB. It does not
persist client secrets or access tokens unless `TAPDATA_STORE_CREDENTIALS=true`
is explicitly set for a private environment.

TapData export/import files are edition and version dependent. If an export
cannot be imported directly, use the TapData UI/API for that release rather
than editing the artifact by hand. The public kit remains usable with an
external TapData deployment by changing `TAPDATA_*` variables.
