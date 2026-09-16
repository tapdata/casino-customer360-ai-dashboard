FROM node:22-bookworm-slim

WORKDIR /importer

COPY scripts/tapdata-import.mjs ./tapdata-import.mjs

CMD ["node", "tapdata-import.mjs"]
