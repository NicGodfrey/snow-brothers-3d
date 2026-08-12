FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
COPY scripts ./scripts
COPY docs ./docs
COPY tsconfig.base.json ./
COPY README.md ./

RUN npm ci --ignore-scripts && npm rebuild esbuild || true

ENV NODE_ENV=production
ENV ASSUME_DEPLOYED=true
ENV SUITE_TRUST_HEADERS=true
ENV SUITE_AUTH_SECRET=local-demo-only-suite-auth-secret
ENV PORTAL_TRANSPORT=http
ENV PORTAL_GATEWAY_URL=http://127.0.0.1:4100
ENV PORTAL_DEFAULT_TENANT=demo

EXPOSE 4000 4100 4119 4300

CMD ["npm", "run", "suite:start"]
