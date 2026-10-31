import json
import logging
import math
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from fractions import Fraction
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from .config import settings
from .database import Base, engine, get_db, SessionLocal
from .exporters import serialize
from .media import inspect_media, store_upload
from .models import Export, MediaAsset, Project, TranscriptionJob
from .worker import transcribe_job
from .transcription import LANGUAGE_OPTIONS, MODEL_OPTIONS

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)
local_job_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="karaoketext-local-job")


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    recovered_jobs = recover_stale_jobs()
    if recovered_jobs:
        logger.warning("Marked %s interrupted transcription job(s) as failed during startup", recovered_jobs)
    yield


app = FastAPI(title="KaraokeText AI API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


def recover_stale_jobs(redis_available: bool | None = None) -> int:
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=settings.job_timeout_seconds)
    if redis_available is None:
        try:
            with transcribe_job.app.connection_for_write() as connection:
                connection.ensure_connection(max_retries=0)
            redis_available = True
        except Exception:
            redis_available = False
    recover_local_jobs = settings.app_env.lower() == "development" and not redis_available
    session = SessionLocal()
    try:
        query = session.query(TranscriptionJob).filter(TranscriptionJob.status == "processing")
        if not recover_local_jobs:
            query = query.filter(TranscriptionJob.created_at < cutoff)
        stale_jobs = query.all()
        for job in stale_jobs:
            job.status = "failed"
            job.stage = "Processing interrupted"
            job.error = (
                "The local background task was interrupted when the API stopped. Retry with a smaller model."
                if recover_local_jobs
                else "The background process exceeded the configured timeout. Retry with a smaller model or check the worker logs."
            )
        if stale_jobs:
            session.commit()
        return len(stale_jobs)
    finally:
        session.close()


class TranscribeRequest(BaseModel):
    asset_id: str
    language: str | None = Field(default=None, max_length=16)
    model_size: str = Field(default="small", pattern="^(small|medium|large-v3)$")
    mode: Literal["auto", "selected", "multilingual"] | None = None

    @model_validator(mode="after")
    def validate_language(self):
        language_codes = {item["code"] for item in LANGUAGE_OPTIONS}
        if self.language not in {None, "auto", "multi", *language_codes}:
            raise ValueError(f"Unsupported transcription language code: {self.language}")
        if self.mode == "selected" and self.language not in language_codes:
            raise ValueError("Selected-language mode requires a supported language code.")
        return self


class AlignRequest(BaseModel):
    asset_id: str
    lyrics_text: str = Field(min_length=1, max_length=40000)
    language: str | None = Field(default=None, max_length=16)
    model_size: str = Field(default="small", pattern="^(small|medium|large-v3)$")
    mode: Literal["auto", "selected", "multilingual"] | None = None

    @model_validator(mode="after")
    def validate_language(self):
        language_codes = {item["code"] for item in LANGUAGE_OPTIONS}
        if self.language not in {None, "auto", "multi", *language_codes}:
            raise ValueError(f"Unsupported transcription language code: {self.language}")
        if self.mode == "selected" and self.language not in language_codes:
            raise ValueError("Selected-language mode requires a supported language code.")
        return self


class ProjectCreate(BaseModel):
    title: str = Field(default="Untitled project", min_length=1, max_length=255)
    asset_id: str | None = None
    transcript: dict = Field(default_factory=lambda: {"segments": []})


class ProjectUpdate(BaseModel):
    version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=255)
    transcript: dict | None = None


class ExportRequest(BaseModel):
    format: str = Field(pattern="^(srt|vtt|lrc|txt|json)$")
    allow_overlaps: bool = False


