FROM node:24.18.0-bookworm-slim AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:24.18.0-bookworm-slim AS runner

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    MIMICOPY_STORAGE_DIR=/data \
    NODE_ENV=production \
    PORT=5174

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
  && pnpm install --prod --frozen-lockfile \
  && pnpm store prune

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

RUN mkdir -p /data/media \
  && chown -R node:node /app /data

USER node

EXPOSE 5174
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '5174') + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist-server/index.js"]
