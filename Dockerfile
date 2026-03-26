# =============================================
#  Cullit — Multi-stage Docker build
# =============================================
# Usage:
#   docker build -t cullit .
#   docker run --env-file .env cullit generate --from v1.0.0 --to v1.1.0
#   docker run --env-file .env -p 3000:3000 cullit serve

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/config/package.json packages/config/
COPY packages/cli/package.json packages/cli/
COPY packages/api/package.json packages/api/
COPY packages/pro/package.json packages/pro/
COPY packages/app/package.json packages/app/
COPY packages/licensed/package.json packages/licensed/
RUN pnpm install --frozen-lockfile

# --- Build ---
FROM deps AS build
COPY tsconfig.json ./
COPY packages/ packages/
RUN pnpm -r build

# --- Production ---
FROM node:22-alpine AS production
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# Install git (needed for local source collector) and curl (healthcheck)
RUN apk add --no-cache git curl tini

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/.npmrc ./
COPY --from=build /app/packages/core/package.json packages/core/package.json
COPY --from=build /app/packages/core/dist/ packages/core/dist/
COPY --from=build /app/packages/config/package.json packages/config/package.json
COPY --from=build /app/packages/config/dist/ packages/config/dist/
COPY --from=build /app/packages/cli/package.json packages/cli/package.json
COPY --from=build /app/packages/cli/dist/ packages/cli/dist/
COPY --from=build /app/packages/api/package.json packages/api/package.json
COPY --from=build /app/packages/api/dist/ packages/api/dist/
COPY --from=build /app/packages/pro/package.json packages/pro/package.json
COPY --from=build /app/packages/pro/dist/ packages/pro/dist/
COPY --from=build /app/packages/app/package.json packages/app/package.json
COPY --from=build /app/packages/licensed/package.json packages/licensed/package.json

RUN pnpm install --prod --frozen-lockfile

# Run as non-root user
RUN addgroup -g 1001 cullit && adduser -u 1001 -G cullit -s /bin/sh -D cullit
USER cullit

# Default: CLI mode
ENTRYPOINT ["tini", "--", "node", "packages/cli/dist/index.js"]
CMD ["--help"]