class VideoEffect(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["blur", "brightness", "contrast", "saturation", "grayscale", "sepia", "vignette"]
    enabled: bool = True
    intensity: float = Field(ge=-1, le=20)


class VideoKeyframe(BaseModel):
    id: str
    property: Literal["opacity", "brightness", "scale", "position_x", "position_y", "rotation"]
    time: float = Field(ge=0)
    value: float = Field(ge=-10000, le=10000)
    interpolation: Literal["linear", "hold", "ease-in", "ease-out", "ease-in-out"] = "linear"


class VideoTransition(BaseModel):
    type: Literal["fade-in", "fade-out", "cross-dissolve"]
    duration: float = Field(gt=0, le=2)


class VideoTransform(BaseModel):
    scale: float = Field(default=1, ge=0.1, le=4)
    x: float = Field(default=0, ge=-10000, le=10000)
    y: float = Field(default=0, ge=-10000, le=10000)
    rotation: float = Field(default=0, ge=-360, le=360)


class VideoClip(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    timeline_start: float | None = Field(default=None, ge=0)
    effects: list[VideoEffect] = Field(default_factory=list, max_length=50)
    keyframes: list[VideoKeyframe] = Field(default_factory=list, max_length=1000)
    transition_in: VideoTransition | None = None
    transition_out: VideoTransition | None = None
    transform: VideoTransform | None = None


class VideoSubtitle(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    text: str = Field(min_length=1, max_length=1000)


class VideoRenderRequest(BaseModel):
    clips: list[VideoClip] = Field(min_length=1, max_length=50)
    subtitles: list[VideoSubtitle] = Field(default_factory=list, max_length=10000)
    burn_subtitles: bool = False
    font_size: int = Field(default=24, ge=12, le=72)


@app.get("/health")
def health():
    return {"status": "ok", "service": "api"}


@app.get("/api/v1/transcription/capabilities")
def transcription_capabilities():
    return {
        "languages": LANGUAGE_OPTIONS,
        "models": MODEL_OPTIONS,
        "alignment_granularity": "line",
        "mixed_language_detection": "Whisper auto-detection is recording-level, not per-segment.",
    }


@app.post("/api/v1/uploads", status_code=201)
async def upload_media(file: UploadFile = File(...), db: Session = Depends(get_db)):
    asset_id, path, size = await store_upload(file)
    try:
        metadata = inspect_media(path)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    asset = MediaAsset(
        id=asset_id,
        original_filename=Path(file.filename or "audio").name[:255],
        storage_key=path.name,
        size_bytes=size,
        duration_seconds=metadata["duration_seconds"],
    )
    db.add(asset)
    db.commit()
    return {"asset_id": asset.id, "filename": asset.original_filename, "size_bytes": size, **metadata}


@app.post("/api/v1/jobs/transcribe", status_code=202)
def create_transcription(request: TranscribeRequest, db: Session = Depends(get_db)):
    asset = db.get(MediaAsset, request.asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Media asset not found.")
    language = request.language if request.mode == "selected" or request.mode is None and request.language not in {None, "auto", "multi"} else None
    mode = request.mode or ("selected" if language else "auto")
    job = TranscriptionJob(
        asset_id=asset.id,
        language=language,
        model_size=request.model_size,
        transcript_json=json.dumps({"language_mode": mode, "requested_language": language}, ensure_ascii=False),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    execution_mode = dispatch_transcription(job.id)
    return {"job_id": job.id, "status": job.status, "stage": job.stage, "progress": job.progress, "execution_mode": execution_mode}


@app.post("/api/v1/jobs/align", status_code=202)
def create_alignment(request: AlignRequest, db: Session = Depends(get_db)):
    asset = db.get(MediaAsset, request.asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Media asset not found.")
    job = TranscriptionJob(
        asset_id=asset.id,
        language=request.language if request.mode == "selected" or request.mode is None and request.language not in {None, "auto", "multi"} else None,
        model_size=request.model_size,
        transcript_json=json.dumps({
            "source_lyrics": request.lyrics_text,
            "language_mode": request.mode or ("selected" if request.language not in {None, "auto", "multi"} else "auto"),
            "requested_language": request.language if request.mode == "selected" or request.mode is None and request.language not in {None, "auto", "multi"} else None,
        }, ensure_ascii=False),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    execution_mode = dispatch_transcription(job.id)
    return {"job_id": job.id, "status": job.status, "stage": job.stage, "progress": job.progress, "execution_mode": execution_mode}


@app.get("/api/v1/jobs/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(TranscriptionJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    created_at = job.created_at.replace(tzinfo=None) if job.created_at.tzinfo else job.created_at
    elapsed_seconds = max(0, int((datetime.now(timezone.utc).replace(tzinfo=None) - created_at).total_seconds()))
    result = {
        "id": job.id,
        "status": job.status,
        "stage": job.stage,
        "progress": job.progress,
        "model_size": job.model_size,
        "elapsed_seconds": elapsed_seconds,
    }
    if job.error:
        result["error"] = job.error
    if job.transcript_json:
        transcript = json.loads(job.transcript_json)
        if "source_lyrics" not in transcript:
            result["transcript"] = transcript
    return result


@app.post("/api/v1/jobs/{job_id}/retry", status_code=202)
def retry_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(TranscriptionJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.status != "failed":
        raise HTTPException(status_code=409, detail="Only failed jobs can be retried.")
    job.status, job.stage, job.progress, job.error = "queued", "Queued", 0, None
    db.commit()
    execution_mode = dispatch_transcription(job.id)
    return {"job_id": job.id, "status": job.status, "stage": job.stage, "progress": job.progress, "execution_mode": execution_mode}


def dispatch_transcription(job_id: str) -> str:
    try:
        with transcribe_job.app.connection_for_write() as connection:
            connection.ensure_connection(max_retries=0)
        transcribe_job.delay(job_id)
        return "celery"
    except Exception as exc:
        if settings.app_env.lower() != "development":
            logger.exception("Unable to enqueue transcription job %s", job_id)
            raise HTTPException(
                status_code=503,
                detail="Redis is unavailable. Start Redis and a Celery worker, then retry the job.",
            ) from exc
        logger.warning("Redis is unavailable; running job %s with the development background executor: %s", job_id, exc)
        local_job_executor.submit(transcribe_job.run, job_id)
        return "local-development"


@app.get("/api/v1/projects")
def list_projects(db: Session = Depends(get_db)):
    return [project_payload(project) for project in db.query(Project).order_by(Project.updated_at.desc()).all()]


@app.post("/api/v1/projects", status_code=201)
def create_project(request: ProjectCreate, db: Session = Depends(get_db)):
    if request.asset_id and not db.get(MediaAsset, request.asset_id):
        raise HTTPException(status_code=404, detail="Media asset not found.")
    project = Project(title=request.title, asset_id=request.asset_id, transcript_json=json.dumps(request.transcript, ensure_ascii=False))
    db.add(project)
    db.commit()
    db.refresh(project)
    return project_payload(project)


@app.get("/api/v1/projects/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project_payload(project)


@app.get("/api/v1/projects/{project_id}/audio")
def get_project_audio(project_id: str, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project or not project.asset_id:
        raise HTTPException(status_code=404, detail="Project audio not found.")
    asset = db.get(MediaAsset, project.asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Project audio not found.")
    path = settings.storage_path / asset.storage_key
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Project audio file is no longer available.")
    media_types = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".wave": "audio/wav",
        ".ogg": "audio/ogg",
        ".oga": "audio/ogg",
        ".flac": "audio/flac",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".webm": "video/webm",
        ".mkv": "video/x-matroska",
        ".avi": "video/x-msvideo",
    }
    return FileResponse(path, media_type=media_types.get(path.suffix.lower(), "application/octet-stream"), filename=asset.original_filename)


@app.post("/api/v1/projects/{project_id}/video-export", status_code=201)
def export_video(project_id: str, request: VideoRenderRequest, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project or not project.asset_id:
        raise HTTPException(status_code=404, detail="Project video not found.")
    asset = db.get(MediaAsset, project.asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Project video not found.")

    source = (settings.storage_path / asset.storage_key).resolve()
    storage_root = settings.storage_path.resolve()
    if source.parent != storage_root or not source.is_file():
        raise HTTPException(status_code=404, detail="Project media file is no longer available.")

    timeline_clips: list[VideoClip] = []
    next_timeline_start = 0.0
    for clip in request.clips:
        timeline_start = clip.timeline_start if clip.timeline_start is not None else next_timeline_start
        timeline_clips.append(clip.model_copy(update={"timeline_start": timeline_start}))
        next_timeline_start = max(next_timeline_start, timeline_start + clip.end - clip.start)
    clips = sorted(timeline_clips, key=lambda clip: clip.timeline_start)
    seen_effect_ids: set[str] = set()
    seen_keyframe_ids: set[str] = set()
    for index, clip in enumerate(clips):
        if (
            not math.isfinite(clip.start)
            or not math.isfinite(clip.end)
            or clip.timeline_start is None
            or not math.isfinite(clip.timeline_start)
            or clip.end <= clip.start
            or clip.end > asset.duration_seconds
        ):
            raise HTTPException(status_code=422, detail="Every clip must have a valid range within the source media.")
        duration = clip.end - clip.start
        if any(keyframe.time < clip.start or keyframe.time > clip.end or not math.isfinite(keyframe.time) for keyframe in clip.keyframes):
            raise HTTPException(status_code=422, detail="Keyframe times must fall within their clip's source range.")
        if any(keyframe.property == "opacity" and not 0 <= keyframe.value <= 1 for keyframe in clip.keyframes):
            raise HTTPException(status_code=422, detail="Opacity keyframes must be between 0 and 1.")
        if any(keyframe.property == "scale" and not 0.1 <= keyframe.value <= 4 for keyframe in clip.keyframes):
            raise HTTPException(status_code=422, detail="Scale keyframes must be between 0.1 and 4.")
        if any(keyframe.property == "brightness" and not -1 <= keyframe.value <= 1 for keyframe in clip.keyframes):
            raise HTTPException(status_code=422, detail="Brightness keyframes must be between -1 and 1.")
        if any(keyframe.property in {"position_x", "position_y"} and not -10000 <= keyframe.value <= 10000 for keyframe in clip.keyframes):
            raise HTTPException(status_code=422, detail="Position keyframes must be between -10000 and 10000.")
        if any(keyframe.property == "rotation" and not -360 <= keyframe.value <= 360 for keyframe in clip.keyframes):
            raise HTTPException(status_code=422, detail="Rotation keyframes must be between -360 and 360.")
        keyframe_positions = [(keyframe.property, keyframe.time) for keyframe in clip.keyframes]
        if len(keyframe_positions) != len(set(keyframe_positions)):
            raise HTTPException(status_code=422, detail="A clip cannot contain duplicate keyframes for one property at the same time.")
        keyframe_ids = {keyframe.id for keyframe in clip.keyframes}
        if len(keyframe_ids) != len(clip.keyframes) or keyframe_ids & seen_keyframe_ids:
            raise HTTPException(status_code=422, detail="Keyframe instance IDs must be unique across the project.")
        seen_keyframe_ids.update(keyframe_ids)
        if any(
            (effect.type == "blur" and effect.intensity < 0)
            or (effect.type == "brightness" and not -1 <= effect.intensity <= 1)
            or (effect.type in {"contrast", "saturation"} and not 0 <= effect.intensity <= 2)
            or (effect.type in {"grayscale", "sepia", "vignette"} and not 0 <= effect.intensity <= 1)
            for effect in clip.effects
        ):
            raise HTTPException(status_code=422, detail="Effect intensity is outside the supported range for its effect.")
        effect_ids = {effect.id for effect in clip.effects}
        if len(effect_ids) != len(clip.effects) or effect_ids & seen_effect_ids:
            raise HTTPException(status_code=422, detail="Effect instance IDs must be unique across the project.")
        seen_effect_ids.update(effect_ids)
        if any(
            transition and transition.duration > duration / 2
            for transition in (clip.transition_in, clip.transition_out)
        ):
            raise HTTPException(status_code=422, detail="A fade transition cannot exceed half of its clip's duration.")
        if clip.transition_out and clip.transition_out.type == "cross-dissolve":
            following = clips[index + 1] if index + 1 < len(clips) else None
            if not following or abs(following.timeline_start - (clip.timeline_start + duration)) > 0.03:
                raise HTTPException(status_code=422, detail="A cross dissolve requires an adjacent following clip.")
            if clip.transition_out.duration > (following.end - following.start) / 2:
                raise HTTPException(status_code=422, detail="A cross dissolve cannot exceed half of either adjacent clip.")
    for previous, following in zip(clips, clips[1:]):
        previous_end = previous.timeline_start + previous.end - previous.start
        if following.timeline_start < previous_end - 0.001:
            raise HTTPException(status_code=422, detail="Clips on the main video track cannot overlap.")
    timeline_duration = max(clip.timeline_start + clip.end - clip.start for clip in clips)
    if timeline_duration > 24 * 60 * 60:
        raise HTTPException(status_code=422, detail="The edited timeline cannot exceed 24 hours.")
    for subtitle in request.subtitles:
        if (
            not math.isfinite(subtitle.start)
            or not math.isfinite(subtitle.end)
            or subtitle.end <= subtitle.start
        ):
            raise HTTPException(status_code=422, detail="Every subtitle must have a valid, positive time range.")

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise HTTPException(status_code=503, detail="FFmpeg must be installed on the API host to render video.")
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise HTTPException(status_code=503, detail="FFprobe must be installed on the API host to render video.")

    try:
        probe = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate", "-of", "json", str(source)],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        video_stream = json.loads(probe.stdout).get("streams", [])[0]
        width, height = int(video_stream["width"]), int(video_stream["height"])
        frame_rate = Fraction(video_stream.get("avg_frame_rate", "30/1"))
        if width <= 0 or height <= 0 or frame_rate <= 0:
            raise ValueError("Invalid source video dimensions or frame rate.")
        frame_rate = min(frame_rate, Fraction(120, 1))
    except (subprocess.SubprocessError, json.JSONDecodeError, IndexError, KeyError, TypeError, ValueError, ZeroDivisionError) as exc:
        logger.exception("Unable to probe video source for project %s", project_id)
        raise HTTPException(status_code=422, detail="Unable to read valid video metadata from the source media.") from exc

    export_id = str(uuid4())
    output_path = settings.storage_path / f"{export_id}.mp4"
    subtitle_path = settings.storage_path / f"{export_id}.srt"
    filters: list[str] = [
        f"color=c=black:s={width}x{height}:r={frame_rate.numerator}/{frame_rate.denominator}:d={timeline_duration:.6f}[base]"
    ]
    for index, clip in enumerate(clips):
        clip_duration = clip.end - clip.start
        clip_filter_chain = [
            f"[{index}:v:0]trim=start={clip.start:.6f}:end={clip.end:.6f}",
            "setpts=PTS-STARTPTS",
        ]
        for effect in clip.effects:
            if not effect.enabled:
                continue
            intensity = effect.intensity
            if effect.type == "blur" and intensity:
                clip_filter_chain.append(f"gblur=sigma={intensity:.6f}")
            elif effect.type == "brightness" and intensity:
                clip_filter_chain.append(f"eq=brightness={intensity:.6f}")
            elif effect.type == "contrast":
                clip_filter_chain.append(f"eq=contrast={intensity:.6f}")
            elif effect.type == "saturation":
                clip_filter_chain.append(f"eq=saturation={intensity:.6f}")
            elif effect.type == "grayscale":
                clip_filter_chain.append(f"hue=s={1 - intensity:.6f}")
            elif effect.type == "sepia":
                strength = intensity
                clip_filter_chain.append(
                    "colorchannelmixer="
                    f"rr={1 - strength + 0.393 * strength:.6f}:rg={0.769 * strength:.6f}:rb={0.189 * strength:.6f}:"
                    f"gr={0.349 * strength:.6f}:gg={1 - strength + 0.686 * strength:.6f}:gb={0.168 * strength:.6f}:"
                    f"br={0.272 * strength:.6f}:bg={0.534 * strength:.6f}:bb={1 - strength + 0.131 * strength:.6f}"
                )
            elif effect.type == "vignette" and intensity:
                clip_filter_chain.append(f"vignette=angle=PI*{intensity:.6f}")

        brightness_keyframes = sorted(
            (keyframe for keyframe in clip.keyframes if keyframe.property == "brightness"),
            key=lambda keyframe: keyframe.time,
        )
        if brightness_keyframes:
            brightness_expression = keyframe_expression(brightness_keyframes, clip.start, 0.0)
            clip_filter_chain.append(f"eq=brightness='{brightness_expression}':eval=frame")

        transform = clip.transform
        scale_keyframes = sorted(
            (keyframe for keyframe in clip.keyframes if keyframe.property == "scale"),
            key=lambda keyframe: keyframe.time,
        )
        if scale_keyframes or (transform and transform.scale != 1):
            scale_expression = keyframe_expression(scale_keyframes, clip.start, 1.0)
            if transform:
                scale_expression = f"({scale_expression})*{transform.scale:.6f}"
            clip_filter_chain.append(
                f"scale=w='trunc(iw*({scale_expression})/2)*2':"
                f"h='trunc(ih*({scale_expression})/2)*2':eval=frame"
            )
        rotation_keyframes = sorted(
            (keyframe for keyframe in clip.keyframes if keyframe.property == "rotation"),
            key=lambda keyframe: keyframe.time,
        )
        if rotation_keyframes:
            rotation_expression = f"({keyframe_expression(rotation_keyframes, clip.start, 0.0)})*PI/180"
            if transform:
                rotation_expression = f"({rotation_expression})+{math.radians(transform.rotation):.6f}"
            clip_filter_chain.append(
                f"rotate=angle='{rotation_expression}':ow=rotw(iw):oh=roth(ih):c=black@0"
            )
        elif transform and transform.rotation:
            clip_filter_chain.append(
                f"rotate=angle={math.radians(transform.rotation):.6f}:ow=rotw(iw):oh=roth(ih):c=black@0"
            )
        clip_filter_chain.append("format=rgba")
        opacity_keyframes = sorted(
            (keyframe for keyframe in clip.keyframes if keyframe.property == "opacity"),
            key=lambda keyframe: keyframe.time,
        )
        opacity_expression = keyframe_expression(
            opacity_keyframes,
            clip.start,
            1.0,
            f"N/{float(frame_rate):.6f}",
        )
        if opacity_keyframes:
            clip_filter_chain.append(
                f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*({opacity_expression})'"
            )
        previous_crossfade = clips[index - 1].transition_out if index > 0 else None
        incoming_fade = clip.transition_in.duration if clip.transition_in else 0
        if previous_crossfade and previous_crossfade.type == "cross-dissolve":
            incoming_fade = max(incoming_fade, previous_crossfade.duration)
        if incoming_fade:
            clip_filter_chain.append(f"fade=t=in:st=0:d={incoming_fade:.6f}:alpha=1")
        if clip.transition_out and clip.transition_out.type == "fade-out":
            clip_filter_chain.append(
                f"fade=t=out:st={clip_duration - clip.transition_out.duration:.6f}:"
                f"d={clip.transition_out.duration:.6f}:alpha=1"
            )
        if clip.transition_out and clip.transition_out.type == "cross-dissolve":
            clip_filter_chain.append(f"tpad=stop_mode=clone:stop_duration={clip.transition_out.duration:.6f}")
        clip_filter_chain.append(f"setpts=PTS+{clip.timeline_start:.6f}/TB[v{index}]")
        filters.append(",".join(clip_filter_chain))
        audio_filter_chain = [
            f"[{index}:a:0]atrim=start={clip.start:.6f}:end={clip.end:.6f}",
            "asetpts=PTS-STARTPTS",
        ]
        if incoming_fade:
            audio_filter_chain.append(f"afade=t=in:st=0:d={incoming_fade:.6f}")
        if clip.transition_out and clip.transition_out.type == "cross-dissolve":
            duration = clip.transition_out.duration
            audio_filter_chain.append(f"afade=t=out:st={clip_duration - duration:.6f}:d={duration:.6f}")
        audio_filter_chain.append(
            f"adelay=delays={round(clip.timeline_start * 1000)}|{round(clip.timeline_start * 1000)}:all=1[a{index}]"
        )
        filters.append(",".join(audio_filter_chain))
    video_chain = "base"
    for index in range(len(clips)):
        next_video = "vcat" if index == len(clips) - 1 else f"overlay{index}"
        clip = clips[index]
        transform = clip.transform
        position_x_keyframes = sorted(
            (keyframe for keyframe in clip.keyframes if keyframe.property == "position_x"),
            key=lambda keyframe: keyframe.time,
        )
        position_y_keyframes = sorted(
            (keyframe for keyframe in clip.keyframes if keyframe.property == "position_y"),
            key=lambda keyframe: keyframe.time,
        )
        transform_x = 0 if transform is None else transform.x
        transform_y = 0 if transform is None else transform.y
        position_x = keyframe_expression(
            position_x_keyframes,
            clip.start,
            0.0,
            f"t-{clip.timeline_start:.6f}",
        )
        position_y = keyframe_expression(
            position_y_keyframes,
            clip.start,
            0.0,
            f"t-{clip.timeline_start:.6f}",
        )
        overlay_x = f"'(W-w)/2+{transform_x:.3f}+({position_x})'"
        overlay_y = f"'(H-h)/2+{transform_y:.3f}+({position_y})'"
        filters.append(
            f"[{video_chain}][v{index}]overlay=x={overlay_x}:y={overlay_y}:eval=frame:eof_action=pass:repeatlast=0:"
            f"shortest=0[{next_video}]"
        )
        video_chain = next_video
    audio_inputs = "".join(f"[a{index}]" for index in range(len(clips)))
    filters.append(f"[{len(clips)}:a:0]{audio_inputs}amix=inputs={len(clips) + 1}:duration=longest:dropout_transition=0:normalize=0[aout]")

    if request.burn_subtitles and request.subtitles:
        remapped = remap_video_subtitles(request.subtitles, clips)
        subtitle_text = "\n\n".join(
            f"{index}\n{subtitle_timestamp(start)} --> {subtitle_timestamp(end)}\n{text}"
            for index, (start, end, text) in enumerate(remapped, 1)
        )
        subtitle_path.write_text(subtitle_text + ("\n" if subtitle_text else ""), encoding="utf-8", newline="\n")
        escaped_path = str(subtitle_path.resolve()).replace("\\", "/").replace(":", r"\:").replace("'", r"\'")
        filters.append(
            f"[{video_chain}]subtitles=filename='{escaped_path}':force_style='FontSize={request.font_size},"
            "PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=2,"
            "BorderStyle=1'[vout]"
        )
        video_output = "[vout]"
    else:
        filters.append(f"[{video_chain}]format=yuv420p[vout]")
        video_output = "[vout]"

    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
    for _ in clips:
        command.extend(["-i", str(source)])
    command.extend(["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"])
    command.extend([
        "-filter_complex", ";".join(filters),
        "-map", video_output,
        "-map", "[aout]",
        "-t", f"{timeline_duration:.6f}",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-c:a", "aac",
        "-movflags", "+faststart",
        str(output_path),
    ])
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=3600)
        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg did not create an output video.")
        record = Export(id=export_id, project_id=project_id, format="mp4", storage_key=output_path.name)
        db.add(record)
        db.commit()
    except FileNotFoundError as exc:
        output_path.unlink(missing_ok=True)
        logger.exception("FFmpeg was not available while rendering project %s", project_id)
        raise HTTPException(status_code=503, detail="FFmpeg could not be started. Check the API host configuration.") from exc
    except (subprocess.SubprocessError, RuntimeError) as exc:
        output_path.unlink(missing_ok=True)
        logger.exception("Video rendering failed for project %s", project_id)
        raise HTTPException(status_code=422, detail="Video rendering failed. Check that the source has video and audio streams, then retry.") from exc
    finally:
        subtitle_path.unlink(missing_ok=True)

    return {
        "export_id": record.id,
        "format": "mp4",
        "duration_seconds": timeline_duration,
        "download_url": f"/api/v1/exports/{record.id}/download",
    }


@app.patch("/api/v1/projects/{project_id}")
def update_project(project_id: str, request: ProjectUpdate, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    if project.version != request.version:
        raise HTTPException(status_code=409, detail="Project changed since it was loaded. Reload before saving.")
    if request.title is not None:
        project.title = request.title
    if request.transcript is not None:
        project.transcript_json = json.dumps(request.transcript, ensure_ascii=False)
    project.version += 1
    db.commit()
    db.refresh(project)
    return project_payload(project)


@app.delete("/api/v1/projects/{project_id}", status_code=204)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    files_to_remove = []
    exports = db.query(Export).filter(Export.project_id == project_id).all()
    files_to_remove.extend(settings.storage_path / export.storage_key for export in exports)
    for export in exports:
        db.delete(export)

    asset = db.get(MediaAsset, project.asset_id) if project.asset_id else None
    remove_asset = False
    if asset:
        other_projects = db.query(Project).filter(
            Project.asset_id == asset.id,
            Project.id != project_id,
        ).count()
        if other_projects == 0:
            active_job = db.query(TranscriptionJob).filter(
                TranscriptionJob.asset_id == asset.id,
                TranscriptionJob.status.in_(["queued", "processing"]),
            ).first()
            if active_job:
                raise HTTPException(status_code=409, detail="This workspace has a job in progress. Wait for it to finish before deleting.")
            for job in db.query(TranscriptionJob).filter(TranscriptionJob.asset_id == asset.id).all():
                db.delete(job)
            files_to_remove.append(settings.storage_path / asset.storage_key)
            db.delete(asset)
            remove_asset = True

    db.delete(project)
    db.commit()
    for path in files_to_remove:
        path.unlink(missing_ok=True)


@app.post("/api/v1/projects/{project_id}/export", status_code=201)
def create_export(project_id: str, request: ExportRequest, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    transcript = json.loads(project.transcript_json)
    try:
        content, extension, content_type = serialize(transcript.get("segments", []), request.format, request.allow_overlaps)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    export_id = str(uuid4())
    storage_key = f"{export_id}.{extension}"
    (settings.storage_path / storage_key).write_text(content, encoding="utf-8", newline="\n")
    record = Export(id=export_id, project_id=project_id, format=extension, storage_key=storage_key)
    db.add(record)
    db.commit()
    return {"export_id": record.id, "format": record.format, "download_url": f"/api/v1/exports/{record.id}/download", "content_type": content_type}


@app.get("/api/v1/exports/{export_id}/download")
def download_export(export_id: str, db: Session = Depends(get_db)):
    record = db.get(Export, export_id)
    if not record:
        raise HTTPException(status_code=404, detail="Export not found.")
    path = settings.storage_path / record.storage_key
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Export file is no longer available.")
    media_types = {"srt": "application/x-subrip", "vtt": "text/vtt", "lrc": "text/plain", "txt": "text/plain", "json": "application/json", "mp4": "video/mp4"}
    return FileResponse(path, media_type=media_types[record.format], filename=f"{record.id}.{record.format}")


def subtitle_timestamp(seconds: float) -> str:
    milliseconds = round(seconds * 1000)
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{whole_seconds:02},{millis:03}"


def keyframe_expression(
    keyframes: list[VideoKeyframe],
    source_start: float,
    fallback: float,
    time_variable: str = "t",
) -> str:
    if not keyframes:
        return f"{fallback:.6f}"
    frames = sorted(keyframes, key=lambda keyframe: keyframe.time)
    first_time = frames[0].time - source_start
    expression = f"{frames[-1].value:.6f}"
    for previous, following in reversed(list(zip(frames, frames[1:]))):
        start = previous.time - source_start
        end = following.time - source_start
        delta = end - start
        if delta <= 0:
            continue
        progress = f"({time_variable}-{start:.6f})/{delta:.6f}"
        if previous.interpolation == "hold":
            interpolation = f"{previous.value:.6f}"
        else:
            eased_progress = {
                "linear": progress,
                "ease-in": f"pow({progress},2)",
                "ease-out": f"1-pow(1-({progress}),2)",
                "ease-in-out": (
                    f"if(lt({progress},0.5),2*pow({progress},2),"
                    f"1-pow(-2*({progress})+2,2)/2)"
                ),
            }[previous.interpolation]
            interpolation = (
                f"{previous.value:.6f}+({following.value - previous.value:.6f})"
                f"*({eased_progress})"
            )
        expression = f"if(lt({time_variable},{end:.6f}),{interpolation},{expression})"
    return f"if(lt({time_variable},{first_time:.6f}),{frames[0].value:.6f},{expression})"


def remap_video_subtitles(subtitles: list[VideoSubtitle], clips: list[VideoClip]) -> list[tuple[float, float, str]]:
    remapped: list[tuple[float, float, str]] = []
    for clip in clips:
        for subtitle in subtitles:
            start = max(subtitle.start, clip.start)
            end = min(subtitle.end, clip.end)
            if end > start:
                remapped.append((
                    clip.timeline_start + start - clip.start,
                    clip.timeline_start + end - clip.start,
                    subtitle.text,
                ))
    return sorted(remapped, key=lambda item: (item[0], item[1]))


def project_payload(project: Project) -> dict:
    return {
        "id": project.id,
        "title": project.title,
        "asset_id": project.asset_id,
        "version": project.version,
        "transcript": json.loads(project.transcript_json),
        "created_at": project.created_at.isoformat(),
        "updated_at": project.updated_at.isoformat(),
    }