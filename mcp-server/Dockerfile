# Vellum MCP server.
#
# NOTE ON STOP TIMEOUT: run this with a stop timeout comfortably above the
# shutdown grace period (docker run --stop-timeout 30). On SIGTERM the server
# aborts in-flight generations, and that abort is what makes Vellum release its
# process-global generation lock. A SIGKILL mid-generation leaves Vellum
# generating with the lock held until it is restarted.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    VELLUM_MCP_TRANSPORT=http \
    VELLUM_MCP_HTTP_HOST=0.0.0.0 \
    VELLUM_MCP_EXPORT_DIR=/data/exports

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

RUN mkdir -p /data/exports && chown -R node:node /data
USER node
VOLUME ["/data/exports"]
EXPOSE 8080
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/index.js"]
