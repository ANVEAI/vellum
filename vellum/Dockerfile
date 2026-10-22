# syntax=docker/dockerfile:1
#
# Vellum as one container, for a server that fronts it with ANVE's proxy (/vellum).
#
#   docker build -t vellum .                      # NEXT_PUBLIC_BASE_PATH defaults to /vellum
#   docker build --build-arg NEXT_PUBLIC_BASE_PATH= -t vellum .   # served at the root
#
#   docker run -d --name vellum --network host --env-file vellum.env \
#     -v /srv/vellum/data:/app/data --read-only --tmpfs /tmp --tmpfs /app/.next/cache \
#     --shm-size 256m vellum
#
# - The base path is a BUILD-time value (next.config.ts), so it is a build argument.
# - Everything Vellum writes is under /app/data (the SQLite database, images, exports):
#   mount it. The root filesystem can then be read-only; Next's cache and Chromium's
#   scratch space go to tmpfs.
# - Exports use Playwright's chromium-headless-shell (the smallest Chromium build), so
#   devDependencies stay installed: `playwright` and the `prisma` CLI are dev deps here.
# - On start the container applies pending Prisma migrations, then runs `next start` on
#   ${HOST}:${PORT} (127.0.0.1:3210 by default: behind ANVE it must stay on loopback).
#
# Environment at run time (none of it is baked in): DATABASE_URL, APP_PASSWORD,
# SESSION_SECRET, APP_ORIGIN, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_MAX_TOKENS,
# ANVE_SCOPE / ANVE_SCOPE_SECRET. See README.md.

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# openssl: Prisma's query engine links against it.
RUN apt-get update -q \
 && apt-get install -y -q --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_BASE_PATH=/vellum
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH} \
    DATABASE_URL=file:/tmp/build.db
RUN npx prisma generate && npm run build

FROM base AS runtime
ARG NEXT_PUBLIC_BASE_PATH=/vellum
ENV NODE_ENV=production \
    NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH} \
    DATABASE_URL=file:/app/data/app.db \
    HOST=127.0.0.1 \
    PORT=3210 \
    HOME=/tmp
# chromium-headless-shell and the system libraries it needs (--with-deps runs apt).
COPY --from=deps /app/node_modules /app/node_modules
RUN npx playwright install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/* /tmp/*
COPY --from=build /app /app
RUN groupadd -g 10010 vellum && useradd -u 10010 -g 10010 -d /tmp -s /usr/sbin/nologin vellum \
 && mkdir -p /app/data /app/.next/cache \
 && chown -R 10010:10010 /app/data /app/.next/cache
USER 10010:10010
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://'+process.env.HOST+':'+process.env.PORT+(process.env.NEXT_PUBLIC_BASE_PATH||'')+'/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node_modules/.bin/next start -H \"$HOST\" -p \"$PORT\""]
