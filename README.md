# Mimicopy

耳コピしやすい簡易DAW風Webアプリです。MP3アップロード、YouTube URLからのmp3変換、波形表示、YouTube風ショートカット、任意時刻マーカーに対応しています。

## Requirements

- Node.js 26+
- pnpm 11+
- `ffmpeg` in `PATH` for YouTube-to-mp3 conversion

If `ffmpeg` is installed in a custom location, start the server with `FFMPEG_PATH=/path/to/ffmpeg pnpm dev`.

## Development

```sh
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173/`.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Cloudflare Deployment

This app uses `ffmpeg` for YouTube-to-mp3 conversion, so deploy it to Cloudflare
Workers with a Cloudflare Container backend instead of a plain Worker or Pages
Function.

Prerequisites:

- Docker or a Docker-compatible engine running locally
- Wrangler authenticated with Cloudflare
- A Cloudflare plan with Containers enabled

```sh
pnpm deploy:cloudflare
```

The Worker serves the built Vite app from `dist/` and routes `/api` and `/media`
requests to a single named container instance so generated MP3 files are served
from the same backend that created them.
