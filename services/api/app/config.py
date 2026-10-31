from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    frontend_url: str = "http://localhost:3000"
    database_url: str = "sqlite:///./karaoketext.db"
    redis_url: str = "redis://localhost:6379/0"
    storage_path: Path = Path("./storage")
    max_upload_size_mb: int = 0
    max_audio_duration_seconds: int = 3600
    job_timeout_seconds: int = 7200
    transcription_model: str = "small"
    transcription_device: str = "cpu"
    transcription_compute_type: str = "int8"
    log_level: str = "INFO"

    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parents[3] / ".env", extra="ignore")


settings = Settings()
settings.storage_path.mkdir(parents=True, exist_ok=True)