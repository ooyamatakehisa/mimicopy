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
