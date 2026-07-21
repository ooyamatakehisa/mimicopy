# Mimicopy

耳コピしやすい簡易DAW風Webアプリです。MP3アップロード、YouTube URLからのmp3変換、波形表示、YouTube風ショートカット、任意時刻マーカーに対応しています。

## Requirements

- Node.js 24.18.0
- pnpm 11+
- `ffmpeg` in `PATH` for YouTube-to-mp3 conversion

If `ffmpeg` is installed in a custom location, start the server with `FFMPEG_PATH=/path/to/ffmpeg pnpm dev`.

## Development

```sh
pnpm install
pnpm dev
```

Open `http://127.0.0.1:8080/`.

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

Build and run locally:

```sh
docker compose build mimicopy
docker compose up -d mimicopy
```

By default, compose binds `127.0.0.1:5174` and stores app data in `./storage`.
Point Cloudflare Tunnel at `http://localhost:5174`.

To smoke-test Docker while the dev server is still running, use a different
host port and storage path:

```sh
mkdir -p /tmp/mimicopy-docker-smoke
MIMICOPY_HOST_PORT=5184 MIMICOPY_STORAGE_PATH=/tmp/mimicopy-docker-smoke docker compose up -d --build mimicopy
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
