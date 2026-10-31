import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app import main
from app.models import Export, MediaAsset, Project, TranscriptionJob


@pytest.fixture()
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)

    def override_db():
        session = TestingSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as test_client:
        yield test_client, TestingSession
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


def test_health(client):
    response = client[0].get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_transcription_capabilities_describe_languages_models_and_limits(client):
    response = client[0].get("/api/v1/transcription/capabilities")

    assert response.status_code == 200
    capabilities = response.json()
    assert {language["code"] for language in capabilities["languages"]} >= {"km", "en", "th", "vi", "ja", "ko", "zh"}
    assert {model["id"] for model in capabilities["models"]} == {"small", "medium", "large-v3"}
    assert capabilities["alignment_granularity"] == "line"
    assert "not per-segment" in capabilities["mixed_language_detection"]


def test_transcription_mode_validation_and_multilingual_job(client, monkeypatch):
    test_client, testing_session = client
    session = testing_session()
    asset = MediaAsset(original_filename="song.wav", storage_key="song.wav", size_bytes=1, duration_seconds=10)
    session.add(asset)
    session.commit()
    asset_id = asset.id
    session.close()
    monkeypatch.setattr(main, "dispatch_transcription", lambda job_id: "local-development")

    unsupported = test_client.post("/api/v1/jobs/transcribe", json={
        "asset_id": asset_id,
        "language": "xx",
        "mode": "selected",
    })
    missing_language = test_client.post("/api/v1/jobs/transcribe", json={
        "asset_id": asset_id,
        "mode": "selected",
    })
    assert unsupported.status_code == 422
    assert missing_language.status_code == 422

    multilingual = test_client.post("/api/v1/jobs/transcribe", json={
        "asset_id": asset_id,
        "language": "multi",
        "mode": "multilingual",
    })

    assert multilingual.status_code == 202
    job = testing_session().get(TranscriptionJob, multilingual.json()["job_id"])
    assert job.language is None
    assert json.loads(job.transcript_json) == {"language_mode": "multilingual", "requested_language": None}


def test_project_update_uses_version_check(client):
    test_client = client[0]
    created = test_client.post("/api/v1/projects", json={"title": "Khmer song", "transcript": {"segments": []}})
    assert created.status_code == 201
    project = created.json()
    transcript = {
        "segments": [{"start": 0.5, "end": 1.5, "text": "ចម្រៀង"}],
        "media_kind": "video",
        "editor": {
            "duration": 12,
            "clips": [{
                "id": "clip-1",
                "start": 2,
                "end": 8,
                "effects": [
                    {"id": "effect-1", "type": "blur", "enabled": True, "intensity": 5},
                    {"id": "effect-2", "type": "sepia", "enabled": False, "intensity": 0.4},
                ],
                "keyframes": [{"id": "keyframe-1", "property": "opacity", "time": 2, "value": 0.5}],
                "transition_in": {"type": "fade-in", "duration": 0.5},
                "transform": {"scale": 1.2, "x": 4, "y": -3, "rotation": 8},
            }],
        },
    }
    updated = test_client.patch(f"/api/v1/projects/{project['id']}", json={
        "version": 1,
        "title": "Edited",
        "transcript": transcript,
    })
    assert updated.status_code == 200
    assert updated.json()["version"] == 2
    reopened = test_client.get(f"/api/v1/projects/{project['id']}")
    assert reopened.json()["transcript"] == transcript
    stale = test_client.patch(f"/api/v1/projects/{project['id']}", json={"version": 1, "title": "Stale"})
    assert stale.status_code == 409


def test_export_endpoint_writes_srt(client, tmp_path, monkeypatch):
    monkeypatch.setattr(main.settings, "storage_path", tmp_path)
    test_client = client[0]
    project = test_client.post("/api/v1/projects", json={
        "title": "Khmer export",
        "transcript": {"segments": [{"start": 0, "end": 1.2, "text": "ចម្រៀង"}]},
    }).json()
    created = test_client.post(f"/api/v1/projects/{project['id']}/export", json={"format": "srt"})
    assert created.status_code == 201
    response = test_client.get(created.json()["download_url"])
    assert response.status_code == 200
    assert response.content.decode("utf-8") == "1\n00:00:00,000 --> 00:00:01,200\nចម្រៀង\n"


