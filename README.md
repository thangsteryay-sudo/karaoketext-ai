# KaraokeText AI

KaraokeText AI is a local-first song-to-subtitle workspace. The current milestone includes the upload UI, asynchronous transcription API/worker, transcript project storage, and real subtitle serializers. It does not claim that a transcript is accurate until a user reviews it.

## Current implementation

- Next.js App Router frontend with responsive upload workspace, local audio/video preview, language/model selection, upload/job progress polling, transcript editing, and subtitle export.
- FastAPI upload validation using FFprobe and a short FFmpeg decode; uploaded paths use generated UUID names and live outside the web root.
- Upload size has no application-level limit by default. Set `MAX_UPLOAD_SIZE_MB` to `0` for no app cap or a positive integer to enforce a per-file size limit; available server storage, reverse proxies, and hosting limits still apply.
- Video projects include an HTML5 preview and a Phase 1 timeline foundation: separate source and timeline time, draggable non-overlapping clips, frame-stepped edge trimming (with selectable timeline FPS), split, normal/ripple delete, undo/redo, a linked audio lane, a subtitle lane, and project-persisted edit decisions. Timeline gaps are preserved as black video with silence in MP4 exports; subtitle cues are clipped/remapped to each clip and can be burned into the output.
- The timeline uses memoized clip/audio/subtitle nodes and viewport-filtered subtitle and keyframe markers, a media-clock-driven `requestAnimationFrame` playhead transform, zoom-centered around the playhead, content-coordinate seeking, and adaptive ruler intervals. Audio time/readout/lyric highlighting update without rerendering the editor for every audio time event. Video scrubbing coalesces seeks to animation frames; trim gestures update clip geometry directly and retain keyframes/history once on completion. Clip and keyframe snapping uses an 8-pixel threshold, and native clip dragging preserves the grabbed point. The audio lane is a neutral clip block rather than a synthetic waveform; waveform generation remains unimplemented. These changes reduce repeated editor reconciliation but do not guarantee a particular frame rate or latency on every device.
- Video clip properties include a reference-oriented Basic/Effects/Transitions/Keyframes panel, an advanced Animation/Color/Transform section, and searchable effect and transition libraries. Only the implemented fade-in, fade-out, and adjacent-clip cross dissolve are offered as transitions. Transition duration is editable in the panel and committed as one undoable slider gesture; transition blocks remain attached to clip boundaries. Keyframes cover scale, position X/Y, rotation, opacity, and brightness, with linear, hold, ease-in, ease-out, and ease-in-out interpolation. Their values, source-media time, and interpolation can be edited; timeline diamonds support frame snapping, same-property key snapping, preview updates during a drag, cancellation, and a single undoable commit. A cross dissolve holds the outgoing clip's final frame during the blend. These values are stored on each timeline clip, included in project snapshots and undo/redo, evaluated in preview, and supported by the FFmpeg export path. Keyframe and effect timing uses source-media seconds, so split/trim preserves the visible animation/effect range.
- Celery/Redis background transcription using a cached faster-whisper model with explicit transcription settings and progress updates. The API publishes the supported language/model options; auto-detect, selected-language, and mixed-language best-effort modes are available. Khmer and other supported combining-mark scripts retain script-aware alignment units when supplied lyrics are matched to real model word timestamps. Results expose detected language, the model's uncalibrated language probability estimate, selected model, preprocessing, and whether word timestamps were emitted. Missing model dependencies or model failures result in a failed job, never fabricated lyrics.
- SQLite is the local API default; Docker Compose provisions PostgreSQL and Redis.
- Project CRUD and optimistic version checks, plus UTF-8 SRT, VTT, LRC, TXT, and JSON exports.
- Khmer Unicode preservation covered by serializer tests.

Not yet implemented: account authentication/ownership, migrations, S3 storage adapter, vocal separation, asynchronous video-render jobs/progress/cancellation, independent audio editing/mixing, multiple overlay tracks, wipe/zoom/blur transitions, custom Bezier easing, keyframed effect intensity, effect subtrack blocks, full color grading, configurable subtitle presets/word highlighting, and the complete requested AI evaluation set. Waveform/thumbnail caches and resizable panels are also not implemented. Cross-dissolve preview relies on the outgoing frame captured during playback; direct random-seeking into a dissolve is not guaranteed to reconstruct that frame yet. Timeline trimming and split positions are quantized to the selected FPS; FPS is currently a user-selected timeline setting rather than automatically probed from each source. Subtitle burn-in currently supports a basic font-size setting, not the full styling panel. Word timestamps come from faster-whisper when emitted by the selected model; they are not guaranteed. Mixed-language mode disables a forced language hint; detection remains recording-level and does not identify language per segment. Transcription and singing recognition quality have not been benchmarked because no authorized reference recordings and ground-truth lyrics are available. Alignment is line-level, and unmatched lyrics intentionally receive no invented timestamps. No vocal isolation or denoising is performed. Do not deploy this milestone as a multi-user service until authorization and rate limiting are added.

