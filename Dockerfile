# =============================================
#  Cullit — Multi-stage Docker build
# =============================================
# Usage:
#   docker build -t cullit .
#   docker run --env-file .env cullit generate --from v1.0.0 --to v1.1.0
#   docker run --env-file .env -p 3000:3000 cullit serve

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/config/package.json packages/config/
COPY packages/cli/package.json packages/cli/
COPY packages/api/package.json packages/api/
RUN pnpm install --frozen-lockfile

# --- Build ---
FROM deps AS build
COPY tsconfig.json ./
COPY packages/ packages/
RUN pnpm build

# --- Production ---
FROM node:20-alpine AS production
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install git (needed for local source collector)
RUN apk add --no-cache git

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/core/package.json /app/packages/core/dist/ packages/core/
COPY --from=build /app/packages/config/package.json /app/packages/config/dist/ packages/config/
COPY --from=build /app/packages/cli/package.json /app/packages/cli/dist/ packages/cli/
COPY --from=build /app/packages/api/package.json /app/packages/api/dist/ packages/api/

RUN pnpm install --prod --frozen-lockfile

# Default: CLI mode
ENTRYPOINT ["node", "packages/cli/dist/index.js"]
CMD ["--help"]
