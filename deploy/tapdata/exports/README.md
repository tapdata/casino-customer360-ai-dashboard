# Versioned TapData exports

Put vendor-generated, reviewed exports below a versioned folder, for example:

```text
exports/4.x.x/connections/
exports/4.x.x/tasks/
exports/4.x.x/api-services/
```

Do not commit license files, client secrets, access tokens, private database
URIs, or customer PII. Prefer a redacted example plus a private artifact store
for real exports. The `docker-compose.demo.yml` mount is read-only.

