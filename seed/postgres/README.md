# Optional PostgreSQL seed mount

When the `sources` Compose profile is enabled, files in this directory are
mounted into PostgreSQL's `/docker-entrypoint-initdb.d` on first initialization.
Add reviewed synthetic `.sql` or `.sh` fixtures here if the demo needs a local
PostgreSQL source. Existing volumes are not re-initialized automatically; use
the guarded `reset` command only when you intentionally want a clean database.

Do not place production data or credentials in this directory.
