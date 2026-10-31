import json
import logging
import subprocess
import tempfile
import time
from pathlib import Path

from celery import Celery

from .config import settings
from .database import SessionLocal
from .models import TranscriptionJob
from .alignment import align_reference_lyrics
from .transcription import FasterWhisperProvider

logger = logging.getLogger(__name__)

celery = Celery("karaoketext", broker=settings.redis_url, backend=settings.redis_url)
celery.conf.update(
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_time_limit=7200,
    broker_connection_timeout=2,
    broker_connection_retry_on_startup=False,
    broker_transport_options={"socket_connect_timeout": 2, "socket_timeout": 2},
    result_backend_transport_options={"socket_connect_timeout": 2, "socket_timeout": 2},
)


@celery.task(bind=True, name="karaoketext.transcribe", max_retries=1)
def transcribe_job(self, job_id: str) -> None:
    session = SessionLocal()
    try:
        job = session.get(TranscriptionJob, job_id)
        if not job:
            return
        saved_request = json.loads(job.transcript_json) if job.transcript_json else {}
        source_lyrics = saved_request.get("source_lyrics")
        language_mode = saved_request.get("language_mode", "selected" if job.language else "auto")
        requested_language = saved_request.get("requested_language", job.language)
        asset_path = settings.storage_path / job.asset.storage_key
        job.status, job.stage, job.progress = "processing", "Extracting audio", 15
        session.commit()
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = Path(temp_dir) / "audio.wav"
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", str(asset_path), "-vn", "-ac", "1", "-ar", "16000", str(audio_path)],
                check=True,
                capture_output=True,
                timeout=300,
            )
            job.stage, job.progress = "Preparing transcription model", 20
            session.commit()
            provider = FasterWhisperProvider(job.model_size, settings.transcription_device, settings.transcription_compute_type)

            last_saved_progress = -1
            last_saved_at = 0.0

            def update_progress(stage: str, progress: int) -> None:
                nonlocal last_saved_progress, last_saved_at
                now = time.monotonic()
                if progress == last_saved_progress and now - last_saved_at < 5:
                    return
                current_job = session.get(TranscriptionJob, job_id)
                if current_job is None:
                    return
                current_job.stage = stage
                current_job.progress = progress
                session.commit()
                last_saved_progress, last_saved_at = progress, now

            transcript = provider.transcribe(
                audio_path,
                job.language,
                duration_seconds=job.asset.duration_seconds,
                progress_callback=update_progress,
            )
            if source_lyrics:
                update_progress("Matching supplied lyrics to recognized words", 97)
                transcript = align_reference_lyrics(source_lyrics, transcript)
                if not transcript["segments"]:
                    raise RuntimeError("No supplied lyric lines matched the audio confidently. Check the lyrics and selected language.")
            transcript["language_mode"] = language_mode
            transcript["requested_language"] = requested_language
            transcript["model_size"] = job.model_size
            transcript["audio_preprocessing"] = "FFmpeg mono 16 kHz decode; no vocal isolation or denoising."
            transcript["alignment_method"] = "Matched supplied text against real model word timestamps." if source_lyrics else None
        job.transcript_json = json.dumps(transcript, ensure_ascii=False)
        job.language = transcript.get("language")
        job.status, job.stage, job.progress = "ready_for_review", "Ready for review", 100
        session.commit()
    except Exception as exc:
        logger.exception("Transcription job %s failed", job_id)
        session.rollback()
        failed = session.get(TranscriptionJob, job_id)
        if failed:
            failed.status, failed.stage, failed.error = "failed", "Transcription failed", str(exc)[:1000]
            session.commit()
    finally:
        session.close()