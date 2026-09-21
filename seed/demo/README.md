# Anonymized demo data

These 23 collections are the checked-in, anonymized copy of the casino source
database used by the TapData task and API templates. Documents are newline
delimited BSON EJSON inside gzip files so the installer can restore them with
the Node.js MongoDB driver without requiring a local MongoDB installation.

The source archive and its manifest are kept under `secrets/` for regeneration
only and are ignored by Git. `manifest.json` contains per-collection counts and
checksums. The installer refuses to write into a non-empty source database.
