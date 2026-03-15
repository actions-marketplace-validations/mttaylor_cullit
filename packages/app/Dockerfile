FROM node:20-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/config/package.json packages/config/
COPY packages/app/package.json packages/app/
RUN corepack enable && pnpm install --frozen-lockfile
COPY packages/core packages/core
COPY packages/config packages/config
COPY packages/app packages/app
COPY tsconfig.json ./
RUN pnpm --filter @cullit/config build && pnpm --filter @cullit/core build && pnpm --filter @cullit/app build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/packages/app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/config/dist ./packages/config/dist
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/index.js"]
