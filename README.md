# Mimicopy

耳コピしやすい簡易DAW風Webアプリです。MP3アップロード、YouTube URLからのmp3変換、波形表示、YouTube風ショートカット、任意時刻マーカーに対応しています。

## Requirements

For Docker-based development and production:

- Docker with Docker Compose

For local development without Docker:

- Node.js 24.18.0
- pnpm 11+
- `ffmpeg` in `PATH` for YouTube-to-mp3 conversion

If `ffmpeg` is installed in a custom location for development, start the server
with `FFMPEG_PATH=/path/to/ffmpeg pnpm dev`.

## Development

The preferred development environment is the Docker container. It includes
Node.js, pnpm, ffmpeg, Python, and madmom, so the host only needs Docker.

```sh
MIMICOPY_UID=$(id -u) MIMICOPY_GID=$(id -g) docker compose --profile dev up --build mimicopy-dev
```

Open `http://127.0.0.1:8080/`.

If another dev server is already using the default ports, run the container on
alternate host ports:

```sh
MIMICOPY_UID=$(id -u) MIMICOPY_GID=$(id -g) MIMICOPY_DEV_CLIENT_PORT=8090 MIMICOPY_DEV_API_PORT=5184 docker compose --profile dev up --build mimicopy-dev
```

Then open `http://127.0.0.1:8090/`.

For local development without Docker:

```sh
pnpm install
pnpm dev
```

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Production Docker Hosting

Production runs as one Node container. Express serves `/api`, `/media`, and the
Vite-built `dist` assets from port `5174`.

The production image includes:

- Node.js 24.18.0
- system `ffmpeg` at `/usr/bin/ffmpeg`
- Python 3 with `madmom==0.16.1`
- pinned madmom prerequisites from `requirements-madmom.txt`

Build and run locally:

```sh
docker compose build mimicopy
MIMICOPY_UID=$(id -u) MIMICOPY_GID=$(id -g) docker compose up -d mimicopy
```

By default, compose binds `127.0.0.1:5174` and stores app data in `./storage`.
Point Cloudflare Tunnel at `http://localhost:5174`.

To smoke-test Docker while the dev server is still running, use a different
host port and storage path:

```sh
mkdir -p /tmp/mimicopy-docker-smoke
MIMICOPY_UID=$(id -u) MIMICOPY_GID=$(id -g) MIMICOPY_HOST_PORT=5184 MIMICOPY_STORAGE_PATH=/tmp/mimicopy-docker-smoke docker compose up -d --build mimicopy
curl http://127.0.0.1:5184/api/health
MIMICOPY_HOST_PORT=5184 MIMICOPY_STORAGE_PATH=/tmp/mimicopy-docker-smoke docker compose down
```

## Automatic Deployment

`.github/workflows/deploy.yml` verifies pull requests and main pushes. On a
push to `main`, it builds and publishes `ghcr.io/ooyamatakehisa/mimicopy:main`
and `sha-*` tags.

If these repository secrets are configured, the workflow also SSHes into the
server and runs `git pull --ff-only`, `docker compose pull mimicopy`, and
`docker compose up -d --remove-orphans mimicopy`:

- `MIMICOPY_DEPLOY_HOST`
- `MIMICOPY_DEPLOY_USER`
- `MIMICOPY_DEPLOY_SSH_KEY`
- `MIMICOPY_DEPLOY_PATH`
- `MIMICOPY_DEPLOY_PORT` (optional, defaults to `22`)

The server path should be a clean checkout of this repository with Docker
Compose installed. If the GHCR package is private, run `docker login ghcr.io`
on the server once with a token that can read packages.
