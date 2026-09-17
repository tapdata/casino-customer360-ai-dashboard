# Versioned TapData exports

Put vendor-generated, reviewed exports below a versioned folder, for example:

```text
exports/4.x.x/connections/
exports/4.x.x/tasks/
exports/4.x.x/api-services/
exports/4.x.x/apis/
```

Do not commit license files, client secrets, access tokens, private database
URIs, or customer PII. Prefer a redacted example plus a private artifact store
for real exports. The `docker-compose.demo.yml` mount is read-only.

The Docker bootstrap records only redacted export/runtime metadata in MongoDB.
For TapData Enterprise 4.21, the opt-in importer can call the same API used by
the UI and upload the task and API packages without a manual upload.

For an operator-confirmed build, the optional repository wrapper can validate
and call exact import routes:

```bash
./scripts/demo-docker.sh prepare-import
./scripts/demo-docker.sh import
./scripts/demo-docker.sh task-start
```

It is disabled by default, uses `import_as_copy`, and does not auto-start or
overwrite tasks. The default routes are `/api/Task/batch/import` and
`/api/Modules/batch/import`; override them for another TapData edition. Put
the access token only in private `.env.demo`; never place export archives,
tokens, or database credentials in Git.

The API package shared for this demo (`module_batch-20260915.json.gz`) contains
69 records covering 23 published API modules, all using `/api/v1`. Keep it
outside Git unless it has been reviewed for secrets and customer data; copy it
into this directory locally when preparing an import.