Video export uses the `POST /api/v1/projects/{project_id}/video-export` endpoint with `clips` (`start`/`end` in source seconds and optional `timeline_start` in edited-timeline seconds), subtitle cues, and optional `burn_subtitles`/`font_size` settings. If `timeline_start` is omitted, clips are placed sequentially for compatibility; explicit timeline positions preserve gaps. The endpoint returns an export download URL only after FFmpeg successfully creates the MP4. FFmpeg and FFprobe must be installed on the API host, including H.264/AAC encoders; subtitle burn-in additionally requires FFmpeg's `subtitles` filter (libass). The API currently renders synchronously and may hold the request open for long videos. Although the application-level upload cap is disabled by default, web servers/reverse proxies and available disk capacity can still limit large uploads.

## Local development

Prerequisites: Node.js 22, Python 3.11 recommended for the inference worker, FFmpeg/FFprobe, and Redis. Copy `.env.example` to `.env` and set values appropriate for your machine.

Frontend:

```powershell
cd apps/web
npm.cmd install
$env:NEXT_PUBLIC_API_BASE_URL = "http://localhost:8000"
npm.cmd run dev
```

API (from the repository root, after configuring Python and installing the pinned requirements):

```powershell
.venv\Scripts\python.exe -m pip install -r services/api/requirements.txt
$env:PYTHONPATH = "services/api"
.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir services/api --reload --port 8000
```

Start a Redis server, then run a worker in another terminal:

```powershell
$env:PYTHONPATH = "services/api"
.venv\Scripts\celery.exe -A app.worker.celery worker --loglevel=INFO --concurrency=1
```

API docs are available at `/docs`. Configure faster-whisper model size, device, and compute type through environment values. First model use may download model weights. CPU inference can be slow; `small` with int8 is the development default. CUDA/GPU deployment is not validated here.

## Docker Compose

Docker is not installed/available in the checked development environment, so this configuration has not been run. From the repository root, after setting a non-default `POSTGRES_PASSWORD` in `.env`, use:

```powershell
docker compose -f infrastructure/docker-compose.yml up --build
```

The stack contains web, API, Celery worker, Redis, and PostgreSQL. CPU-only inference is configured with one worker process. GPU passthrough and model cache volumes need to be configured for a target host before GPU deployment. Do not use the example password in production.

## Free frontend demo on GitHub Pages

GitHub Pages can host a static frontend demo, but it cannot run the FastAPI API, Celery worker, Redis, Whisper transcription, project storage, or server-side video exports. Those features remain unavailable until a separate API and worker are deployed. Do not upload private audio to a public demo without first configuring and securing that backend.

To publish the frontend demo:

1. Push this repository to GitHub.
2. In the repository, open **Settings → Pages** and set the build and deployment source to **GitHub Actions**.
3. Push to the `main` or `master` branch, or manually run the **Deploy GitHub Pages** workflow from the **Actions** tab.
4. Open the Pages URL shown in the workflow deployment.

The workflow builds a static export and automatically applies the repository path for project Pages sites. For an owner site named `<owner>.github.io`, it deploys at the root path. The page labels itself as a frontend-only demo so visitors know the backend-powered features are not connected.

## Tests

```powershell
$env:PYTHONPATH = "services/api"
.venv\Scripts\python.exe -m pytest services/api/tests -q
cd apps/web
npm.cmd run build
```

Tests currently cover export format correctness, Unicode preservation, timestamp validation, overlap handling, project version conflicts, API health, export download, project persistence for clip effects/keyframes/transforms, deterministic keyframe easing expressions, duplicate keyframe IDs, and FFmpeg video rendering including animated transforms and transitions. No end-to-end model inference test is included because it would require downloading model weights and licensed test recordings.

## Privacy and language limits

Uploads are stored locally under opaque random identifiers. The API currently has no user authentication, so expose it only on a trusted local network. Configure retention and deletion before production. Transcription support is determined by the installed Whisper model; singing, music accompaniment, rapid lyrics, and Khmer word boundaries can reduce accuracy. Khmer line transcription is not a guarantee of exact word segmentation. A human review is required before publishing.
