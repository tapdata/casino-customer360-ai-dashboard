FROM node:22-bookworm-slim

WORKDIR /feeder

COPY package*.json ./
RUN npm ci --omit=dev

COPY scripts/mongo-source-feeder.mjs ./mongo-source-feeder.mjs

CMD ["node", "mongo-source-feeder.mjs"]
