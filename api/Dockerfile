# Build from the repository root:  docker build -f api/Dockerfile -t mobiloot-api .
FROM node:22-slim
WORKDIR /srv
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY ops/package.json ops/
COPY api/package.json api/
RUN npm ci --omit=dev --workspaces --include-workspace-root && npm i --no-save tsx@4
COPY shared shared
COPY api/src api/src
COPY config config
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DB_PATH=/data/mobiloot.db
# Mount a persistent volume at /data (Railway rejects the VOLUME instruction).
EXPOSE 8787
# CLUSTER, SIGN_IN_DOMAIN and optionally CRANK_KEYPAIR (a mounted keypair file) or
# CRANK_KEYPAIR_JSON (its contents) come from the host.
CMD ["npx", "tsx", "api/src/server.ts"]
