from pathlib import Path
from collections.abc import Callable
from threading import Lock


LANGUAGE_OPTIONS = [
    {"code": "km", "name": "Khmer", "script": "Khmer"},
    {"code": "en", "name": "English", "script": "Latin"},
    {"code": "th", "name": "Thai", "script": "Thai"},
    {"code": "vi", "name": "Vietnamese", "script": "Latin"},
    {"code": "ja", "name": "Japanese", "script": "Japanese"},
    {"code": "ko", "name": "Korean", "script": "Hangul"},
    {"code": "zh", "name": "Chinese", "script": "Han"},
]
MODEL_OPTIONS = [
    {"id": "small", "name": "Small", "tradeoff": "Lower resource use; balanced speed and quality."},
    {"id": "medium", "name": "Medium", "tradeoff": "Higher resource use; may improve recognition on some recordings."},
    {"id": "large-v3", "name": "Large v3", "tradeoff": "Highest resource use here; not guaranteed to be more accurate for singing."},
]

_model_cache_key: tuple[str, str, str] | None = None
_model_cache = None
_model_cache_lock = Lock()
_inference_lock = Lock()


def load_whisper_model(model_size: str, device: str, compute_type: str):
    global _model_cache_key, _model_cache
    key = (model_size, device, compute_type)
    with _model_cache_lock:
        if _model_cache_key != key:
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:
                raise RuntimeError(f"faster-whisper dependency is unavailable: {exc}") from exc
            _model_cache = WhisperModel(model_size, device=device, compute_type=compute_type)
            _model_cache_key = key
        return _model_cache


class FasterWhisperProvider:
    """Lazy model adapter; no transcript is returned unless real inference succeeds."""

    def __init__(self, model_size: str, device: str, compute_type: str):
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type

    def transcribe(
        self,
        audio_path: Path,
        language: str | None = None,
        duration_seconds: float | None = None,
        progress_callback: Callable[[str, int], None] | None = None,
    ) -> dict:
        try:
            if progress_callback:
                progress_callback("Loading transcription model; it is reused after first load", 20)
            model = load_whisper_model(self.model_size, self.device, self.compute_type)
            if progress_callback:
                progress_callback("Recognizing lyrics", 35)
            with _inference_lock:
                segments, info = model.transcribe(
                    str(audio_path),
                    language=language,
                    task="transcribe",
                    beam_size=5,
                    temperature=0,
                    word_timestamps=True,
                    vad_filter=False,
                    condition_on_previous_text=False,
                )
                transcript_segments = []
                last_end = 0.0
                for segment in segments:
                    start = max(last_end, max(0.0, float(segment.start)))
                    end = max(start, float(segment.end))
                    text = segment.text.strip()
                    words = [
                        {
                            "text": word.word,
                            "start": round(max(start, float(word.start)), 3),
                            "end": round(min(end, max(float(word.start), float(word.end))), 3),
                            "status": "model",
                        }
                        for word in (segment.words or [])
                        if word.end >= word.start and float(word.start) >= start and float(word.end) <= end
                    ]
                    if text and end > start:
                        transcript_segments.append({
                            "start": round(start, 3),
                            "end": round(end, 3),
                            "text": text,
                            "status": "review",
                            "words": words,
                        })
                    last_end = end
                    if progress_callback and duration_seconds and duration_seconds > 0:
                        progress = min(95, 35 + int(60 * min(end / duration_seconds, 1)))
                        progress_callback("Recognizing lyrics", progress)
            return {
                "language": info.language,
                "language_probability": info.language_probability,
                "segments": transcript_segments,
                "word_timestamps_available": any(segment["words"] for segment in transcript_segments),
            }
        except Exception as exc:
            raise RuntimeError(f"Transcription model failed: {exc}") from exc