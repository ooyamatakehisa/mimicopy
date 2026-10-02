FROM node:24.18.0-bookworm-slim AS runtime-base

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    MIMICOPY_BEAT_PYTHON=/opt/beat-this/bin/python \
    TORCH_HOME=/opt/beat-this/models
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    git \
    ffmpeg \
    libsndfile1 \
    python3 \
    python3-dev \
    python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY requirements-beat-this.txt ./
RUN python3 -m venv /opt/beat-this \
  && /opt/beat-this/bin/pip install --no-cache-dir -r requirements-beat-this.txt \
  && /opt/beat-this/bin/python -c "from beat_this.inference import File2Beats; File2Beats(checkpoint_path='final0', device='cpu', dbn=True)" \
  && chmod -R a+rX /opt/beat-this/models \
  && apt-get purge -y --auto-remove build-essential git python3-dev

FROM runtime-base AS dev

ENV MIMICOPY_API_PORT=5174 \
    MIMICOPY_CLIENT_HOST=0.0.0.0 \
    MIMICOPY_CLIENT_PORT=8080 \
    MIMICOPY_STORAGE_DIR=/data \
    NODE_ENV=development \
    PORT=5174

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && chown -R node:node /app

CMD ["pnpm", "dev"]

FROM runtime-base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM runtime-base AS runner

ENV MIMICOPY_STORAGE_DIR=/data \
    NODE_ENV=production \
    PORT=5174

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable \
  && pnpm install --prod --frozen-lockfile \
  && pnpm store prune

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY scripts ./scripts

RUN mkdir -p /data/media \
  && chown -R node:node /app /data

USER node

EXPOSE 5174
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '5174') + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist-server/index.js"]
