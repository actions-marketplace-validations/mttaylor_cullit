FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/config/package.json packages/config/
COPY packages/cli/package.json packages/cli/
COPY packages/api/package.json packages/api/
COPY packages/licensed/package.json packages/licensed/
COPY packages/pro/package.json packages/pro/
COPY packages/app/package.json packages/app/
RUN corepack enable && pnpm install --frozen-lockfile
COPY packages/core packages/core
COPY packages/config packages/config
COPY packages/pro packages/pro
COPY packages/app packages/app
COPY tsconfig.json ./
RUN pnpm --filter @cullit/config build && pnpm --filter @cullit/core build && pnpm --filter @cullit/pro build && pnpm --filter @cullit/app build

FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
RUN apk add --no-cache git tini
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/.npmrc ./
COPY --from=build /app/packages/app/package.json packages/app/package.json
COPY --from=build /app/packages/app/dist packages/app/dist
COPY --from=build /app/packages/core/package.json packages/core/package.json
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/config/package.json packages/config/package.json
COPY --from=build /app/packages/config/dist packages/config/dist
COPY --from=build /app/packages/pro/package.json packages/pro/package.json
COPY --from=build /app/packages/pro/dist packages/pro/dist
RUN pnpm install --prod --frozen-lockfile
ENV NODE_ENV=production

# Run as non-root user
RUN addgroup -g 1001 cullit && adduser -u 1001 -G cullit -s /bin/sh -D cullit
USER cullit

EXPOSE 3001
ENTRYPOINT ["tini", "--"]
CMD ["node", "packages/app/dist/index.js"]
