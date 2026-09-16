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

The Docker bootstrap records only redacted export/runtime metadata in MongoDB;
it does not import vendor artifacts automatically because import formats vary
by TapData edition. The recommended path is the TapData UI **Import** button:
import the connection workbook first, then the CDC task archive, review the
mapping, and start the task.

For an operator-confirmed build, the optional repository wrapper can validate
and call exact import routes:

```bash
./scripts/demo-docker.sh prepare-import
./scripts/demo-docker.sh import
./scripts/demo-docker.sh task-start
```

It is disabled by default, never guesses private endpoints, and does not
auto-start or overwrite tasks. Configure exact routes/body fields in
`.env.demo`; a missing route fails closed. Do not place export archives,
tokens, or database credentials in Git.

The API package shared for this demo (`module_batch-20260915.json.gz`) contains
69 records covering 23 published API modules, all using `/api/v1`. Keep it
outside Git unless it has been reviewed for secrets and customer data; copy it
into this directory locally when preparing an import.