def test_dispatch_falls_back_to_local_executor_in_development(monkeypatch):
    class UnavailableConnection:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def ensure_connection(self, **_):
            raise OSError("Redis unavailable")

    submitted = []
    monkeypatch.setattr(main.settings, "app_env", "development")
    monkeypatch.setattr(main.transcribe_job.app, "connection_for_write", lambda: UnavailableConnection())
    monkeypatch.setattr(main.local_job_executor, "submit", lambda function, job_id: submitted.append((function, job_id)))

    mode = main.dispatch_transcription("job-123")

    assert mode == "local-development"
    assert submitted == [(main.transcribe_job.run, "job-123")]


def test_dispatch_requires_redis_outside_development(monkeypatch):
    class UnavailableConnection:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def ensure_connection(self, **_):
            raise OSError("Redis unavailable")

    monkeypatch.setattr(main.settings, "app_env", "production")
    monkeypatch.setattr(main.transcribe_job.app, "connection_for_write", lambda: UnavailableConnection())

    with pytest.raises(HTTPException) as error:
        main.dispatch_transcription("job-456")

    assert error.value.status_code == 503
    assert "Start Redis" in error.value.detail


def test_recover_stale_jobs_marks_abandoned_local_jobs_failed(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = TestingSession()
    asset = MediaAsset(
        original_filename="old.wav",
        storage_key="old.wav",
        size_bytes=1,
        duration_seconds=1,
    )
    session.add(asset)
    session.flush()
    job = TranscriptionJob(
        asset_id=asset.id,
        status="processing",
        stage="Transcribing audio",
        progress=35,
        model_size="large-v3",
        created_at=datetime.now(timezone.utc) - timedelta(hours=3),
    )
    session.add(job)
    session.commit()
    job_id = job.id
    session.close()

    monkeypatch.setattr(main, "SessionLocal", TestingSession)
    monkeypatch.setattr(main.settings, "job_timeout_seconds", 3600)
    assert main.recover_stale_jobs(redis_available=False) == 1

    session = TestingSession()
    recovered = session.get(TranscriptionJob, job_id)
    assert recovered.status == "failed"
    assert recovered.stage == "Processing interrupted"
    assert "Retry" in recovered.error
    session.close()
    Base.metadata.drop_all(bind=engine)


def test_align_endpoint_queues_supplied_lyrics(client, monkeypatch):
    test_client, testing_session = client
    session = testing_session()
    asset = MediaAsset(original_filename="song.wav", storage_key="song.wav", size_bytes=1, duration_seconds=10)
    session.add(asset)
    session.commit()
    asset_id = asset.id
    session.close()
    monkeypatch.setattr(main, "dispatch_transcription", lambda job_id: "local-development")

    response = test_client.post("/api/v1/jobs/align", json={
        "asset_id": asset_id,
        "lyrics_text": "[Verse]\nThe correct lyric line",
        "language": "en",
        "model_size": "small",
    })

    assert response.status_code == 202
    job = testing_session().get(TranscriptionJob, response.json()["job_id"])
    assert json.loads(job.transcript_json)["source_lyrics"] == "[Verse]\nThe correct lyric line"


def test_saved_project_audio_endpoint_streams_private_media(client, tmp_path, monkeypatch):
    monkeypatch.setattr(main.settings, "storage_path", tmp_path)
    media_path = tmp_path / "stored-audio.wav"
    media_path.write_bytes(b"audio-data")
    test_client, testing_session = client
    session = testing_session()
    asset = MediaAsset(original_filename="song.wav", storage_key=media_path.name, size_bytes=10, duration_seconds=1)
    session.add(asset)
    session.flush()
    project = Project(title="Saved song", asset_id=asset.id, transcript_json=json.dumps({"segments": []}))
    session.add(project)
    session.commit()
    project_id = project.id
    session.close()

    response = test_client.get(f"/api/v1/projects/{project_id}/audio")

    assert response.status_code == 200
    assert response.content == b"audio-data"
    assert response.headers["content-type"].startswith("audio/wav")


def test_video_export_renders_ordered_clips_and_remaps_subtitles(client, tmp_path, monkeypatch):
    monkeypatch.setattr(main.settings, "storage_path", tmp_path)
    monkeypatch.setattr(main.shutil, "which", lambda name: name)
    source_path = tmp_path / "source.mp4"
    source_path.write_bytes(b"source")
    command_holder = {}

    def fake_ffmpeg(command, **_):
        if command[0] == "ffprobe":
            return SimpleNamespace(stdout=json.dumps({"streams": [{"width": 640, "height": 360, "avg_frame_rate": "30/1"}]}))
        command_holder["command"] = command
        command_holder["filters"] = command[command.index("-filter_complex") + 1]
        (tmp_path / command[-1].split("\\")[-1]).write_bytes(b"rendered")

    monkeypatch.setattr(main.subprocess, "run", fake_ffmpeg)
    test_client, testing_session = client
    session = testing_session()
    asset = MediaAsset(
        original_filename="source.mp4",
        storage_key=source_path.name,
        size_bytes=6,
        duration_seconds=10,
    )
    session.add(asset)
    session.flush()
    project = Project(title="Karaoke cut", asset_id=asset.id, transcript_json=json.dumps({"segments": []}))
    session.add(project)
    session.commit()
    project_id = project.id
    session.close()

    response = test_client.post(f"/api/v1/projects/{project_id}/video-export", json={
        "clips": [
            {
                "start": 0,
                "end": 2,
                "timeline_start": 0,
                "effects": [
                    {"id": "blur-1", "type": "blur", "enabled": True, "intensity": 2},
                    {"id": "sepia-1", "type": "sepia", "enabled": True, "intensity": 0.4},
                    {"id": "vignette-disabled", "type": "vignette", "enabled": False, "intensity": 0.7},
                ],
                "keyframes": [
                    {"id": "opacity-a", "property": "opacity", "time": 0, "value": 0},
                    {"id": "opacity-b", "property": "opacity", "time": 2, "value": 1},
                    {"id": "brightness-a", "property": "brightness", "time": 0, "value": 0},
                    {"id": "brightness-b", "property": "brightness", "time": 2, "value": 0.3},
                    {"id": "scale-a", "property": "scale", "time": 0, "value": 1, "interpolation": "ease-in"},
                    {"id": "scale-b", "property": "scale", "time": 2, "value": 1.2},
                ],
                "transition_in": {"type": "fade-in", "duration": 0.25},
                "transition_out": {"type": "fade-out", "duration": 0.25},
                "transform": {"scale": 1.1, "x": 4, "y": -3, "rotation": 5},
            },
            {"start": 5, "end": 7, "timeline_start": 4},
        ],
        "subtitles": [{"start": 1, "end": 6, "text": "ចម្រៀង"}],
        "burn_subtitles": True,
        "font_size": 30,
    })

    assert response.status_code == 201
    result = response.json()
    assert result["duration_seconds"] == 6
    assert "overlay=x='(W-w)/2+4.000+(0.000000)':y='(H-h)/2+-3.000+(0.000000)':eval=frame" in command_holder["filters"]
    assert "adelay=delays=4000|4000" in command_holder["filters"]
    assert "anullsrc=channel_layout=stereo" in " ".join(command_holder["command"])
    assert "FontSize=30" in command_holder["filters"]
    assert "gblur=sigma=2.000000" in command_holder["filters"]
    assert "colorchannelmixer=" in command_holder["filters"]
    assert "vignette=angle=PI*0.700000" not in command_holder["filters"]
    assert command_holder["filters"].index("gblur=sigma=2.000000") < command_holder["filters"].index("colorchannelmixer=")
    assert "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*(if(lt(N/30.000000" in command_holder["filters"]
    assert "eq=brightness='if(lt(t,0.000000)" in command_holder["filters"]
    assert "pow((t-0.000000)/2.000000,2)" in command_holder["filters"]
    assert "scale=w='trunc(iw*((if(lt(t,0.000000)" in command_holder["filters"]
    assert "fade=t=in:st=0:d=0.250000:alpha=1" in command_holder["filters"]
    assert "fade=t=out:st=1.750000:d=0.250000:alpha=1" in command_holder["filters"]
    assert "rotate=angle=0.087266" in command_holder["filters"]
    assert "overlay=x='(W-w)/2+4.000+(0.000000)'" in command_holder["filters"]
    download = test_client.get(result["download_url"])
    assert download.status_code == 200
    assert download.content == b"rendered"

    legacy_response = test_client.post(f"/api/v1/projects/{project_id}/video-export", json={
        "clips": [{"start": 0, "end": 2}, {"start": 5, "end": 7}],
    })
    assert legacy_response.status_code == 201
    assert legacy_response.json()["duration_seconds"] == 4
    invalid_crossfade = test_client.post(f"/api/v1/projects/{project_id}/video-export", json={
        "clips": [
            {"start": 0, "end": 2, "timeline_start": 0, "transition_out": {"type": "cross-dissolve", "duration": 0.25}},
            {"start": 5, "end": 7, "timeline_start": 4},
        ],
    })
    assert invalid_crossfade.status_code == 422
    assert "adjacent" in invalid_crossfade.json()["detail"].lower()
    invalid_effect = test_client.post(f"/api/v1/projects/{project_id}/video-export", json={
        "clips": [{
            "start": 0,
            "end": 2,
            "effects": [{"id": "blur-1", "type": "blur", "enabled": True, "intensity": 21}],
        }],
    })
    assert invalid_effect.status_code == 422
    assert "20" in json.dumps(invalid_effect.json()["detail"])
    duplicate_effect_ids = test_client.post(f"/api/v1/projects/{project_id}/video-export", json={
        "clips": [{
            "start": 0,
            "end": 2,
            "effects": [
                {"id": "duplicate", "type": "blur", "enabled": True, "intensity": 2},
                {"id": "duplicate", "type": "sepia", "enabled": True, "intensity": 0.5},
            ],
        }],
    })
    assert duplicate_effect_ids.status_code == 422
    assert "unique" in duplicate_effect_ids.json()["detail"].lower()
    duplicate_keyframe_ids = test_client.post(f"/api/v1/projects/{project_id}/video-export", json={
        "clips": [
            {"start": 0, "end": 2, "keyframes": [{"id": "reused", "property": "opacity", "time": 0, "value": 1}]},
            {"start": 5, "end": 7, "keyframes": [{"id": "reused", "property": "opacity", "time": 5, "value": 1}]},
        ],
    })
    assert duplicate_keyframe_ids.status_code == 422
    assert "unique" in duplicate_keyframe_ids.json()["detail"].lower()


def test_video_subtitle_timestamp_remapping_clips_and_offsets():
    clips = [
        main.VideoClip(start=3, end=6, timeline_start=0),
        main.VideoClip(start=8, end=10, timeline_start=5),
    ]
    subtitles = [
        main.VideoSubtitle(start=1, end=4, text="before and clipped"),
        main.VideoSubtitle(start=5, end=9, text="split across cuts"),
        main.VideoSubtitle(start=10, end=11, text="after"),
    ]

    assert main.remap_video_subtitles(subtitles, clips) == [
        (0.0, 1.0, "before and clipped"),
        (2.0, 3.0, "split across cuts"),
        (5.0, 6.0, "split across cuts"),
    ]


def test_keyframe_interpolation_export_expressions_are_distinct_and_deterministic():
    def expression(interpolation):
        return main.keyframe_expression([
            main.VideoKeyframe(id="start", property="scale", time=0, value=1, interpolation=interpolation),
            main.VideoKeyframe(id="end", property="scale", time=2, value=3),
        ], 0, 1)

    assert "*( (t-0.000000)" not in expression("linear")
    assert "*((t-0.000000)/2.000000)" in expression("linear")
    assert "pow((t-0.000000)/2.000000,2)" in expression("ease-in")
    assert "1-pow(1-((t-0.000000)/2.000000),2)" in expression("ease-out")
    assert "if(lt((t-0.000000)/2.000000,0.5)" in expression("ease-in-out")
    assert "1.000000" in expression("hold")
    assert "pow(" not in expression("hold")


def test_video_export_renders_a_real_mp4_with_burned_subtitles(client, tmp_path, monkeypatch):
    ffmpeg = main.shutil.which("ffmpeg")
    if not ffmpeg:
        pytest.skip("FFmpeg is not installed.")
    monkeypatch.setattr(main.settings, "storage_path", tmp_path)
    source_path = tmp_path / "synthetic-source.mp4"
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=320x240:rate=25",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100",
            "-t",
            "2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(source_path),
        ],
        check=True,
        capture_output=True,
        timeout=60,
    )
    test_client, testing_session = client
    session = testing_session()
    asset = MediaAsset(
        original_filename=source_path.name,
        storage_key=source_path.name,
        size_bytes=source_path.stat().st_size,
        duration_seconds=2,
    )
    session.add(asset)
    session.flush()
    project = Project(title="FFmpeg integration", asset_id=asset.id)
    session.add(project)
    session.commit()
    project_id = project.id
    session.close()

    response = test_client.post(f"/api/v1/projects/{project_id}/video-export", json={
        "clips": [
            {
                "start": 0.25,
                "end": 0.5,
                "timeline_start": 0,
                "effects": [{"id": "blur-1", "type": "blur", "enabled": True, "intensity": 1.5}],
                "keyframes": [
                    {"id": "opacity-a", "property": "opacity", "time": 0.25, "value": 0.5},
                    {"id": "opacity-b", "property": "opacity", "time": 0.5, "value": 1},
                    {"id": "brightness-a", "property": "brightness", "time": 0.25, "value": 0},
                    {"id": "brightness-b", "property": "brightness", "time": 0.5, "value": 0.2},
                    {"id": "scale-a", "property": "scale", "time": 0.25, "value": 1},
                    {"id": "scale-b", "property": "scale", "time": 0.5, "value": 1.1},
                    {"id": "position-x-a", "property": "position_x", "time": 0.25, "value": 0},
                    {"id": "position-x-b", "property": "position_x", "time": 0.5, "value": 40},
                    {"id": "position-y-a", "property": "position_y", "time": 0.25, "value": 0},
                    {"id": "position-y-b", "property": "position_y", "time": 0.5, "value": 20},
                    {"id": "rotation-a", "property": "rotation", "time": 0.25, "value": 0},
                    {"id": "rotation-b", "property": "rotation", "time": 0.5, "value": 10},
                ],
                "transition_out": {"type": "cross-dissolve", "duration": 0.1},
                "transform": {"scale": 1.05, "x": 2, "y": 0, "rotation": 0},
            },
            {"start": 0.5, "end": 0.75, "timeline_start": 0.25},
            {"start": 1.0, "end": 1.5, "timeline_start": 1},
        ],
        "subtitles": [{"start": 0.4, "end": 0.9, "text": "ចម្រៀងខ្មែរ"}],
        "burn_subtitles": True,
    })

    assert response.status_code == 201, response.text
    assert response.json()["duration_seconds"] == 1.5
    download = test_client.get(response.json()["download_url"])
    assert download.status_code == 200
    assert download.headers["content-type"].startswith("video/mp4")
    assert len(download.content) > 1000
    rendered_path = tmp_path / f'{response.json()["export_id"]}.mp4'
    black_frame = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            "0.75",
            "-i",
            str(rendered_path),
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    assert black_frame.stdout
    assert sum(black_frame.stdout) / len(black_frame.stdout) < 5
    silent_audio = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-ss",
            "0.6",
            "-i",
            str(rendered_path),
            "-t",
            "0.3",
            "-af",
            "volumedetect",
            "-f",
            "null",
            os.devnull,
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    max_volume = next(line for line in silent_audio.stderr.splitlines() if "max_volume:" in line)
    assert "-inf dB" in max_volume or float(max_volume.split("max_volume:")[1].split("dB")[0]) < -75


