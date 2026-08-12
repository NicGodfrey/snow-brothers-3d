# Enterprise Suite — single-image, multi-process runtime.
# Runs all 18 domain services, the API gateway, the admin console, the web
# portal, and the suite shell inside one container via `npm run suite:start`.
# This is a pilot/demo deployment shape, not a per-service production topology.
FROM node:20-slim

WORKDIR /app

# Install exactly what the lockfile says (all workspaces).
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
COPY scripts ./scripts
COPY configs ./configs
COPY tsconfig.base.json ./

RUN npm ci --no-audit --no-fund

# These packages are imported through their compiled dist/ entry points at
# runtime (everything else runs from TypeScript source via tsx).
RUN npm run build -w @enterprise-suite/shared-kernel \
    -w @enterprise-suite/event-bus \
    -w @enterprise-suite/api-gateway

ENV NODE_ENV=production \
    SEED=1 \
    SUITE_BIND_HOST=0.0.0.0

# shell / gateway / admin console / web portal
EXPOSE 4000 4100 4119 4300

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/status').then(r=>r.json()).then(s=>process.exit(s.ready?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "suite:start"]
