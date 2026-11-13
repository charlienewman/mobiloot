# Build from the repository root:  docker build -f api/Dockerfile -t mobiloot-api .
# Pinned by digest; refresh with: docker pull node:22-slim && docker inspect --format '{{index .RepoDigests 0}}' node:22-slim
FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
WORKDIR /srv
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY ops/package.json ops/
COPY api/package.json api/
RUN npm ci --omit=dev --workspaces --include-workspace-root
COPY shared shared
COPY api/src api/src
COPY config config
COPY api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DB_PATH=/data/mobiloot.db
# Mount a persistent volume at /data (Railway rejects the VOLUME instruction).
EXPOSE 8787
# CLUSTER, SIGN_IN_DOMAIN and optionally CRANK_KEYPAIR (a mounted keypair file) or
# CRANK_KEYPAIR_JSON (its contents) come from the host.
# The entrypoint fixes the ownership of /data, then runs the server as the unprivileged
# `node` user. Node runs directly (not via npx) so it receives SIGTERM and exits cleanly.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "tsx", "api/src/server.ts"]