def test_delete_project_removes_its_exports_and_unshared_media(client, tmp_path, monkeypatch):
    monkeypatch.setattr(main.settings, "storage_path", tmp_path)
    audio_path = tmp_path / "private-audio.wav"
    export_path = tmp_path / "project.srt"
    audio_path.write_bytes(b"audio")
    export_path.write_text("subtitle", encoding="utf-8")
    test_client, testing_session = client
    session = testing_session()
    asset = MediaAsset(original_filename="song.wav", storage_key=audio_path.name, size_bytes=5, duration_seconds=1)
    session.add(asset)
    session.flush()
    project = Project(title="Delete me", asset_id=asset.id, transcript_json=json.dumps({"segments": []}))
    session.add(project)
    session.flush()
    job = TranscriptionJob(asset_id=asset.id, status="failed", model_size="small")
    export = Export(project_id=project.id, format="srt", storage_key=export_path.name)
    session.add_all([job, export])
    session.commit()
    project_id, asset_id, job_id, export_id = project.id, asset.id, job.id, export.id
    session.close()

    response = test_client.delete(f"/api/v1/projects/{project_id}")

    assert response.status_code == 204
    assert not audio_path.exists()
    assert not export_path.exists()
    session = testing_session()
    assert session.get(Project, project_id) is None
    assert session.get(MediaAsset, asset_id) is None
    assert session.get(TranscriptionJob, job_id) is None
    assert session.get(Export, export_id) is None
    session.close()


