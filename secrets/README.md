# Private runtime secrets

Place private, runtime-only material here when you run the local demo kit:

- TapData license files or vendor-provided import credentials
- OAuth client material for the published API services
- Any source-database credentials needed by an optional feeder

This directory is mounted read-only into the TapData container. Do not commit
secrets, licenses, private keys, or customer data to GitHub. Keep this README
and the empty directory in the repository so a fresh clone has the expected
mount point.
