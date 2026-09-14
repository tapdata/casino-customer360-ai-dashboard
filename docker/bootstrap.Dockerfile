FROM node:22-bookworm-slim

WORKDIR /bootstrap
COPY package*.json ./
RUN npm ci --omit=dev
COPY scripts/docker-bootstrap.mjs ./docker-bootstrap.mjs

CMD ["node", "docker-bootstrap.mjs"]