def test_delete_project_keeps_media_used_by_another_saved_project(client, tmp_path, monkeypatch):
    monkeypatch.setattr(main.settings, "storage_path", tmp_path)
    audio_path = tmp_path / "shared-audio.wav"
    audio_path.write_bytes(b"audio")
    test_client, testing_session = client
    session = testing_session()
    asset = MediaAsset(original_filename="shared.wav", storage_key=audio_path.name, size_bytes=5, duration_seconds=1)
    session.add(asset)
    session.flush()
    first = Project(title="First", asset_id=asset.id)
    second = Project(title="Second", asset_id=asset.id)
    session.add_all([first, second])
    session.commit()
    first_id, second_id, asset_id = first.id, second.id, asset.id
    session.close()

    response = test_client.delete(f"/api/v1/projects/{first_id}")

    assert response.status_code == 204
    assert audio_path.is_file()
    session = testing_session()
    assert session.get(Project, first_id) is None
    assert session.get(Project, second_id) is not None
    assert session.get(MediaAsset, asset_id) is not None
    session.close()


def test_delete_project_rejects_active_job_without_deleting_workspace(client, tmp_path, monkeypatch):
    monkeypatch.setattr(main.settings, "storage_path", tmp_path)
    audio_path = tmp_path / "active-audio.wav"
    audio_path.write_bytes(b"audio")
    test_client, testing_session = client
    session = testing_session()
    asset = MediaAsset(original_filename="active.wav", storage_key=audio_path.name, size_bytes=5, duration_seconds=1)
    session.add(asset)
    session.flush()
    project = Project(title="Active", asset_id=asset.id)
    session.add(project)
    session.flush()
    session.add(TranscriptionJob(asset_id=asset.id, status="processing", model_size="small"))
    session.commit()
    project_id = project.id
    session.close()

    response = test_client.delete(f"/api/v1/projects/{project_id}")

    assert response.status_code == 409
    assert audio_path.is_file()
    session = testing_session()
    assert session.get(Project, project_id) is not None
    session.close()