from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .separator import STEM_NAMES, StemSeparator


StemName = Literal["bass", "drums", "other", "vocals", "guitar", "piano"]


class SeparationRequest(BaseModel):
    input_filename: str
    output_filename: str
    remainder_output_filename: str
    target_stem: StemName


class SeparationResponse(BaseModel):
    elapsed_seconds: float
    output_filename: str
    remainder_output_filename: str
    target_stem: StemName


def resolve_media_file(media_dir: Path, filename: str) -> Path:
    if (
        not filename
        or Path(filename).name != filename
        or Path(filename).suffix.lower() != ".mp3"
    ):
        raise ValueError("Media filename must be a plain MP3 filename.")

    candidate = (media_dir / filename).resolve()
    if candidate.parent != media_dir:
        raise ValueError("Media filename escapes the media directory.")
    return candidate


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.separation_lock = asyncio.Lock()
    app.state.media_dir = Path(
        os.environ.get("MIMICOPY_MEDIA_DIR", "/data/media")
    ).resolve()
    app.state.media_dir.mkdir(parents=True, exist_ok=True)
    app.state.separator = await asyncio.to_thread(
        StemSeparator.from_environment
    )
    yield


app = FastAPI(
    docs_url=None,
    lifespan=lifespan,
    openapi_url=None,
    redoc_url=None,
    title="Mimicopy stem separator",
)


@app.get("/health")
async def health() -> dict[str, object]:
    separator: StemSeparator = app.state.separator
    return {
        "device": separator.device,
        "ok": True,
        "stems": STEM_NAMES,
    }


@app.post("/v1/separations", response_model=SeparationResponse)
async def separate(request: SeparationRequest) -> SeparationResponse:
    media_dir: Path = app.state.media_dir
    try:
        input_path = resolve_media_file(media_dir, request.input_filename)
        output_path = resolve_media_file(media_dir, request.output_filename)
        remainder_output_path = resolve_media_file(
            media_dir, request.remainder_output_filename
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if not input_path.is_file():
        raise HTTPException(status_code=404, detail="Input MP3 was not found.")
    if len({input_path, output_path, remainder_output_path}) != 3:
        raise HTTPException(
            status_code=400,
            detail="Input and output filenames must all be different.",
        )

    separator: StemSeparator = app.state.separator
    lock: asyncio.Lock = app.state.separation_lock
    try:
        async with lock:
            if output_path.is_file() and remainder_output_path.is_file():
                return SeparationResponse(
                    elapsed_seconds=0,
                    output_filename=request.output_filename,
                    remainder_output_filename=(
                        request.remainder_output_filename
                    ),
                    target_stem=request.target_stem,
                )

            output_path.unlink(missing_ok=True)
            remainder_output_path.unlink(missing_ok=True)
            elapsed_seconds = await asyncio.to_thread(
                separator.separate_file,
                input_path=input_path,
                output_path=output_path,
                remainder_output_path=remainder_output_path,
                target_stem=request.target_stem,
            )
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    return SeparationResponse(
        elapsed_seconds=elapsed_seconds,
        output_filename=request.output_filename,
        remainder_output_filename=request.remainder_output_filename,
        target_stem=request.target_stem,
    )
