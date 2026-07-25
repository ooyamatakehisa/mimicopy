# Mimicopy

耳コピしやすい簡易DAW風Webアプリです。MP3アップロード、YouTube
URLからのmp3変換、任意の1ステムの音源分離、同期ミキサー、波形表示、
YouTube風ショートカット、任意時刻マーカーに対応しています。

## Requirements

For Docker-based development and production:

- Docker with Docker Compose
- Intel GPU exposed at `/dev/dri` for stem separation

For local development without Docker:

- Node.js 24.18.0
- pnpm 11+
- `ffmpeg` in `PATH` for YouTube-to-mp3 conversion
- Python with `madmom` installed for beat/downbeat analysis

If `ffmpeg` is installed in a custom location for development, start the server
with `FFMPEG_PATH=/path/to/ffmpeg pnpm dev`.

Install madmom for the Python interpreter used by the server:

```sh
python3 -m pip install madmom
```

If madmom is installed in a custom Python environment, start the server with
`MIMICOPY_MADMOM_PYTHON=/path/to/python pnpm dev`.

The downbeat tracker models 3/4 and 4/4 by default. Override that with a comma
separated list:

```sh
MIMICOPY_BEATS_PER_BAR=4 pnpm dev
```

## Development

The preferred development environment is the Docker container. It includes
Node.js, pnpm, ffmpeg, Python, and madmom, so the host only needs Docker.

```sh
MIMICOPY_UID=$(id -u) \
MIMICOPY_GID=$(id -g) \
MIMICOPY_RENDER_GID=$(stat -c '%g' /dev/dri/renderD128) \
docker compose --profile dev up --build mimicopy-dev
```

Open `http://127.0.0.1:8080/`.

If another dev server is already using the default ports, run the container on
alternate host ports:

```sh
MIMICOPY_UID=$(id -u) \
MIMICOPY_GID=$(id -g) \
MIMICOPY_RENDER_GID=$(stat -c '%g' /dev/dri/renderD128) \
MIMICOPY_DEV_CLIENT_PORT=8090 \
MIMICOPY_DEV_API_PORT=5184 \
docker compose --profile dev up --build mimicopy-dev
```

Then open `http://127.0.0.1:8090/`.

For local development without Docker:

```sh
pnpm install
pnpm dev
```

Open the client URL printed by Vite.

## Stem Separation

When importing a YouTube URL, choose either `音源分離なし` or one target:

- ベース
- ドラム
- その他
- ボーカル
- ギター
- ピアノ

The original MP3 becomes available first. If a stem was requested, the track
page polls the background job until the separated MP3 is ready. The mixer then
plays the original and separated audio together with independent volume,
mute, and solo controls.

The TypeScript API only queues the requested stem and stores its status. All
model loading, STFT/iSTFT, OpenVINO inference, and MP3 encoding live in the
isolated `services/stem-separator` Python container. The container uses the
official BS-RoFormer SW 6-stem FP16 ONNX model but reconstructs and saves only
the requested output.

The first container start downloads the approximately 353 MB model to
`storage/models` and compiles an OpenVINO cache under
`storage/openvino-cache`. Neither is committed to Git. Override the
quality/speed overlap when needed:

```sh
MIMICOPY_STEM_OVERLAP=0.1 docker compose up -d stem-separator mimicopy
```

`0.25` is the default used by the validated high-quality path.

### Model provenance

The ONNX repository is labeled MIT, but its model card also says the pretrained
weights were rehosted without a stated license or training provenance. Do not
treat the repository license label alone as clearance to redistribute or use
the weights commercially. Resolve the weight provenance before a public
product release:

- https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx

## Beat And Click Track

In the track editor, paste a YouTube URL into the Click track controls and use
the refresh button to run madmom beat/downbeat analysis on that separate audio
source. Once the beat grid is loaded, toggle `Click` to layer synthesized click
sounds over the current track playback. Downbeats use the accent click. The
beat/downbeat positions and YouTube reference are saved in SQLite for the open
track and load automatically the next time that track is opened.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Production Docker Hosting

Production runs as a public Node container plus an internal Python/OpenVINO
stem-separator container. Express serves `/api`, `/media`, and the Vite-built
`dist` assets from port `5174`; the Python API is reachable only on the Compose
network.

The production image includes:

- Node.js 24.18.0
- system `ffmpeg` at `/usr/bin/ffmpeg`
- Python 3 with `madmom==0.16.1`
- pinned madmom prerequisites from `requirements-madmom.txt`

Build and run locally:

```sh
docker compose build mimicopy stem-separator
MIMICOPY_UID=$(id -u) \
MIMICOPY_GID=$(id -g) \
MIMICOPY_RENDER_GID=$(stat -c '%g' /dev/dri/renderD128) \
docker compose up -d mimicopy stem-separator
```

By default, compose binds `127.0.0.1:5174` and stores app data in `./storage`.
Point Cloudflare Tunnel at `http://localhost:5174`.

To smoke-test Docker while the dev server is still running, use a different
host port and storage path:

```sh
mkdir -p /tmp/mimicopy-docker-smoke
MIMICOPY_UID=$(id -u) \
MIMICOPY_GID=$(id -g) \
MIMICOPY_RENDER_GID=$(stat -c '%g' /dev/dri/renderD128) \
MIMICOPY_HOST_PORT=5184 \
MIMICOPY_STORAGE_PATH=/tmp/mimicopy-docker-smoke \
docker compose up -d --build mimicopy stem-separator
curl http://127.0.0.1:5184/api/health
MIMICOPY_HOST_PORT=5184 MIMICOPY_STORAGE_PATH=/tmp/mimicopy-docker-smoke docker compose down
```

## Automatic Deployment

`.github/workflows/deploy.yml` verifies pull requests and main pushes. On a
push to `main`, it builds and publishes the Node and stem-separator images with
`main` and `sha-*` tags.

If these repository secrets are configured, the workflow also SSHes into the
server and pulls and restarts both Compose services:

- `MIMICOPY_DEPLOY_HOST`
- `MIMICOPY_DEPLOY_USER`
- `MIMICOPY_DEPLOY_SSH_KEY`
- `MIMICOPY_DEPLOY_PATH`
- `MIMICOPY_DEPLOY_PORT` (optional, defaults to `22`)

The server path should be a clean checkout of this repository with Docker
Compose installed. If the GHCR package is private, run `docker login ghcr.io`
on the server once with a token that can read packages.
