import json
import subprocess
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from .config import settings

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".wave", ".ogg", ".oga", ".flac", ".m4a", ".aac", ".mp4", ".mov", ".webm", ".mkv", ".avi"}


def inspect_media(path: Path) -> dict:
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        metadata = json.loads(probe.stdout)
        audio_streams = [stream for stream in metadata.get("streams", []) if stream.get("codec_type") == "audio"]
        duration = float(metadata.get("format", {}).get("duration", 0))
        if not audio_streams or duration <= 0:
            raise ValueError("No valid audio stream found.")
        if duration > settings.max_audio_duration_seconds:
            raise ValueError(f"Media duration exceeds {settings.max_audio_duration_seconds} seconds.")
        subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(path), "-t", "1", "-f", "null", "-"],
            check=True,
            capture_output=True,
            timeout=45,
        )
        return {"duration_seconds": duration, "sample_rate": int(audio_streams[0].get("sample_rate", 0) or 0)}
    except (subprocess.SubprocessError, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Unable to validate media: {exc}") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="FFmpeg and FFprobe must be installed on the API host.") from exc


async def store_upload(upload: UploadFile) -> tuple[str, Path, int]:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported media extension.")
    asset_id = str(uuid.uuid4())
    destination = settings.storage_path / f"{asset_id}{suffix}"
    size = 0
    try:
        with destination.open("wb") as target:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if settings.max_upload_size_mb > 0 and size > settings.max_upload_size_mb * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="Upload exceeds the configured size limit.")
                target.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    if size == 0:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="The uploaded file is empty.")
    return asset_id, destination, size