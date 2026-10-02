# Mimicopy

耳コピしやすい簡易DAW風Webアプリです。MP3アップロード、YouTube
URLからのmp3変換、任意の1ステムと残りの全ステムの音源分離、
同期ミキサー、波形表示、YouTube風ショートカット、任意時刻マーカーに
対応しています。

## Requirements

For Docker-based development and production:

- Docker with Docker Compose
- Intel GPU exposed at `/dev/dri` for stem separation

For local development without Docker:

- Node.js 24.18.0
- pnpm 11+
- `ffmpeg` in `PATH` for YouTube-to-mp3 conversion
- Python 3.11 with development headers, Git, and a C compiler for Beat This! beat/downbeat analysis

If `ffmpeg` is installed in a custom location for development, start the server
with `FFMPEG_PATH=/path/to/ffmpeg pnpm dev`.

Install the pinned CPU inference dependencies in a virtual environment:

```sh
python3.11 -m venv /tmp/mimicopy-beat-this
/tmp/mimicopy-beat-this/bin/pip install -r requirements-beat-this.txt
MIMICOPY_BEAT_PYTHON=/tmp/mimicopy-beat-this/bin/python pnpm dev
```

[Beat This!](https://github.com/CPJKU/beat_this) uses the `final0` checkpoint
and DBN postprocessing (`dbn=True`), with the upstream 3/4 and 4/4 meter
candidates. madmom is used only for DBN decoding; its old RNN is not used.
`beatsPerBar` records observed complete measures and is empty when no complete measure was detected.
`MIMICOPY_BEATS_PER_BAR` and `MIMICOPY_MADMOM_PYTHON` are no longer used.

CPU inference uses two threads by default; override with `MIMICOPY_BEAT_THREADS`.
`MIMICOPY_BEAT_ANALYSIS_TIMEOUT_MS` controls the five-minute job timeout.
For local installs, the first analysis downloads the approximately 78 MB model
to the PyTorch cache (`TORCH_HOME`). Docker downloads it at build time so
analysis also works without network access and as a non-root user.

## Development

The preferred development environment is the Docker container. It includes
Node.js, pnpm, ffmpeg, Python, and Beat This!, so the host only needs Docker.

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

## Library Folders

The library supports one level of folders. Use **新しいフォルダ** to create
one, then select tracks and choose **選択した曲を移動**, or use a track's
folder button. Choose **未分類** as the destination to remove a track from
its folder. Search applies to the current folder or collection.

Open a folder to rename or delete it. Deleting a folder keeps its tracks,
markers and separated audio and returns the tracks to **未分類**. New imports
start in **未分類**. Folder selection survives reloads and is restored when
returning from the track editor. On smaller screens, use the folder selector
above the list. Folder names can be saved with Enter or cancelled with Escape.

Existing SQLite libraries are migrated automatically without changing media
files. Folder memberships and names are stored in the same database.

## Stem Separation

When importing a YouTube URL, choose either `音源分離なし` or one target:

- ベース
- ドラム
- その他
- ボーカル
- ギター
- ピアノ

The original MP3 becomes available first. If a stem was requested, the track
page polls the background job until both separated MP3s are ready. While the
job is running, it shows completed and total audio segments, percentage, and
an estimated remaining time. The mixer then plays the original, requested
stem, and the sum of every other stem together with independent volume, mute,
and solo controls.

The TypeScript API only queues the requested outputs and stores their status.
All model loading, STFT/iSTFT, OpenVINO inference, and MP3 encoding live in the
isolated `services/stem-separator` Python container. The container uses the
official BS-RoFormer SW 6-stem FP16 ONNX model. A single inference reconstructs
the requested output and sums the other five model outputs into a second MP3.

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

Each imported MP3 or YouTube track is analyzed automatically in the background
using Beat This!. Once the grid is ready, toggle `Click` to play synthesized
clicks with accents on detected downbeats. Use the refresh button to reanalyze
the current track. Results are saved in SQLite and reloaded when reopening it.

Existing madmom results remain readable and keep their original `source`.
Refreshing replaces them with Beat This! results (`source: "beat-this"`,
`model: "final0"`, `postprocessor: "dbn"`); existing tracks are not silently reanalyzed on startup.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
python3 -m unittest discover -s scripts -p 'test_*.py'
pnpm e2e
```

## Production Docker Hosting

Production runs as a public Node container plus an internal Python/OpenVINO
stem-separator container. Express serves `/api`, `/media`, and the Vite-built
`dist` assets from port `5174`; the Python API is reachable only on the Compose
network.

The production image includes:

- Node.js 24.18.0
- system `ffmpeg` at `/usr/bin/ffmpeg`
- Python 3.11 with `beat-this==1.1.0` and CPU-only PyTorch
- pinned inference dependencies and modern madmom DBN code from `requirements-beat-this.txt`
- the `final0` model cached under `/opt/beat-this/models`

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
