"use client";

import { ChangeEvent, DragEvent, Fragment, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  Check,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  Clock3,
  Diamond,
  FileAudio2,
  FileText,
  Film,
  FolderOpen,
  Headphones,
  Languages,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  Undo2,
  Video as VideoIcon,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react";

type UploadResult = { asset_id: string; filename?: string; duration_seconds?: number; sample_rate?: number };
type LanguageOption = { code: string; name: string; script: string };
type TranscriptionCapabilities = {
  languages: LanguageOption[];
  models: Array<{ id: string; name: string; tradeoff: string }>;
  alignment_granularity: "line";
  mixed_language_detection: string;
};
type JobResult = {
  id?: string;
  job_id?: string;
  status: string;
  stage?: string;
  progress?: number;
  elapsed_seconds?: number;
  model_size?: string;
  mode?: "auto" | "selected" | "multilingual";
  error?: string;
  transcript?: {
    language?: string;
    language_probability?: number;
    language_mode?: "auto" | "selected" | "multilingual";
    requested_language?: string;
    model_size?: string;
    audio_preprocessing?: string;
    alignment_method?: string | null;
    word_timestamps_available?: boolean;
    source_lyrics?: string;
    segments?: Array<{ start: number; end: number; text: string; status?: string; words?: Array<{ text: string; start: number; end: number; status: string }>; alignment?: { matched_units?: number; total_units?: number; unit?: "words" | "characters"; matched_words?: number; total_words?: number } }>;
    diagnostics?: { source_lines: number; aligned_lines: number; unmatched_lines: string[]; match_ratio: number; matched_units?: number; source_units?: number };
    media_kind?: "audio" | "video";
    editor?: EditorSnapshot;
  };
};
type EffectType = "blur" | "brightness" | "contrast" | "saturation" | "grayscale" | "sepia" | "vignette";
type Effect = { id: string; type: EffectType; enabled: boolean; intensity: number; name?: string };
type EffectCategory = "Color & Light" | "Blur & Focus" | "Cinematic Looks";
type EffectDefinition = {
  name: string;
  category: EffectCategory;
  description: string;
  defaultIntensity: number;
  min: number;
  max: number;
  step: number;
  previewRenderer: "css-filter" | "css-overlay";
  exportRenderer: "ffmpeg-filter";
  performance: "low" | "moderate";
  allowMultiple: boolean;
};
const EFFECT_REGISTRY: Record<EffectType, EffectDefinition> = {
  blur: {
    name: "Gaussian Blur",
    category: "Blur & Focus",
    description: "Soften clip details with an adjustable Gaussian blur.",
    defaultIntensity: 6,
    min: 0,
    max: 20,
    step: 0.1,
    previewRenderer: "css-filter",
    exportRenderer: "ffmpeg-filter",
    performance: "moderate",
    allowMultiple: true,
  },
  brightness: {
    name: "Brightness",
    category: "Color & Light",
    description: "Lift or lower exposure across the clip.",
    defaultIntensity: 0.1,
    min: -1,
    max: 1,
    step: 0.01,
    previewRenderer: "css-filter",
    exportRenderer: "ffmpeg-filter",
    performance: "low",
    allowMultiple: true,
  },
  contrast: {
    name: "Contrast",
    category: "Color & Light",
    description: "Increase or soften tonal contrast.",
    defaultIntensity: 1.15,
    min: 0,
    max: 2,
    step: 0.01,
    previewRenderer: "css-filter",
    exportRenderer: "ffmpeg-filter",
    performance: "low",
    allowMultiple: true,
  },
  saturation: {
    name: "Saturation",
    category: "Color & Light",
    description: "Adjust color intensity.",
    defaultIntensity: 1.2,
    min: 0,
    max: 2,
    step: 0.01,
    previewRenderer: "css-filter",
    exportRenderer: "ffmpeg-filter",
    performance: "low",
    allowMultiple: true,
  },
  grayscale: {
    name: "Black & White",
    category: "Cinematic Looks",
    description: "Remove color from the selected clip.",
    defaultIntensity: 1,
    min: 0,
    max: 1,
    step: 0.01,
    previewRenderer: "css-filter",
    exportRenderer: "ffmpeg-filter",
    performance: "low",
    allowMultiple: true,
  },
  sepia: {
    name: "Sepia",
    category: "Cinematic Looks",
    description: "Apply a warm vintage color tone.",
    defaultIntensity: 0.65,
    min: 0,
    max: 1,
    step: 0.01,
    previewRenderer: "css-filter",
    exportRenderer: "ffmpeg-filter",
    performance: "low",
    allowMultiple: true,
  },
  vignette: {
    name: "Vignette",
    category: "Cinematic Looks",
    description: "Darken the frame edges for a focused look.",
    defaultIntensity: 0.35,
    min: 0,
    max: 1,
    step: 0.01,
    previewRenderer: "css-overlay",
    exportRenderer: "ffmpeg-filter",
    performance: "moderate",
    allowMultiple: true,
  },
};
type AnimatedProperty = "opacity" | "brightness" | "scale" | "position_x" | "position_y" | "rotation";
type KeyframeInterpolation = "linear" | "hold" | "ease-in" | "ease-out" | "ease-in-out";
type Keyframe = { id: string; property: AnimatedProperty; time: number; value: number; interpolation: KeyframeInterpolation };
type ClipTransition = { type: "fade-in" | "fade-out" | "cross-dissolve"; duration: number };
type ClipTransform = { scale: number; x: number; y: number; rotation: number };
type EffectSliderGesture = {
  clipId: string;
  effectId: string;
  original: number;
  latest: number;
};
type KeyframeDrag = {
  clipId: string;
  keyframeId: string;
  pointerId: number;
  pointerStartX: number;
  initialTime: number;
  latestTime: number;
};
type TransitionDurationGesture = {
  clipId: string;
  edge: "transitionIn" | "transitionOut";
  initialClips: VideoClip[];
  latestClips: VideoClip[];
};
type VideoClip = {
  id: string;
  start: number;
  end: number;
  timelineStart: number;
  effects?: Effect[];
  keyframes?: Keyframe[];
  transitionIn?: ClipTransition;
  transitionOut?: ClipTransition;
  transform?: ClipTransform;
};
type EditorSnapshot = { duration?: number; clips?: VideoClip[]; burn_subtitles?: boolean; font_size?: number; frame_rate?: number; timeline_zoom?: number };
type ClipTrimDrag = {
  clipId: string;
  edge: "start" | "end";
  pointerId: number;
  pointerStartX: number;
  initialClip: VideoClip;
  initialClips: VideoClip[];
  latestClips: VideoClip[];
};
type SavedProject = {
  id: string;
  version: number;
  title: string;
  asset_id?: string | null;
  transcript?: JobResult["transcript"];
};

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const isStaticDemo = process.env.NEXT_PUBLIC_STATIC_DEMO === "true";
const supportedFormats = ".mp3,.wav,.wave,.ogg,.oga,.flac,.m4a,.aac,.mp4,.mov,.webm,.mkv,.avi";

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function formatElapsed(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs.toString().padStart(2, "0")}s elapsed` : `${secs}s elapsed`;
}

function mediaKindForFile(file: File | null) {
  if (!file) return undefined;
  return file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name) ? "video" : "audio";
}

function boundedEffectIntensity(type: EffectType, value: number) {
  const definition = EFFECT_REGISTRY[type];
  return Math.max(definition.min, Math.min(definition.max, value));
}

function timelineTimeToPixel(projectTime: number, pixelsPerSecond: number) {
  return projectTime * pixelsPerSecond;
}

function timelinePixelToTime(clientX: number, contentLeft: number, pixelsPerSecond: number) {
  return (clientX - contentLeft) / pixelsPerSecond;
}

function normalizeTimelineClips(clips: VideoClip[]): VideoClip[] {
  let nextStart = 0;
  return clips.map((clip) => {
    const timelineStart = Number.isFinite(clip.timelineStart) ? clip.timelineStart : nextStart;
    nextStart = timelineStart + clip.end - clip.start;
    return { ...clip, timelineStart };
  });
}

function findActiveSubtitle<T extends { start: number; end: number }>(segments: T[], time: number): T | undefined {
  const index = findActiveSubtitleIndex(segments, time);
  return index < 0 ? undefined : segments[index];
}

function findActiveSubtitleIndex<T extends { start: number; end: number }>(segments: T[], time: number): number {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const segment = segments[middle];
    if (time < segment.start) high = middle - 1;
    else if (time > segment.end) low = middle + 1;
    else return middle;
  }
  return -1;
}

function getAnimatedValue(clip: VideoClip, property: AnimatedProperty, sourceTime: number, fallback: number) {
  const keyframes = (clip.keyframes ?? []).filter((keyframe) => keyframe.property === property).sort((a, b) => a.time - b.time);
  if (!keyframes.length) return fallback;
  const previous = [...keyframes].reverse().find((keyframe) => keyframe.time <= sourceTime);
  const next = keyframes.find((keyframe) => keyframe.time > sourceTime);
  if (!previous) return keyframes[0].value;
  if (!next) return previous.value;
  const rawProgress = (sourceTime - previous.time) / (next.time - previous.time);
  const progress = previous.interpolation === "hold" ? 0
    : previous.interpolation === "ease-in" ? rawProgress * rawProgress
      : previous.interpolation === "ease-out" ? 1 - (1 - rawProgress) ** 2
        : previous.interpolation === "ease-in-out"
          ? rawProgress < 0.5 ? 2 * rawProgress * rawProgress : 1 - (-2 * rawProgress + 2) ** 2 / 2
          : rawProgress;
  return previous.value + (next.value - previous.value) * progress;
}

function retainClipRangeData(clip: VideoClip, start: number, end: number): VideoClip {
  const keyframes = (clip.keyframes ?? []).flatMap((keyframe) =>
    keyframe.time >= start && keyframe.time <= end ? [{ ...keyframe }] : []
  );
  for (const property of ["opacity", "brightness", "scale", "position_x", "position_y", "rotation"] as const) {
    const propertyKeyframes = (clip.keyframes ?? []).filter((keyframe) => keyframe.property === property);
    if (!propertyKeyframes.length) continue;
    for (const time of [start, end]) {
      if (propertyKeyframes.some((keyframe) => Math.abs(keyframe.time - time) < 0.0001)) continue;
      keyframes.push({
        id: crypto.randomUUID(),
        property,
        time,
        value: getAnimatedValue(
          clip,
          property,
          time,
          property === "brightness" || property === "position_x" || property === "position_y" || property === "rotation" ? 0 : 1,
        ),
        interpolation: "linear",
      });
    }
  }
  const duration = end - start;
  const lostStart = Math.max(0, start - clip.start);
  const lostEnd = Math.max(0, clip.end - end);
  const transitionInDuration = Math.min(duration / 2, Math.max(0, (clip.transitionIn?.duration ?? 0) - lostStart));
  const transitionOutDuration = Math.min(duration / 2, Math.max(0, (clip.transitionOut?.duration ?? 0) - lostEnd));
  return {
    ...clip,
    start,
    end,
    keyframes: keyframes.sort((a, b) => a.time - b.time),
    transitionIn: transitionInDuration && clip.transitionIn
      ? { ...clip.transitionIn, duration: transitionInDuration }
      : undefined,
    transitionOut: transitionOutDuration && clip.transitionOut
      ? { ...clip.transitionOut, duration: transitionOutDuration }
      : undefined,
  };
}

function normalizeCrossDissolves(clips: VideoClip[]): VideoClip[] {
  const ordered = [...clips].sort((a, b) => a.timelineStart - b.timelineStart);
  return clips.map((clip) => {
    if (clip.transitionOut?.type !== "cross-dissolve") return clip;
    const index = ordered.findIndex((item) => item.id === clip.id);
    const next = ordered[index + 1];
    const duration = next ? Math.min(
      clip.transitionOut.duration,
      (clip.end - clip.start) / 2,
      (next.end - next.start) / 2,
    ) : 0;
    const adjacent = next && Math.abs(next.timelineStart - (clip.timelineStart + clip.end - clip.start)) <= 0.03;
    return adjacent && duration > 0
      ? { ...clip, transitionOut: { ...clip.transitionOut, duration } }
      : { ...clip, transitionOut: undefined };
  });
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const lyricsInputRef = useRef<HTMLInputElement>(null);
  const exportSelectRef = useRef<HTMLSelectElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const transitionCanvasRef = useRef<HTMLCanvasElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const videoPreviewTimeRef = useRef<HTMLSpanElement>(null);
  const audioPreviewTimeRef = useRef<HTMLSpanElement>(null);
  const audioSeekRangeRef = useRef<HTMLInputElement>(null);
  const playheadRangeRef = useRef<HTMLInputElement>(null);
  const playheadOutputRef = useRef<HTMLOutputElement>(null);
  const videoLyricOverlayRef = useRef<HTMLDivElement>(null);
  const lyricsListRef = useRef<HTMLDivElement>(null);
  const activeLyricRowIndexRef = useRef(-1);
  const activeClipIdRef = useRef("");
  const currentTimeRef = useRef(0);
  const playheadInGapRef = useRef(false);
  const snapEnabledRef = useRef(true);
  const clipHistoryRef = useRef<{ past: VideoClip[][]; future: VideoClip[][] }>({ past: [], future: [] });
  const clipTrimDragRef = useRef<ClipTrimDrag | null>(null);
  const nativeClipDragOffsetRef = useRef(0);
  const effectSliderGestureRef = useRef<EffectSliderGesture | null>(null);
  const keyframeDragRef = useRef<KeyframeDrag | null>(null);
  const keyframePreviewClipRef = useRef<VideoClip | null>(null);
  const transitionDurationGestureRef = useRef<TransitionDurationGesture | null>(null);
  const recentEffectAdditionRef = useRef<{ type: EffectType; timestamp: number } | null>(null);
  const videoPreviewRefreshRef = useRef<(sourceTime: number) => void>(() => {});
  const [effectClipboard, setEffectClipboard] = useState<Effect[]>([]);
  const [draggedEffectId, setDraggedEffectId] = useState("");
  const timelineScrollFrameRef = useRef(0);
  const rulerScrubPointerRef = useRef<number | null>(null);
  const playheadScrubbingPointerRef = useRef<number | null>(null);
  const pendingVideoSeekRef = useRef<number | null>(null);
  const videoSeekFrameRef = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [language, setLanguage] = useState("");
  const [transcriptionMode, setTranscriptionMode] = useState<"auto" | "selected" | "multilingual">("auto");
  const [transcriptionCapabilities, setTranscriptionCapabilities] = useState<TranscriptionCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState("");
  const [model, setModel] = useState("small");
  const [job, setJob] = useState<JobResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState<string>();
  const [project, setProject] = useState<SavedProject | null>(null);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<SavedProject | null>(null);
  const [editedSegments, setEditedSegments] = useState<Array<{ start: number; end: number; text: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(isStaticDemo ? false : null);
  const [lyricsText, setLyricsText] = useState("");
  const [workflowStep, setWorkflowStep] = useState(1);
  const [completedStep, setCompletedStep] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState("");
  const [burnSubtitles, setBurnSubtitles] = useState(false);
  const [fontSize, setFontSize] = useState(24);
  const [previewAspectRatio, setPreviewAspectRatio] = useState("16:9");
  const [videoExporting, setVideoExporting] = useState(false);
  const [videoExportMessage, setVideoExportMessage] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [timelineZoom, setTimelineZoom] = useState(80);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [playheadInGap, setPlayheadInGap] = useState(false);
  const [frameRate, setFrameRate] = useState(30);
  const [propertyTab, setPropertyTab] = useState<"Basic" | "Effects" | "Transitions" | "Animation" | "Keyframes" | "Color" | "Transform">("Basic");
  const [selectedEffectId, setSelectedEffectId] = useState("");
  const [effectLibraryOpen, setEffectLibraryOpen] = useState(false);
  const [effectSearch, setEffectSearch] = useState("");
  const [effectCategory, setEffectCategory] = useState<"All" | EffectCategory>("All");
  const [transitionSearch, setTransitionSearch] = useState("");
  const [selectedKeyframeId, setSelectedKeyframeId] = useState("");
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const timelineDuration = Math.max(videoDuration, ...clips.map((clip) => clip.timelineStart + clip.end - clip.start), 0);
  const [timelineViewport, setTimelineViewport] = useState({ left: 0, width: 900 });
  const transcript = useMemo(() => job?.transcript?.segments ?? [], [job?.transcript?.segments]);

  const updatePlayheadInGap = useCallback((isGap: boolean) => {
    if (playheadInGapRef.current === isGap) return;
    playheadInGapRef.current = isGap;
    setPlayheadInGap(isGap);
  }, []);

  const updateActiveLyricRow = useCallback((index: number) => {
    if (activeLyricRowIndexRef.current === index) return;
    lyricsListRef.current?.querySelector(".lyric-row.lyric-active")?.classList.remove("lyric-active");
    if (index >= 0) {
      lyricsListRef.current
        ?.querySelector(`[data-lyric-index="${index}"]`)
        ?.classList.add("lyric-active");
    }
    activeLyricRowIndexRef.current = index;
  }, []);

  const queueVideoSeek = useCallback((sourceTime: number) => {
    pendingVideoSeekRef.current = sourceTime;
    if (videoSeekFrameRef.current) return;
    videoSeekFrameRef.current = window.requestAnimationFrame(() => {
      videoSeekFrameRef.current = 0;
      const video = videoRef.current;
      const latestTime = pendingVideoSeekRef.current;
      pendingVideoSeekRef.current = null;
      if (video && latestTime !== null && Math.abs(video.currentTime - latestTime) > 0.001) {
        video.currentTime = latestTime;
      }
    });
  }, []);

  useEffect(() => () => {
    if (videoSeekFrameRef.current) window.cancelAnimationFrame(videoSeekFrameRef.current);
    if (timelineScrollFrameRef.current) window.cancelAnimationFrame(timelineScrollFrameRef.current);
  }, []);

  useEffect(() => {
    snapEnabledRef.current = snapEnabled;
  }, [snapEnabled]);

  useEffect(() => {
    let active = true;
    if (isStaticDemo) {
      return () => {
        active = false;
      };
    }
    const checkApi = async () => {
      try {
        const response = await fetch(`${apiBase}/health`, { cache: "no-store" });
        if (active) setApiAvailable(response.ok);
      } catch {
        if (active) setApiAvailable(false);
      }
    };
    void checkApi();
    void fetch(`${apiBase}/api/v1/transcription/capabilities`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        return response.json() as Promise<TranscriptionCapabilities>;
      })
      .then((capabilities) => {
        if (!active) return;
        setTranscriptionCapabilities(capabilities);
        setCapabilityError("");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setCapabilityError(reason instanceof Error ? reason.message : "Could not load transcription capabilities.");
      });
    void refreshProjects();
    const interval = window.setInterval(checkApi, 15000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  async function refreshProjects() {
    try {
      const response = await fetch(`${apiBase}/api/v1/projects`, { cache: "no-store" });
      if (response.ok) setProjects((await response.json()) as SavedProject[]);
    } catch {
      // The API health indicator reports connection availability separately.
    }
  }

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const updateTime = () => {
      currentTimeRef.current = audio.currentTime;
      if (audioPreviewTimeRef.current) {
        audioPreviewTimeRef.current.textContent = `${formatTime(audio.currentTime)}${audio.duration ? ` / ${formatTime(audio.duration)}` : ""}`;
      }
      if (audioSeekRangeRef.current) {
        audioSeekRangeRef.current.max = String(Number.isFinite(audio.duration) ? audio.duration : 100);
        audioSeekRangeRef.current.value = String(audio.currentTime);
      }
      updateActiveLyricRow(findActiveSubtitleIndex(editedSegments.length ? editedSegments : transcript, audio.currentTime));
    };
    const updateDuration = () => {
      if (audioPreviewTimeRef.current) {
        audioPreviewTimeRef.current.textContent = `${formatTime(audio.currentTime)}${audio.duration ? ` / ${formatTime(audio.duration)}` : ""}`;
      }
      if (audioSeekRangeRef.current) {
        audioSeekRangeRef.current.max = String(Number.isFinite(audio.duration) ? audio.duration : 100);
      }
    };
    const updatePlay = () => setIsPlaying(!audio.paused);
    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("durationchange", updateDuration);
    audio.addEventListener("seeked", updateTime);
    audio.addEventListener("play", updatePlay);
    audio.addEventListener("pause", updatePlay);
    updateDuration();
    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", updateDuration);
      audio.removeEventListener("durationchange", updateDuration);
      audio.removeEventListener("seeked", updateTime);
      audio.removeEventListener("play", updatePlay);
      audio.removeEventListener("pause", updatePlay);
    };
  }, [editedSegments, file, audioUrl, transcript, updateActiveLyricRow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveEdits();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoClips();
        else undoClips();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoClips();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedClipId) {
        event.preventDefault();
        removeSelectedClip();
      } else if (event.key.toLowerCase() === "s" && !event.ctrlKey && !event.metaKey && selectedClipId) {
        event.preventDefault();
        splitSelectedClip();
      } else if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setTimelineZoom((zoom) => Math.min(240, zoom * 1.25));
      } else if (event.key === "-") {
        event.preventDefault();
        setTimelineZoom((zoom) => Math.max(0.01, zoom / 1.25));
      } else if (event.key === "Home") {
        event.preventDefault();
        seekTimeline(0);
      } else if (event.key === "End") {
        event.preventDefault();
        seekTimeline(timelineDuration);
      } else if (event.key === "ArrowLeft" && videoRef.current && event.shiftKey) {
        event.preventDefault();
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 1 / frameRate);
      } else if (event.key === "ArrowRight" && videoRef.current && event.shiftKey) {
        event.preventDefault();
        videoRef.current.currentTime = Math.min(videoDuration, videoRef.current.currentTime + 1 / frameRate);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function chooseFile(nextFile?: File) {
    if (!nextFile) return;
    const extension = `.${nextFile.name.split(".").pop()?.toLowerCase() ?? ""}`;
    if (!supportedFormats.split(",").includes(extension)) {
      setError("Unsupported format. Choose MP3, WAV, OGG, FLAC, M4A, AAC, MP4, MOV, WebM, MKV, or AVI.");
      return;
    }
    setError("");
    if (videoRef.current) {
      videoRef.current.style.filter = "";
      videoRef.current.style.opacity = "";
      videoRef.current.style.transform = "";
      videoRef.current.style.boxShadow = "";
    }
    if (transitionCanvasRef.current) {
      transitionCanvasRef.current.style.display = "none";
      delete transitionCanvasRef.current.dataset.nextClipId;
    }
    setJob(null);
    setProject(null);
    setEditedSegments([]);
    setVideoDuration(0);
    setFrameRate(30);
    setClips([]);
    setSelectedClipId("");
    clipHistoryRef.current = { past: [], future: [] };
    setHistoryVersion((version) => version + 1);
    setVideoExportMessage("");
    setWorkflowStep(1);
    setCompletedStep(0);
    setAudioUrl(URL.createObjectURL(nextFile));
    setFile(nextFile);
  }

  async function createDraftProject(assetId: string, title: string) {
    const response = await fetch(`${apiBase}/api/v1/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        asset_id: assetId,
        transcript: {
          segments: [],
          source_lyrics: lyricsText,
          language,
          media_kind: mediaKindForFile(file),
          editor: currentEditorSnapshot(),
        },
      }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const created = (await response.json()) as SavedProject;
    setProject(created);
    setProjects((previous) => [created, ...previous.filter((item) => item.id !== created.id)]);
    return created;
  }

  async function persistProjectSnapshot(current: SavedProject) {
    const transcript = {
      ...current.transcript,
      ...job?.transcript,
      segments: editedSegments.length ? editedSegments : current.transcript?.segments ?? [],
      source_lyrics: lyricsText || current.transcript?.source_lyrics,
      language,
      media_kind: current.transcript?.media_kind ?? mediaKindForFile(file),
      editor: currentEditorSnapshot(),
    };
    const response = await fetch(`${apiBase}/api/v1/projects/${current.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: current.version, transcript }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const updated = (await response.json()) as SavedProject;
    setProject(updated);
    setProjects((previous) => [updated, ...previous.filter((item) => item.id !== updated.id)]);
    return updated;
  }

  async function persistCurrentWorkspace() {
    if (project) return persistProjectSnapshot(project);
    if (!file) return null;

    const uploadBody = new FormData();
    uploadBody.append("file", file);
    const uploadResponse = await fetch(`${apiBase}/api/v1/uploads`, { method: "POST", body: uploadBody });
    if (!uploadResponse.ok) throw new Error(await responseError(uploadResponse));
    const uploaded = (await uploadResponse.json()) as UploadResult;
    return createDraftProject(uploaded.asset_id, file.name.replace(/\.[^.]+$/, "") || "Untitled song");
  }

  function resetWorkspace() {
    setFile(null);
    setAudioUrl(undefined);
    setJob(null);
    setProject(null);
    setEditedSegments([]);
    setLyricsText("");
    setError("");
    setCurrentTime(0);
    currentTimeRef.current = 0;
    setWorkflowStep(1);
    setCompletedStep(0);
    setVideoDuration(0);
    setFrameRate(30);
    setClips([]);
    setSelectedClipId("");
    activeClipIdRef.current = "";
    clipHistoryRef.current = { past: [], future: [] };
    setHistoryVersion((version) => version + 1);
    setVideoExportMessage("");
  }

  async function startNewWorkspace() {
    if (busy || saving) return;
    setSaving(true);
    setError("");
    try {
      await persistCurrentWorkspace();
      await refreshProjects();
      resetWorkspace();
      document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the current workspace.");
    } finally {
      setSaving(false);
    }
  }

  async function openSavedProject(projectId: string) {
    if (busy || saving || project?.id === projectId) return;
    setSaving(true);
    setError("");
    try {
      await persistCurrentWorkspace();
      const response = await fetch(`${apiBase}/api/v1/projects/${projectId}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      const saved = (await response.json()) as SavedProject;
      const segments = saved.transcript?.segments ?? [];
      setProject(saved);
      setProjects((previous) => [saved, ...previous.filter((item) => item.id !== saved.id)]);
      setFile(null);
      setAudioUrl(saved.asset_id ? `${apiBase}/api/v1/projects/${saved.id}/audio` : undefined);
      setLyricsText(String(saved.transcript?.source_lyrics ?? ""));
      setEditedSegments(segments);
      setVideoDuration(saved.transcript?.editor?.duration ?? 0);
      setFrameRate(saved.transcript?.editor?.frame_rate ?? 30);
      setTimelineZoom(saved.transcript?.editor?.timeline_zoom ?? 80);
      const savedClips = normalizeTimelineClips(saved.transcript?.editor?.clips ?? []);
      setClips(savedClips);
      setSelectedClipId(savedClips[0]?.id ?? "");
      activeClipIdRef.current = savedClips[0]?.id ?? "";
      clipHistoryRef.current = { past: [], future: [] };
      setHistoryVersion((version) => version + 1);
      setBurnSubtitles(saved.transcript?.editor?.burn_subtitles ?? false);
      setFontSize(saved.transcript?.editor?.font_size ?? 24);
      setJob(segments.length ? { status: "ready_for_review", stage: "Ready for review", progress: 100, transcript: saved.transcript } : null);
      setCompletedStep(segments.length ? 3 : saved.asset_id ? 1 : 0);
      setWorkflowStep(segments.length ? 3 : saved.asset_id ? 2 : 1);
      setCurrentTime(0);
      currentTimeRef.current = 0;
      document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open the saved workspace.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSavedProject(saved: SavedProject) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/v1/projects/${saved.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response));
      setProjects((previous) => previous.filter((item) => item.id !== saved.id));
      if (project?.id === saved.id) resetWorkspace();
      setDeleteTarget(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete the saved workspace.");
    } finally {
      setSaving(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  async function startTranscription() {
    if (!file && !project?.asset_id) return;
    if (transcriptionMode === "selected" && !language) {
      setError("Choose an expected language before starting selected-language transcription.");
      return;
    }
    setBusy(true);
    setError("");
    setEditedSegments([]);
    setCompletedStep(0);
    setJob({ status: "uploading", stage: "Uploading media", progress: 5 });
    setWorkflowStep(1);
    try {
      let assetId = project?.asset_id ?? undefined;
      let projectId = project?.id;
      if (!assetId && file) {
        const body = new FormData();
        body.append("file", file);
        const uploadResponse = await fetch(`${apiBase}/api/v1/uploads`, { method: "POST", body });
        if (!uploadResponse.ok) throw new Error(await responseError(uploadResponse));
        const uploaded = (await uploadResponse.json()) as UploadResult;
        assetId = uploaded.asset_id;
        const draft = await createDraftProject(assetId, file.name.replace(/\.[^.]+$/, "") || "Untitled song");
        projectId = draft.id;
      }
      if (!assetId) throw new Error("Choose or open a project with an audio file first.");
      setCompletedStep(1);
      setWorkflowStep(2);
      setJob({ status: "queued", stage: "Preparing transcription", progress: 8 });
      const jobResponse = await fetch(`${apiBase}/api/v1/jobs/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_id: assetId,
          language: transcriptionMode === "selected" ? language : transcriptionMode === "multilingual" ? "multi" : "auto",
          mode: transcriptionMode,
          model_size: model,
        }),
      });
      if (!jobResponse.ok) throw new Error(await responseError(jobResponse));
      const created = (await jobResponse.json()) as JobResult;
      const jobId = created.job_id ?? created.id;
      if (!jobId) throw new Error("The API created a job without returning its identifier.");
      setJob({ ...created, id: jobId });
      await pollJob(jobId, assetId, projectId);
    } catch (reason) {
      const message = reason instanceof TypeError
        ? `Cannot reach the KaraokeText API at ${apiBase}. Start the FastAPI backend and retry.`
        : reason instanceof Error ? reason.message : "Unable to start transcription.";
      setError(message);
      setJob((previous) => previous ? { ...previous, status: "failed", stage: "Request failed", progress: undefined, error: message } : null);
    } finally {
      setBusy(false);
    }
  }

  async function startAlignment() {
    if ((!file && !project?.asset_id) || !lyricsText.trim()) return;
    if (transcriptionMode === "selected" && !language) {
      setError("Choose an expected language before aligning lyrics.");
      return;
    }
    setBusy(true);
    setError("");
    setEditedSegments([]);
    setCompletedStep(0);
    setJob({ status: "uploading", stage: "Uploading media", progress: 5 });
    setWorkflowStep(1);
    try {
      let assetId = project?.asset_id ?? undefined;
      let projectId = project?.id;
      if (!assetId && file) {
        const body = new FormData();
        body.append("file", file);
        const uploadResponse = await fetch(`${apiBase}/api/v1/uploads`, { method: "POST", body });
        if (!uploadResponse.ok) throw new Error(await responseError(uploadResponse));
        const uploaded = (await uploadResponse.json()) as UploadResult;
        assetId = uploaded.asset_id;
        const draft = await createDraftProject(assetId, file.name.replace(/\.[^.]+$/, "") || "Untitled song");
        projectId = draft.id;
      }
      if (!assetId) throw new Error("Choose or open a project with an audio file first.");
      setCompletedStep(1);
      setWorkflowStep(2);
      const jobResponse = await fetch(`${apiBase}/api/v1/jobs/align`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_id: assetId,
          lyrics_text: lyricsText,
          language: transcriptionMode === "selected" ? language : transcriptionMode === "multilingual" ? "multi" : "auto",
          mode: transcriptionMode,
          model_size: model,
        }),
      });
      if (!jobResponse.ok) throw new Error(await responseError(jobResponse));
      const created = (await jobResponse.json()) as JobResult;
      const jobId = created.job_id ?? created.id;
      if (!jobId) throw new Error("The API created an alignment job without returning its identifier.");
      setJob({ ...created, id: jobId });
      await pollJob(jobId, assetId, projectId);
    } catch (reason) {
      const message = reason instanceof TypeError
        ? `Cannot reach the KaraokeText API at ${apiBase}. Start the FastAPI backend and retry.`
        : reason instanceof Error ? reason.message : "Unable to align the supplied lyrics.";
      setError(message);
      setJob((previous) => previous ? { ...previous, status: "failed", stage: "Request failed", progress: undefined, error: message } : null);
    } finally {
      setBusy(false);
    }
  }

  async function pollJob(jobId: string, assetId: string, existingProjectId?: string) {
    for (let attempt = 0; attempt < 900; attempt += 1) {
      const response = await fetch(`${apiBase}/api/v1/jobs/${jobId}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      const next = (await response.json()) as JobResult;
      setJob({ ...next, id: jobId });
      if (["completed", "ready_for_review", "failed"].includes(next.status)) {
        if (next.status === "failed") throw new Error(next.error ?? "Transcription failed.");
        const segments = next.transcript?.segments ?? [];
          setCompletedStep(2);
          setWorkflowStep(3);
        setEditedSegments(segments);
        let savedResponse: Response;
        if (existingProjectId) {
          const currentResponse = await fetch(`${apiBase}/api/v1/projects/${existingProjectId}`, { cache: "no-store" });
          if (!currentResponse.ok) throw new Error(await responseError(currentResponse));
          const currentProject = (await currentResponse.json()) as SavedProject;
          savedResponse = await fetch(`${apiBase}/api/v1/projects/${existingProjectId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              version: currentProject.version,
              transcript: {
                ...currentProject.transcript,
                ...next.transcript,
                segments,
                media_kind: currentProject.transcript?.media_kind ?? mediaKindForFile(file),
                editor: currentEditorSnapshot(),
              },
            }),
          });
        } else {
          savedResponse = await fetch(`${apiBase}/api/v1/projects`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: file?.name.replace(/\.[^.]+$/, "") || "Untitled song", asset_id: assetId, transcript: { ...next.transcript, segments } }),
          });
        }
        if (!savedResponse.ok) throw new Error(await responseError(savedResponse));
        const saved = (await savedResponse.json()) as SavedProject;
        setProject(saved);
        setProjects((previous) => [saved, ...previous.filter((item) => item.id !== saved.id)]);
        setCompletedStep(3);
        setWorkflowStep(4);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    throw new Error("This job is taking longer than expected. You can check its status again later.");
  }

  async function responseError(response: Response) {
    try {
      const payload = await response.json();
      return payload.detail ?? payload.error ?? `Request failed (${response.status}).`;
    } catch {
      return `Request failed (${response.status}).`;
    }
  }

  async function saveEdits() {
    if (!project) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/v1/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: project.version,
          transcript: {
            ...project.transcript,
            ...job?.transcript,
            segments: editedSegments,
            media_kind: project.transcript?.media_kind ?? mediaKindForFile(file),
            editor: currentEditorSnapshot(),
          },
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setProject((await response.json()) as SavedProject);
      setCompletedStep((previous) => Math.max(previous, 3));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function exportProject(format: string) {
    if (!project) return;
    try {
      const response = await fetch(`${apiBase}/api/v1/projects/${project.id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json();
      const link = document.createElement("a");
      link.href = `${apiBase}${result.download_url}`;
      link.download = "";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create export.");
    }
  }

  function togglePlayback() {
    if (isVideoMedia && videoRef.current) {
      if (videoRef.current.paused) void videoRef.current.play();
      else videoRef.current.pause();
      return;
    }
    if (!audioRef.current) return;
    if (audioRef.current.paused) void audioRef.current.play();
    else audioRef.current.pause();
  }

  function currentEditorSnapshot(): EditorSnapshot {
    return { duration: videoDuration, clips, burn_subtitles: burnSubtitles, font_size: fontSize, frame_rate: frameRate, timeline_zoom: timelineZoom };
  }

  function commitClips(next: VideoClip[]) {
    clipHistoryRef.current.past = [...clipHistoryRef.current.past.slice(-99), clips];
    clipHistoryRef.current.future = [];
    setHistoryVersion((version) => version + 1);
    setClips(normalizeCrossDissolves(next));
  }

  function updateSelectedClipData(update: Partial<VideoClip>) {
    if (!selectedClip) return;
    commitClips(clips.map((clip) => clip.id === selectedClip.id ? { ...clip, ...update } : clip));
  }

  function addEffect(type: EffectType) {
    if (!selectedClip) return;
    const now = performance.now();
    const recentAddition = recentEffectAdditionRef.current;
    if (recentAddition?.type === type && now - recentAddition.timestamp < 400) return;
    recentEffectAdditionRef.current = { type, timestamp: now };
    const definition = EFFECT_REGISTRY[type];
    if (!definition.allowMultiple && selectedClip.effects?.some((effect) => effect.type === type)) return;
    const effect: Effect = { id: crypto.randomUUID(), type, enabled: true, intensity: definition.defaultIntensity };
    updateSelectedClipData({ effects: [...(selectedClip.effects ?? []), effect] });
    setSelectedEffectId(effect.id);
    setEffectLibraryOpen(false);
    setEffectSearch("");
  }

  function addEffectPreset(type: EffectType) {
    if (!selectedClip) return;
    addEffect(type);
  }

  function updateEffect(effectId: string, update: Partial<Effect>) {
    if (!selectedClip) return;
    updateSelectedClipData({
      effects: (selectedClip.effects ?? []).map((effect) => {
        if (effect.id !== effectId) return effect;
        const intensity = update.intensity;
        return {
          ...effect,
          ...update,
          intensity: intensity === undefined
            ? effect.intensity
            : Number.isFinite(intensity)
              ? boundedEffectIntensity(effect.type, intensity)
              : effect.intensity,
        };
      }),
    });
  }

  function resetEffect(effectId: string) {
    const effect = selectedClip?.effects?.find((item) => item.id === effectId);
    if (!effect) return;
    updateEffect(effectId, { intensity: EFFECT_REGISTRY[effect.type].defaultIntensity });
  }

  function resetAllEffects() {
    if (!selectedClip?.effects?.length) return;
    if (!window.confirm(`Reset parameters for all ${selectedClip.effects.length} effects on this clip?`)) return;
    updateSelectedClipData({
      effects: selectedClip.effects.map((effect) => ({
        ...effect,
        intensity: EFFECT_REGISTRY[effect.type].defaultIntensity,
      })),
    });
  }

  function applyEffectStackPreview(clip: VideoClip, effectId: string, intensity: number) {
    const video = videoRef.current;
    if (!video) return;
    const filters = (clip.effects ?? []).filter((effect) => effect.enabled).flatMap((effect) => {
      const amount = effect.id === effectId ? intensity : effect.intensity;
      switch (effect.type) {
        case "blur": return [`blur(${Math.max(0, amount)}px)`];
        case "brightness": return [`brightness(${Math.max(0, 1 + amount)})`];
        case "contrast": return [`contrast(${Math.max(0, amount)})`];
        case "saturation": return [`saturate(${Math.max(0, amount)})`];
        case "grayscale": return [`grayscale(${Math.max(0, Math.min(1, amount))})`];
        case "sepia": return [`sepia(${Math.max(0, Math.min(1, amount))})`];
        case "vignette": return [];
      }
    });
    video.style.filter = filters.join(" ");
    const vignette = clip.effects?.find((effect) => effect.type === "vignette" && effect.enabled);
    const vignetteValue = vignette?.id === effectId ? intensity : vignette?.intensity ?? 0;
    video.style.boxShadow = vignette ? `inset 0 0 90px rgba(0,0,0,${Math.max(0, Math.min(1, vignetteValue))})` : "";
  }

  function beginEffectIntensityGesture(clip: VideoClip, effect: Effect) {
    effectSliderGestureRef.current = {
      clipId: clip.id,
      effectId: effect.id,
      original: effect.intensity,
      latest: effect.intensity,
    };
  }

  function previewEffectIntensity(clip: VideoClip, effect: Effect, value: number, input: HTMLInputElement) {
    const gesture = effectSliderGestureRef.current;
    if (!gesture || gesture.clipId !== clip.id || gesture.effectId !== effect.id) {
      beginEffectIntensityGesture(clip, effect);
    }
    if (effectSliderGestureRef.current) effectSliderGestureRef.current.latest = value;
    const output = input.parentElement?.querySelector("output");
    if (output) output.value = `${value.toFixed(2)}${effect.type === "blur" ? " px" : ""}`;
    applyEffectStackPreview(clip, effect.id, value);
  }

  function commitEffectIntensityGesture() {
    const gesture = effectSliderGestureRef.current;
    if (!gesture) return;
    effectSliderGestureRef.current = null;
    if (Math.abs(gesture.latest - gesture.original) < 0.0001) return;
    const nextClips = clips.map((clip) => clip.id === gesture.clipId
      ? {
          ...clip,
          effects: (clip.effects ?? []).map((effect) => effect.id === gesture.effectId
            ? { ...effect, intensity: gesture.latest }
            : effect),
        }
      : clip);
    commitClips(nextClips);
  }

  function copyEffect(effect: Effect) {
    setEffectClipboard([{ ...effect }]);
    setError("");
  }

  function copyEffectStack() {
    if (!selectedClip?.effects?.length) return;
    setEffectClipboard(selectedClip.effects.map((effect) => ({ ...effect })));
    setError("");
  }

  function pasteEffect() {
    if (!selectedClip || !effectClipboard.length) return;
    const pastedEffects = effectClipboard.map((effect) => ({ ...effect, id: crypto.randomUUID() }));
    updateSelectedClipData({ effects: [...(selectedClip.effects ?? []), ...pastedEffects] });
    setSelectedEffectId(pastedEffects[0].id);
  }

  function reorderEffect(effectId: string, targetId: string) {
    if (!selectedClip) return;
    const effects = [...(selectedClip.effects ?? [])];
    const index = effects.findIndex((effect) => effect.id === effectId);
    const destination = effects.findIndex((effect) => effect.id === targetId);
    if (index < 0 || destination < 0 || index === destination) return;
    const [moving] = effects.splice(index, 1);
    effects.splice(destination, 0, moving);
    updateSelectedClipData({ effects });
  }

  function duplicateEffect(effectId: string) {
    if (!selectedClip) return;
    const effects = [...(selectedClip.effects ?? [])];
    const index = effects.findIndex((effect) => effect.id === effectId);
    if (index < 0) return;
    if (!EFFECT_REGISTRY[effects[index].type].allowMultiple) return;
    effects.splice(index + 1, 0, { ...effects[index], id: crypto.randomUUID() });
    updateSelectedClipData({ effects });
  }

  function getCurrentSourceTime(clip: VideoClip) {
    const sourceTime = clip.start + currentTimeRef.current - clip.timelineStart;
    return Math.max(clip.start, Math.min(clip.end, sourceTime));
  }

  function setTransition(edge: "transitionIn" | "transitionOut", duration: number) {
    if (!selectedClip) return;
    const type = selectedClip[edge]?.type ?? (edge === "transitionIn" ? "fade-in" : "fade-out");
    const ordered = [...clips].sort((a, b) => a.timelineStart - b.timelineStart);
    const index = ordered.findIndex((clip) => clip.id === selectedClip.id);
    const next = edge === "transitionOut" && type === "cross-dissolve" ? ordered[index + 1] : undefined;
    const boundedDuration = Math.max(0, Math.min(
      2,
      duration,
      (selectedClip.end - selectedClip.start) / 2,
      next ? (next.end - next.start) / 2 : 2,
    ));
    updateSelectedClipData({ [edge]: boundedDuration ? { type, duration: boundedDuration } : undefined });
  }

  function beginTransitionDurationGesture(edge: "transitionIn" | "transitionOut") {
    if (!selectedClip || transitionDurationGestureRef.current) return;
    const snapshot = clips.map((clip) => ({ ...clip }));
    transitionDurationGestureRef.current = {
      clipId: selectedClip.id,
      edge,
      initialClips: snapshot,
      latestClips: snapshot,
    };
  }

  function previewTransitionDuration(edge: "transitionIn" | "transitionOut", duration: number) {
    if (!selectedClip || !Number.isFinite(duration)) return;
    if (!transitionDurationGestureRef.current) beginTransitionDurationGesture(edge);
    const gesture = transitionDurationGestureRef.current;
    if (!gesture || gesture.clipId !== selectedClip.id || gesture.edge !== edge) return;
    const type = selectedClip[edge]?.type ?? (edge === "transitionIn" ? "fade-in" : "fade-out");
    const ordered = [...clips].sort((left, right) => left.timelineStart - right.timelineStart);
    const index = ordered.findIndex((clip) => clip.id === selectedClip.id);
    const next = edge === "transitionOut" && type === "cross-dissolve" ? ordered[index + 1] : undefined;
    const boundedDuration = Math.max(0.05, Math.min(
      2,
      duration,
      (selectedClip.end - selectedClip.start) / 2,
      next ? (next.end - next.start) / 2 : 2,
    ));
    const nextClips = clips.map((clip) => clip.id === selectedClip.id
      ? { ...clip, [edge]: { type, duration: boundedDuration } }
      : clip) as VideoClip[];
    gesture.latestClips = nextClips;
    setClips(nextClips);
    const sourceTime = videoRef.current?.currentTime;
    if (sourceTime !== undefined) videoPreviewRefreshRef.current(sourceTime);
  }

  function finishTransitionDurationGesture(cancelled = false) {
    const gesture = transitionDurationGestureRef.current;
    if (!gesture) return;
    transitionDurationGestureRef.current = null;
    if (cancelled) {
      setClips(gesture.initialClips);
    } else {
      const initial = gesture.initialClips.find((clip) => clip.id === gesture.clipId)?.[gesture.edge];
      const latest = gesture.latestClips.find((clip) => clip.id === gesture.clipId)?.[gesture.edge];
      if (initial?.type === latest?.type && initial?.duration === latest?.duration) return;
      clipHistoryRef.current.past = [...clipHistoryRef.current.past.slice(-99), gesture.initialClips];
      clipHistoryRef.current.future = [];
      setClips(normalizeCrossDissolves(gesture.latestClips));
      setHistoryVersion((version) => version + 1);
    }
    const sourceTime = videoRef.current?.currentTime;
    if (sourceTime !== undefined) videoPreviewRefreshRef.current(sourceTime);
  }

  function setTransitionOutType(type: "none" | "fade-out" | "cross-dissolve") {
    if (!selectedClip) return;
    const ordered = [...clips].sort((a, b) => a.timelineStart - b.timelineStart);
    const index = ordered.findIndex((clip) => clip.id === selectedClip.id);
    if (type === "none") {
      updateSelectedClipData({ transitionOut: undefined });
      return;
    }
    const next = type === "cross-dissolve" ? ordered[index + 1] : undefined;
    if (type === "cross-dissolve") {
      const clipEnd = selectedClip.timelineStart + selectedClip.end - selectedClip.start;
      if (!next || Math.abs(next.timelineStart - clipEnd) > 0.03) {
        setError("Cross dissolve requires a following clip directly adjacent on the Video 1 track.");
        return;
      }
    }
    const previousDuration = selectedClip.transitionOut?.duration ?? 0.5;
    updateSelectedClipData({
      transitionOut: {
        type,
        duration: Math.min(previousDuration, (selectedClip.end - selectedClip.start) / 2, next ? (next.end - next.start) / 2 : 2),
      },
    });
    setError("");
  }

  function setKeyframe(property: AnimatedProperty, value: number) {
    if (!selectedClip || !Number.isFinite(value)) return;
    const sourceTime = Math.round(getCurrentSourceTime(selectedClip) * frameRate) / frameRate;
    const boundedValue = property === "opacity"
      ? Math.max(0, Math.min(1, value))
      : property === "scale" ? Math.max(0.1, Math.min(4, value))
      : property === "brightness" ? Math.max(-1, Math.min(1, value))
      : property === "rotation" ? Math.max(-360, Math.min(360, value))
      : Math.max(-10000, Math.min(10000, value));
    const keyframes = (selectedClip.keyframes ?? []).filter((keyframe) => !(keyframe.property === property && Math.abs(keyframe.time - sourceTime) < 1 / frameRate));
    const existing = selectedClip.keyframes?.find((keyframe) => keyframe.property === property && Math.abs(keyframe.time - sourceTime) < 1 / frameRate);
    const nextKeyframe: Keyframe = {
      id: existing?.id ?? crypto.randomUUID(),
      property,
      time: sourceTime,
      value: boundedValue,
      interpolation: existing?.interpolation ?? "linear",
    };
    keyframes.push(nextKeyframe);
    updateSelectedClipData({ keyframes: keyframes.sort((a, b) => a.time - b.time) });
    setSelectedKeyframeId(nextKeyframe.id);
  }

  function updateSelectedKeyframe(update: Partial<Pick<Keyframe, "time" | "value" | "interpolation">>) {
    if (!selectedClip || !selectedKeyframe) return;
    if (update.time !== undefined && !Number.isFinite(update.time)) return;
    if (update.value !== undefined && !Number.isFinite(update.value)) return;
    const frameDuration = 1 / frameRate;
    const requestedTime = update.time === undefined
      ? selectedKeyframe.time
      : Math.max(selectedClip.start, Math.min(selectedClip.end, Math.round(update.time / frameDuration) * frameDuration));
    const duplicate = selectedClip.keyframes?.find((keyframe) =>
      keyframe.id !== selectedKeyframe.id
      && keyframe.property === selectedKeyframe.property
      && Math.abs(keyframe.time - requestedTime) < frameDuration / 2
    );
    const keyframes = (selectedClip.keyframes ?? [])
      .filter((keyframe) => keyframe.id !== selectedKeyframe.id && keyframe.id !== duplicate?.id)
      .concat({
        ...selectedKeyframe,
        ...update,
        time: requestedTime,
        value: update.value === undefined ? selectedKeyframe.value : Math.max(
          selectedKeyframe.property === "scale" ? 0.1 : selectedKeyframe.property === "opacity" ? 0 : selectedKeyframe.property === "brightness" ? -1 : selectedKeyframe.property === "rotation" ? -360 : -10000,
          Math.min(
            selectedKeyframe.property === "scale" ? 4 : selectedKeyframe.property === "opacity" ? 1 : selectedKeyframe.property === "brightness" ? 1 : selectedKeyframe.property === "rotation" ? 360 : 10000,
            update.value,
          ),
        ),
      })
      .sort((left, right) => left.time - right.time);
    updateSelectedClipData({ keyframes });
  }

  function removeCurrentKeyframe(property: AnimatedProperty) {
    if (!selectedClip) return;
    const sourceTime = getCurrentSourceTime(selectedClip);
    const keyframes = (selectedClip.keyframes ?? []).filter((keyframe) =>
      keyframe.property !== property || Math.abs(keyframe.time - sourceTime) >= 1 / frameRate
    );
    updateSelectedClipData({ keyframes });
    if (selectedClip.keyframes?.some((keyframe) => keyframe.id === selectedKeyframeId && keyframe.property === property)) {
      setSelectedKeyframeId("");
    }
  }

  function applyAnimationPreset(preset: "fade-in" | "fade-out" | "flash" | "zoom-in" | "zoom-out" | "slow-zoom" | "pan-left" | "pan-right") {
    if (!selectedClip) return;
    const keyframes = (selectedClip.keyframes ?? []).filter((keyframe) =>
      !(
        (preset === "flash" && keyframe.property === "brightness")
        || ((preset === "zoom-in" || preset === "zoom-out" || preset === "slow-zoom") && keyframe.property === "scale")
        || ((preset === "pan-left" || preset === "pan-right") && keyframe.property === "position_x")
        || ((preset === "fade-in" || preset === "fade-out") && keyframe.property === "opacity")
      )
    );
    if (preset === "flash") {
      const middle = (selectedClip.start + selectedClip.end) / 2;
      keyframes.push(
        { id: crypto.randomUUID(), property: "brightness", time: middle - 0.25, value: 0, interpolation: "linear" },
        { id: crypto.randomUUID(), property: "brightness", time: middle, value: 0.7, interpolation: "linear" },
        { id: crypto.randomUUID(), property: "brightness", time: middle + 0.25, value: 0, interpolation: "linear" },
      );
    } else if (preset === "zoom-in" || preset === "zoom-out" || preset === "slow-zoom") {
      const start = preset === "zoom-out" ? 1.25 : 1;
      const end = preset === "zoom-out" ? 1 : preset === "slow-zoom" ? 1.12 : 1.25;
      keyframes.push(
        { id: crypto.randomUUID(), property: "scale", time: selectedClip.start, value: start, interpolation: "linear" },
        { id: crypto.randomUUID(), property: "scale", time: selectedClip.end, value: end, interpolation: "linear" },
      );
    } else if (preset === "pan-left" || preset === "pan-right") {
      const from = preset === "pan-left" ? 160 : -160;
      const to = -from;
      keyframes.push(
        { id: crypto.randomUUID(), property: "position_x", time: selectedClip.start, value: from, interpolation: "linear" },
        { id: crypto.randomUUID(), property: "position_x", time: selectedClip.end, value: to, interpolation: "linear" },
      );
    } else {
      const fadeDuration = Math.min(1, (selectedClip.end - selectedClip.start) / 2);
      keyframes.push(...(preset === "fade-in" ? [
        { id: crypto.randomUUID(), property: "opacity" as const, time: selectedClip.start, value: 0, interpolation: "linear" as const },
        { id: crypto.randomUUID(), property: "opacity" as const, time: selectedClip.start + fadeDuration, value: 1, interpolation: "linear" as const },
      ] : [
        { id: crypto.randomUUID(), property: "opacity" as const, time: selectedClip.end - fadeDuration, value: 1, interpolation: "linear" as const },
        { id: crypto.randomUUID(), property: "opacity" as const, time: selectedClip.end, value: 0, interpolation: "linear" as const },
      ]));
    }
    updateSelectedClipData({ keyframes: keyframes.sort((a, b) => a.time - b.time) });
  }

  function undoClips() {
    const previous = clipHistoryRef.current.past.pop();
    if (!previous) return;
    clipHistoryRef.current.future.push(clips);
    setClips(previous);
    setSelectedClipId((selected) => previous.some((clip) => clip.id === selected) ? selected : previous[0]?.id ?? "");
    setHistoryVersion((version) => version + 1);
  }

  function redoClips() {
    const next = clipHistoryRef.current.future.pop();
    if (!next) return;
    clipHistoryRef.current.past.push(clips);
    setClips(next);
    setSelectedClipId((selected) => next.some((clip) => clip.id === selected) ? selected : next[0]?.id ?? "");
    setHistoryVersion((version) => version + 1);
  }

  function updateSelectedClip(update: Partial<VideoClip>) {
    commitClips(clips.map((clip) => clip.id === selectedClipId ? { ...clip, ...update } : clip));
  }

  function setSelectedClipEdge(edge: "start" | "end", value: number) {
    const clip = clips.find((item) => item.id === selectedClipId);
    if (!clip || !Number.isFinite(value)) return;
    const frameDuration = 1 / frameRate;
    const otherClips = clips.filter((item) => item.id !== clip.id);
    let update: Partial<VideoClip>;
    if (edge === "start") {
      const previousEnd = otherClips
        .filter((item) => item.timelineStart + item.end - item.start <= clip.timelineStart + 0.001)
        .reduce((latest, item) => Math.max(latest, item.timelineStart + item.end - item.start), 0);
      const minimumStart = Math.max(0, clip.start + previousEnd - clip.timelineStart);
      const start = Math.min(clip.end - frameDuration, Math.max(minimumStart, Math.round(value / frameDuration) * frameDuration));
      update = { start, timelineStart: clip.timelineStart + start - clip.start };
    } else {
      const nextStart = otherClips
        .filter((item) => item.timelineStart >= clip.timelineStart + clip.end - clip.start - 0.001)
        .reduce((earliest, item) => Math.min(earliest, item.timelineStart), Number.POSITIVE_INFINITY);
      const maximumEnd = Math.min(videoDuration, Number.isFinite(nextStart) ? clip.start + nextStart - clip.timelineStart : videoDuration);
      update = { end: Math.max(clip.start + frameDuration, Math.min(maximumEnd, Math.round(value / frameDuration) * frameDuration)) };
    }
    if (update.start !== undefined || update.end !== undefined) {
      const start = update.start ?? clip.start;
      const end = update.end ?? clip.end;
      const retained = retainClipRangeData(clip, start, end);
      updateSelectedClip({ ...retained, timelineStart: update.timelineStart ?? clip.timelineStart });
    } else updateSelectedClip(update);
  }

  const startClipTrim = useCallback((event: ReactPointerEvent<HTMLButtonElement>, clip: VideoClip, edge: "start" | "end") => {
    event.preventDefault();
    event.stopPropagation();
    const snapshot = clips.map((item) => ({ ...item }));
    clipTrimDragRef.current = {
      clipId: clip.id,
      edge,
      pointerId: event.pointerId,
      pointerStartX: event.clientX,
      initialClip: { ...clip },
      initialClips: snapshot,
      latestClips: snapshot,
    };
    setSelectedClipId(clip.id);
    activeClipIdRef.current = clip.id;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [clips]);

  const moveClipTrim = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = clipTrimDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const delta = (event.clientX - drag.pointerStartX) / timelineZoom;
    const frameDuration = 1 / frameRate;
    const clip = drag.initialClip;
    const otherClips = drag.initialClips
      .filter((item) => item.id !== clip.id)
      .sort((left, right) => left.timelineStart - right.timelineStart);
    const previousEnd = otherClips
      .filter((item) => item.timelineStart + item.end - item.start <= clip.timelineStart + 0.001)
      .reduce((latest, item) => Math.max(latest, item.timelineStart + item.end - item.start), 0);
    const nextStart = otherClips
      .filter((item) => item.timelineStart >= clip.timelineStart + clip.end - clip.start - 0.001)
      .reduce((earliest, item) => Math.min(earliest, item.timelineStart), Number.POSITIVE_INFINITY);
    const updated = { ...clip };

    if (drag.edge === "start") {
      const minimumStart = Math.max(0, clip.start + previousEnd - clip.timelineStart);
      const requestedStart = clip.start + delta;
      updated.start = Math.min(clip.end - frameDuration, Math.max(minimumStart, Math.round(requestedStart / frameDuration) * frameDuration));
      updated.timelineStart = clip.timelineStart + updated.start - clip.start;
    } else {
      const maximumEnd = Math.min(
        videoDuration,
        Number.isFinite(nextStart) ? clip.start + nextStart - clip.timelineStart : videoDuration,
      );
      updated.end = Math.max(clip.start + frameDuration, Math.min(maximumEnd, Math.round((clip.end + delta) / frameDuration) * frameDuration));
    }
    const nextClips = drag.initialClips.map((item) => item.id === clip.id ? updated : item);
    drag.latestClips = nextClips;
    const videoNode = event.currentTarget.closest<HTMLElement>(".video-clip");
    if (videoNode) {
      videoNode.style.left = `${timelineTimeToPixel(updated.timelineStart, timelineZoom)}px`;
      videoNode.style.width = `${Math.max(24, timelineTimeToPixel(updated.end - updated.start, timelineZoom))}px`;
    }
    const audioNode = [...(timelineScrollRef.current?.querySelectorAll<HTMLElement>(".audio-clip[data-clip-id]") ?? [])]
      .find((node) => node.dataset.clipId === updated.id);
    if (audioNode) {
      audioNode.style.left = `${timelineTimeToPixel(updated.timelineStart, timelineZoom)}px`;
      audioNode.style.width = `${Math.max(24, timelineTimeToPixel(updated.end - updated.start, timelineZoom))}px`;
    }
  }, [frameRate, timelineZoom, videoDuration]);

  const finishClipTrim = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = clipTrimDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const cancelled = event.type === "pointercancel";
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    clipTrimDragRef.current = null;
    if (cancelled) {
      setClips(drag.initialClips);
      for (const clip of drag.initialClips) {
        const left = timelineTimeToPixel(clip.timelineStart, timelineZoom);
        const width = Math.max(24, timelineTimeToPixel(clip.end - clip.start, timelineZoom));
        const videoNode = timelineScrollRef.current?.querySelector<HTMLElement>(`.video-clip[data-clip-id="${clip.id}"]`);
        const audioNode = timelineScrollRef.current?.querySelector<HTMLElement>(`.audio-clip[data-clip-id="${clip.id}"]`);
        if (videoNode) {
          videoNode.style.left = `${left}px`;
          videoNode.style.width = `${width}px`;
        }
        if (audioNode) {
          audioNode.style.left = `${left}px`;
          audioNode.style.width = `${width}px`;
        }
      }
      return;
    }
    const changed = drag.latestClips.some((clip, index) =>
      clip.start !== drag.initialClips[index]?.start ||
      clip.end !== drag.initialClips[index]?.end ||
      clip.timelineStart !== drag.initialClips[index]?.timelineStart
    );
    if (!changed) return;
    clipHistoryRef.current.past = [...clipHistoryRef.current.past.slice(-99), drag.initialClips];
    clipHistoryRef.current.future = [];
    const completedClips = drag.latestClips.map((clip) =>
      clip.id === drag.clipId ? retainClipRangeData(clip, clip.start, clip.end) : clip
    );
    setClips(normalizeCrossDissolves(completedClips));
    setHistoryVersion((version) => version + 1);
  }, [timelineZoom]);

  function splitSelectedClip() {
    const clip = clips.find((item) => item.id === selectedClipId);
    const frameDuration = 1 / frameRate;
    const rawSplitAt = clip ? clip.start + currentTimeRef.current - clip.timelineStart : currentTimeRef.current;
    const splitAt = Math.round(rawSplitAt / frameDuration) * frameDuration;
    if (!clip || splitAt <= clip.start + frameDuration / 2 || splitAt >= clip.end - frameDuration / 2) {
      setError("Move the playhead inside the selected clip before splitting.");
      return;
    }
    const leftClip = retainClipRangeData(clip, clip.start, splitAt);
    leftClip.transitionOut = undefined;
    const right = retainClipRangeData(
      { ...clip, id: crypto.randomUUID(), timelineStart: clip.timelineStart + splitAt - clip.start },
      splitAt,
      clip.end,
    );
    right.transitionIn = undefined;
    commitClips(clips.flatMap((item) => item.id === clip.id
      ? [leftClip, right]
      : [item]));
    setSelectedClipId(right.id);
    activeClipIdRef.current = right.id;
    setError("");
  }

  function removeSelectedClip(ripple = false) {
    if (clips.length <= 1) {
      setError("Keep at least one clip in the timeline.");
      return;
    }
    const removed = clips.find((clip) => clip.id === selectedClipId);
    if (!removed) return;
    const removedDuration = removed.end - removed.start;
    const removedTimelineEnd = removed.timelineStart + removedDuration;
    const remaining = clips
      .filter((clip) => clip.id !== selectedClipId)
      .map((clip) => ripple && clip.timelineStart >= removedTimelineEnd
        ? { ...clip, timelineStart: Math.max(0, clip.timelineStart - removedDuration) }
        : clip);
    commitClips(remaining);
    setSelectedClipId(remaining[0]?.id ?? "");
    activeClipIdRef.current = remaining[0]?.id ?? "";
    setError("");
  }

  const seekTimeline = useCallback((timelineTime: number, publishUiState = true) => {
    const frameDuration = 1 / frameRate;
    const boundedTime = Math.min(timelineDuration, Math.max(0, Math.round(timelineTime / frameDuration) * frameDuration));
    currentTimeRef.current = boundedTime;
    const containingClip = clips.find((clip) =>
      boundedTime >= clip.timelineStart && boundedTime < clip.timelineStart + clip.end - clip.start
    );
    if (publishUiState) setCurrentTime(boundedTime);
    timelineScrollRef.current?.style.setProperty("--playhead-x", `${timelineTimeToPixel(boundedTime, timelineZoom)}px`);
    if (videoPreviewTimeRef.current) {
      videoPreviewTimeRef.current.textContent = `${formatTime(boundedTime)} / ${formatTime(videoDuration)}`;
    }
    if (playheadRangeRef.current) playheadRangeRef.current.value = String(boundedTime);
    if (playheadOutputRef.current) playheadOutputRef.current.textContent = formatTime(boundedTime);
    if (!containingClip) {
      if (transitionCanvasRef.current) {
        transitionCanvasRef.current.style.display = "none";
        delete transitionCanvasRef.current.dataset.nextClipId;
      }
      updatePlayheadInGap(true);
      videoRef.current?.pause();
      return;
    }
    updatePlayheadInGap(false);
    if (activeClipIdRef.current !== containingClip.id) {
      setSelectedClipId(containingClip.id);
      activeClipIdRef.current = containingClip.id;
    }
    queueVideoSeek(containingClip.start + boundedTime - containingClip.timelineStart);
  }, [clips, frameRate, queueVideoSeek, timelineDuration, timelineZoom, updatePlayheadInGap, videoDuration]);

  function handleVideoTimeUpdate(sourceTime: number) {
    const activeById = clips.find((clip) => clip.id === activeClipIdRef.current);
    const committedActiveClip = activeById && sourceTime >= activeById.start - 0.03 && sourceTime <= activeById.end + 0.03
      ? activeById
      : clips.find((clip) => sourceTime >= clip.start && sourceTime < clip.end);
    const previewClip = keyframePreviewClipRef.current;
    const activeClip = committedActiveClip && previewClip?.id === committedActiveClip.id
      ? previewClip
      : committedActiveClip;
    if (!activeClip) return;
    const timelineTime = activeClip.timelineStart + sourceTime - activeClip.start;
    currentTimeRef.current = timelineTime;
    const video = videoRef.current;
    if (video) {
      const activeEffectGesture = effectSliderGestureRef.current;
      const filterParts = (activeClip.effects ?? []).filter((effect) => effect.enabled).flatMap((effect) => {
        const intensity = activeEffectGesture?.clipId === activeClip.id && activeEffectGesture.effectId === effect.id
          ? activeEffectGesture.latest
          : effect.intensity;
        switch (effect.type) {
          case "blur": return [`blur(${Math.max(0, intensity)}px)`];
          case "brightness": return [`brightness(${Math.max(0, 1 + intensity)})`];
          case "contrast": return [`contrast(${Math.max(0, intensity)})`];
          case "saturation": return [`saturate(${Math.max(0, intensity)})`];
          case "grayscale": return [`grayscale(${Math.max(0, Math.min(1, intensity))})`];
          case "sepia": return [`sepia(${Math.max(0, Math.min(1, intensity))})`];
          case "vignette": return [];
        }
      });
      const animatedBrightness = getAnimatedValue(activeClip, "brightness", sourceTime, 0);
      if (animatedBrightness) filterParts.push(`brightness(${Math.max(0, 1 + animatedBrightness)})`);
      video.style.filter = filterParts.join(" ");
      const fadeIn = activeClip.transitionIn?.duration ?? 0;
      const fadeOut = activeClip.transitionOut?.duration ?? 0;
      const sorted = [...clips].sort((a, b) => a.timelineStart - b.timelineStart);
      const activeIndex = sorted.findIndex((clip) => clip.id === activeClip.id);
      const previousClip = sorted[activeIndex - 1];
      const crossfadeDuration = previousClip?.transitionOut?.type === "cross-dissolve" ? previousClip.transitionOut.duration : 0;
      const canvas = transitionCanvasRef.current;
      const hasCrossfadeFrame = crossfadeDuration > 0 && canvas?.dataset.nextClipId === activeClip.id;
      const fadeInOpacity = fadeIn > 0 ? Math.max(0, Math.min(1, (sourceTime - activeClip.start) / fadeIn)) : 1;
      const crossfadeOpacity = hasCrossfadeFrame
        ? Math.max(0, Math.min(1, (sourceTime - activeClip.start) / crossfadeDuration))
        : 1;
      const fadeOutOpacity = activeClip.transitionOut?.type === "fade-out" && fadeOut > 0
        ? Math.max(0, Math.min(1, (activeClip.end - sourceTime) / fadeOut))
        : 1;
      const animatedOpacity = getAnimatedValue(activeClip, "opacity", sourceTime, 1);
      video.style.opacity = String(Math.max(0, Math.min(1, animatedOpacity * fadeInOpacity * crossfadeOpacity * fadeOutOpacity)));
      if (canvas) {
        canvas.style.display = hasCrossfadeFrame && crossfadeOpacity < 1 ? "block" : "none";
        if (hasCrossfadeFrame && crossfadeOpacity >= 1) delete canvas.dataset.nextClipId;
      }
      const transform = activeClip.transform ?? { scale: 1, x: 0, y: 0, rotation: 0 };
      const animatedScale = getAnimatedValue(activeClip, "scale", sourceTime, 1);
      const animatedX = getAnimatedValue(activeClip, "position_x", sourceTime, 0);
      const animatedY = getAnimatedValue(activeClip, "position_y", sourceTime, 0);
      const animatedRotation = getAnimatedValue(activeClip, "rotation", sourceTime, 0);
      const previewScale = video.videoWidth && video.videoHeight
        ? Math.min(video.clientWidth / video.videoWidth, video.clientHeight / video.videoHeight)
        : 1;
      video.style.transform = `translate(${(transform.x + animatedX) * previewScale}px, ${(transform.y + animatedY) * previewScale}px) scale(${transform.scale * animatedScale}) rotate(${transform.rotation + animatedRotation}deg)`;
      const vignette = (activeClip.effects ?? []).find((effect) => effect.enabled && effect.type === "vignette");
      const vignetteIntensity = vignette && activeEffectGesture?.clipId === activeClip.id && activeEffectGesture.effectId === vignette.id
        ? activeEffectGesture.latest
        : vignette?.intensity ?? 0;
      video.style.boxShadow = vignette ? `inset 0 0 90px rgba(0, 0, 0, ${Math.max(0, Math.min(1, vignetteIntensity))})` : "";
    }
    timelineScrollRef.current?.style.setProperty("--playhead-x", `${timelineTimeToPixel(timelineTime, timelineZoom)}px`);
    if (videoPreviewTimeRef.current) {
      videoPreviewTimeRef.current.textContent = `${formatTime(timelineTime)} / ${formatTime(videoDuration)}`;
    }
    if (playheadRangeRef.current) {
      playheadRangeRef.current.value = String(Math.min(timelineTime, timelineDuration || 0));
    }
    if (playheadOutputRef.current) playheadOutputRef.current.textContent = formatTime(timelineTime);
    const activeSegments = editedSegments.length ? editedSegments : transcript;
    const activeLyricIndex = findActiveSubtitleIndex(activeSegments, sourceTime);
    if (videoLyricOverlayRef.current) {
      videoLyricOverlayRef.current.textContent = activeLyricIndex >= 0 ? activeSegments[activeLyricIndex].text : "";
    }
    if (activeLyricRowIndexRef.current !== activeLyricIndex) {
      lyricsListRef.current?.querySelector(".lyric-row.lyric-active")?.classList.remove("lyric-active");
      if (activeLyricIndex >= 0) {
        lyricsListRef.current
          ?.querySelector(`[data-lyric-index="${activeLyricIndex}"]`)
          ?.classList.add("lyric-active");
      }
      activeLyricRowIndexRef.current = activeLyricIndex;
    }
    if (sourceTime >= activeClip.end - 0.03) {
      const ordered = [...clips].sort((a, b) => a.timelineStart - b.timelineStart);
      const index = ordered.findIndex((clip) => clip.id === activeClip.id);
      const next = ordered[index + 1];
      if (!next) {
        videoRef.current?.pause();
      } else if (next.timelineStart <= activeClip.timelineStart + activeClip.end - activeClip.start + 0.03) {
        if (activeClip.transitionOut?.type === "cross-dissolve" && video && video.videoWidth && video.videoHeight) {
          const canvas = transitionCanvasRef.current;
          const context = canvas?.getContext("2d");
          if (canvas && context) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.dataset.nextClipId = next.id;
          }
        }
        activeClipIdRef.current = next.id;
        setSelectedClipId((selected) => selected === next.id ? selected : next.id);
        if (videoRef.current) videoRef.current.currentTime = next.start;
      } else {
        videoRef.current?.pause();
        const gapTime = activeClip.timelineStart + activeClip.end - activeClip.start;
        currentTimeRef.current = gapTime;
        setCurrentTime(gapTime);
        timelineScrollRef.current?.style.setProperty("--playhead-x", `${timelineTimeToPixel(gapTime, timelineZoom)}px`);
        updatePlayheadInGap(true);
      }
    }
  }

  function moveClipOnTimeline(clipId: string, requestedStart: number) {
    const clip = clips.find((item) => item.id === clipId);
    if (!clip) return;
    const duration = clip.end - clip.start;
    let timelineStart = Math.max(0, requestedStart);
    if (snapEnabledRef.current) {
      const snapTargets = [currentTimeRef.current, ...clips.filter((item) => item.id !== clip.id).flatMap((item) => [
        item.timelineStart,
        item.timelineStart + item.end - item.start,
      ])];
      const nearest = snapTargets.reduce((best, target) =>
        Math.abs(target - timelineStart) < Math.abs(best - timelineStart) ? target : best, timelineStart);
      if (Math.abs(nearest - timelineStart) * timelineZoom <= 8) timelineStart = nearest;
    }
    const collides = clips.some((item) => {
      if (item.id === clip.id) return false;
      const otherEnd = item.timelineStart + item.end - item.start;
      return timelineStart < otherEnd - 0.001 && timelineStart + duration > item.timelineStart + 0.001;
    });
    if (collides) {
      setError("Clips on the main video track cannot overlap. Drop this clip into an empty timeline area.");
      return;
    }
    commitClips(clips.map((item) => item.id === clip.id ? { ...item, timelineStart } : item));
    setSelectedClipId(clip.id);
    activeClipIdRef.current = clip.id;
    setError("");
  }

  function zoomTimeline(nextZoom: number) {
    const viewport = timelineScrollRef.current;
    const boundedZoom = Math.max(0.01, Math.min(240, nextZoom));
    if (!viewport) {
      setTimelineZoom(boundedZoom);
      return;
    }
    const playheadScreenX = timelineTimeToPixel(currentTimeRef.current, timelineZoom) - viewport.scrollLeft;
    setTimelineZoom(boundedZoom);
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, timelineTimeToPixel(currentTimeRef.current, boundedZoom) - playheadScreenX);
    });
  }

  async function renderVideo() {
    if (!project?.asset_id && !file) return;
    setVideoExporting(true);
    setVideoExportMessage("");
    setError("");
    try {
      let currentProject = project;
      if (!currentProject) currentProject = await persistCurrentWorkspace();
      if (!currentProject?.id) throw new Error("Save or upload the video before exporting.");
      currentProject = await persistProjectSnapshot(currentProject);
      if (!clips.length) throw new Error("Set a valid video range before exporting.");
      const response = await fetch(`${apiBase}/api/v1/projects/${currentProject.id}/video-export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clips: clips.map((clip) => ({
            start: clip.start,
            end: clip.end,
            timeline_start: clip.timelineStart,
            effects: clip.effects ?? [],
            keyframes: clip.keyframes ?? [],
            transition_in: clip.transitionIn,
            transition_out: clip.transitionOut,
            transform: clip.transform,
          })),
          subtitles: editedSegments,
          burn_subtitles: burnSubtitles,
          font_size: fontSize,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as { download_url: string; duration_seconds: number };
      setVideoExportMessage(`Render complete · ${formatTime(result.duration_seconds)}. Download started.`);
      const link = document.createElement("a");
      link.href = `${apiBase}${result.download_url}`;
      link.download = "";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (reason) {
      const message = reason instanceof TypeError
        ? `Cannot reach the KaraokeText API at ${apiBase}. Start the FastAPI backend and retry.`
        : reason instanceof Error ? reason.message : "Unable to render video.";
      setError(message);
      setVideoExportMessage("");
    } finally {
      setVideoExporting(false);
      await refreshProjects();
    }
  }

  const isVideoMedia = file
    ? file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name)
    : project?.transcript?.media_kind === "video";
  const selectedClip = clips.find((clip) => clip.id === selectedClipId);
  const orderedClips = [...clips].sort((a, b) => a.timelineStart - b.timelineStart);
  const selectedClipIndex = orderedClips.findIndex((clip) => clip.id === selectedClipId);
  const selectedClipNext = orderedClips[selectedClipIndex + 1];
  const selectedClipEnd = selectedClip ? selectedClip.timelineStart + selectedClip.end - selectedClip.start : 0;
  const canCrossDissolve = !!selectedClip && !!selectedClipNext && Math.abs(selectedClipNext.timelineStart - selectedClipEnd) <= 0.03;
  const supportedTransitions = [
    { type: "fade-in", name: "Fade In", category: "Basic", description: "Reveal this clip from black.", edge: "in" },
    { type: "fade-out", name: "Fade Out", category: "Basic", description: "Fade this clip to black.", edge: "out" },
    { type: "cross-dissolve", name: "Cross Dissolve", category: "Basic", description: "Blend into the next adjacent clip.", edge: "out" },
  ] as const;
  const filteredTransitions = supportedTransitions.filter((transition) =>
    `${transition.name} ${transition.description} ${transition.category}`.toLowerCase().includes(transitionSearch.toLowerCase())
  );
  const activeSelectedEffectId = selectedClip?.effects?.some((effect) => effect.id === selectedEffectId)
    ? selectedEffectId
    : "";
  const selectedKeyframe = selectedClip?.keyframes?.find((keyframe) => keyframe.id === selectedKeyframeId);
  const effectCatalog = (Object.entries(EFFECT_REGISTRY) as [EffectType, EffectDefinition][]).map(([type, definition]) => ({
    type,
    ...definition,
  }));
  const filteredEffectCatalog = effectCatalog.filter((effect) =>
    (effectCategory === "All" || effect.category === effectCategory)
    && `${effect.name} ${effect.description}`.toLowerCase().includes(effectSearch.toLowerCase())
    && (effect.allowMultiple || !selectedClip?.effects?.some((applied) => applied.type === effect.type))
  );
  const selectedSourceTime = selectedClip
    ? selectedClip.start + Math.max(0, Math.min(currentTime - selectedClip.timelineStart, selectedClip.end - selectedClip.start))
    : currentTime;
  const minimumRulerInterval = Math.max(68 / timelineZoom, timelineDuration / 1000, 1);
  const rulerInterval = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400]
    .find((interval) => interval >= minimumRulerInterval) ?? 86400;
  const activeLyric = (editedSegments.length ? editedSegments : transcript)
    .length && selectedClip && !playheadInGap
    ? findActiveSubtitle(editedSegments.length ? editedSegments : transcript, selectedSourceTime)
    : undefined;
  useEffect(() => {
    activeLyricRowIndexRef.current = playheadInGap
      ? -1
      : findActiveSubtitleIndex(editedSegments.length ? editedSegments : transcript, selectedSourceTime);
  }, [editedSegments, playheadInGap, selectedSourceTime, transcript]);
  const subtitleBlocks = useMemo(() => (editedSegments.length ? editedSegments : transcript).flatMap((subtitle, subtitleIndex) =>
    clips.flatMap((clip) => {
      const start = Math.max(subtitle.start, clip.start);
      const end = Math.min(subtitle.end, clip.end);
      return end > start ? [{
        id: `${subtitleIndex}-${clip.id}`,
        start: clip.timelineStart + start - clip.start,
        end: clip.timelineStart + end - clip.start,
        text: subtitle.text,
      }] : [];
    }),
  ), [clips, editedSegments, transcript]);
  const timelineRulerTicks = useMemo(
    () => Array.from({ length: Math.floor(timelineDuration / rulerInterval) + 1 }, (_, index) => index * rulerInterval),
    [rulerInterval, timelineDuration],
  );
  const visibleSubtitleBlocks = useMemo(() => {
    const visibleStart = Math.max(0, timelineViewport.left / timelineZoom - 5);
    const visibleEnd = (timelineViewport.left + timelineViewport.width) / timelineZoom + 5;
    return subtitleBlocks.filter((subtitle) => subtitle.end >= visibleStart && subtitle.start <= visibleEnd);
  }, [subtitleBlocks, timelineViewport, timelineZoom]);
  function startKeyframeDrag(event: ReactPointerEvent<HTMLButtonElement>, clip: VideoClip, keyframe: Keyframe) {
    event.preventDefault();
    event.stopPropagation();
    keyframeDragRef.current = {
      clipId: clip.id,
      keyframeId: keyframe.id,
      pointerId: event.pointerId,
      pointerStartX: event.clientX,
      initialTime: keyframe.time,
      latestTime: keyframe.time,
    };
    setSelectedClipId(clip.id);
    setSelectedKeyframeId(keyframe.id);
    activeClipIdRef.current = clip.id;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveKeyframeDrag(event: ReactPointerEvent<HTMLButtonElement>, clip: VideoClip) {
    const drag = keyframeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.clipId !== clip.id) return;
    event.preventDefault();
    const secondsPerPixel = 1 / timelineZoom;
    const frameDuration = 1 / frameRate;
    let nextTime = Math.max(
      clip.start,
      Math.min(clip.end, drag.initialTime + (event.clientX - drag.pointerStartX) * secondsPerPixel),
    );
    nextTime = Math.round(nextTime / frameDuration) * frameDuration;
    if (snapEnabledRef.current) {
      const movingFrame = clip.keyframes?.find((keyframe) => keyframe.id === drag.keyframeId);
      const sourceTargets = [
        clip.start,
        clip.end,
        clip.start + currentTimeRef.current - clip.timelineStart,
        ...(clip.keyframes ?? [])
          .filter((keyframe) => keyframe.id !== drag.keyframeId && keyframe.property === movingFrame?.property)
          .map((keyframe) => keyframe.time),
      ];
      const snapTarget = sourceTargets.reduce((nearest, target) =>
        Math.abs(target - nextTime) < Math.abs(nearest - nextTime) ? target : nearest, nextTime);
      if (Math.abs(snapTarget - nextTime) * timelineZoom <= 8) nextTime = snapTarget;
    }
    nextTime = Math.round(nextTime / frameDuration) * frameDuration;
    const movingFrame = clip.keyframes?.find((keyframe) => keyframe.id === drag.keyframeId);
    if (movingFrame) {
      keyframePreviewClipRef.current = {
        ...clip,
        keyframes: (clip.keyframes ?? []).map((keyframe) =>
          keyframe.id === movingFrame.id ? { ...keyframe, time: nextTime } : keyframe
        ),
      };
      const sourceTime = videoRef.current?.currentTime;
      if (sourceTime !== undefined) videoPreviewRefreshRef.current(sourceTime);
    }
    drag.latestTime = nextTime;
    event.currentTarget.style.left = `${timelineTimeToPixel(clip.timelineStart + nextTime - clip.start, timelineZoom)}px`;
  }
  function finishKeyframeDrag(event: ReactPointerEvent<HTMLButtonElement>, clip: VideoClip) {
    const drag = keyframeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.clipId !== clip.id) return;
    keyframeDragRef.current = null;
    keyframePreviewClipRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (event.type === "pointercancel" || event.type === "lostpointercapture") {
      event.currentTarget.style.left = `${timelineTimeToPixel(clip.timelineStart + drag.initialTime - clip.start, timelineZoom)}px`;
      const sourceTime = videoRef.current?.currentTime;
      if (sourceTime !== undefined) videoPreviewRefreshRef.current(sourceTime);
      return;
    }
    if (Math.abs(drag.latestTime - drag.initialTime) < 0.0001) return;
    const changed = clips.map((item) => item.id === drag.clipId
      ? {
          ...item,
          keyframes: (() => {
            const moving = item.keyframes?.find((keyframe) => keyframe.id === drag.keyframeId);
            if (!moving) return item.keyframes ?? [];
            return (item.keyframes ?? [])
              .filter((keyframe) => keyframe.id === drag.keyframeId || !(keyframe.property === moving.property && Math.abs(keyframe.time - drag.latestTime) < 1 / frameRate / 2))
              .map((keyframe) => keyframe.id === drag.keyframeId ? { ...keyframe, time: drag.latestTime } : keyframe)
              .sort((a, b) => a.time - b.time);
          })(),
        }
      : item);
    setSelectedKeyframeId(drag.keyframeId);
    commitClips(changed);
  }
  const videoClipNodes = useMemo(() => clips.map((clip, index) => <div
    className={`video-clip ${selectedClipId === clip.id ? "selected" : ""}`}
    data-clip-id={clip.id}
    key={clip.id}
    draggable
    onDragStart={(event) => {
      if (clipTrimDragRef.current) {
        event.preventDefault();
        return;
      }
      const bounds = event.currentTarget.getBoundingClientRect();
      nativeClipDragOffsetRef.current = event.clientX - bounds.left;
      event.dataTransfer.setData("text/plain", clip.id);
      event.dataTransfer.effectAllowed = "move";
    }}
    style={{ left: timelineTimeToPixel(clip.timelineStart, timelineZoom), width: Math.max(24, timelineTimeToPixel(clip.end - clip.start, timelineZoom)) }}
  >
    <button type="button" className="clip-trim-handle clip-trim-start" title={`Drag to trim start · ${frameRate} fps`} aria-label={`Trim start of clip ${index + 1}`} onPointerDown={(event) => startClipTrim(event, clip, "start")} onPointerMove={moveClipTrim} onPointerUp={finishClipTrim} onPointerCancel={finishClipTrim} />
    <button type="button" className="video-clip-select" onClick={() => { setSelectedClipId(clip.id); activeClipIdRef.current = clip.id; seekTimeline(clip.timelineStart); }} aria-label={`Select clip ${index + 1}, source ${formatTime(clip.start)} to ${formatTime(clip.end)}, timeline ${formatTime(clip.timelineStart)}`}>{index + 1} · {formatTime(clip.start)}–{formatTime(clip.end)}</button>
    {(clip.effects?.length ?? 0) > 0 && <span className="video-clip-badge" title={`${clip.effects?.length ?? 0} clip-wide effect(s)`}>FX {clip.effects?.length}</span>}
    {clip.transitionIn && <button type="button" className="clip-transition-marker incoming" style={{ left: 0, width: Math.max(20, timelineTimeToPixel(clip.transitionIn.duration, timelineZoom)) }} title={`fade-in · ${clip.transitionIn.duration.toFixed(2)}s`} aria-label={`Edit fade-in transition before clip ${index + 1}`} onClick={(event) => { event.stopPropagation(); setSelectedClipId(clip.id); activeClipIdRef.current = clip.id; setPropertyTab("Transitions"); }}><Film size={11} /><span>{clip.transitionIn.duration.toFixed(1)}s</span></button>}
    {clip.transitionOut && <button type="button" className="clip-transition-marker" style={{ right: 0, width: Math.max(20, timelineTimeToPixel(clip.transitionOut.duration, timelineZoom)) }} title={`${clip.transitionOut.type} · ${clip.transitionOut.duration.toFixed(2)}s`} aria-label={`Edit ${clip.transitionOut.type} transition after clip ${index + 1}`} onClick={(event) => { event.stopPropagation(); setSelectedClipId(clip.id); activeClipIdRef.current = clip.id; setPropertyTab("Transitions"); }}><Film size={11} /><span>{clip.transitionOut.duration.toFixed(1)}s</span></button>}
    <button type="button" className="clip-trim-handle clip-trim-end" title={`Drag to trim end · ${frameRate} fps`} aria-label={`Trim end of clip ${index + 1}`} onPointerDown={(event) => startClipTrim(event, clip, "end")} onPointerMove={moveClipTrim} onPointerUp={finishClipTrim} onPointerCancel={finishClipTrim} />
  </div>), [clips, finishClipTrim, frameRate, moveClipTrim, seekTimeline, selectedClipId, startClipTrim, timelineZoom]);
  const visibleKeyframeClips = clips.map((clip) => {
    const keyframes = (clip.keyframes ?? []).filter((keyframe) => {
      const timelineTime = clip.timelineStart + keyframe.time - clip.start;
      const pixels = timelineTimeToPixel(timelineTime, timelineZoom);
      return pixels >= timelineViewport.left - 100
        && pixels <= timelineViewport.left + timelineViewport.width + 100;
    });
    return { clip, keyframes };
  });
  const keyframeNodes = visibleKeyframeClips.flatMap(({ clip, keyframes }) => keyframes.map((keyframe) =>
    <button
      type="button"
      className={`keyframe-marker keyframe-${keyframe.property} ${selectedClipId === clip.id ? "selected" : ""} ${selectedKeyframeId === keyframe.id ? "active" : ""}`}
      key={`${clip.id}-${keyframe.id}`}
      title={`${keyframe.property.replace("_", " ")} · ${formatTime(keyframe.time)} · ${keyframe.value.toFixed(2)} · ${keyframe.interpolation}`}
      aria-label={`Seek to ${keyframe.property} keyframe at ${formatTime(keyframe.time)}`}
      style={{ left: timelineTimeToPixel(clip.timelineStart + keyframe.time - clip.start, timelineZoom) }}
      onPointerDown={(event) => startKeyframeDrag(event, clip, keyframe)}
      onPointerMove={(event) => moveKeyframeDrag(event, clip)}
      onPointerUp={(event) => finishKeyframeDrag(event, clip)}
      onPointerCancel={(event) => finishKeyframeDrag(event, clip)}
      onLostPointerCapture={(event) => finishKeyframeDrag(event, clip)}
      onClick={() => { setSelectedClipId(clip.id); activeClipIdRef.current = clip.id; setSelectedKeyframeId(keyframe.id); seekTimeline(clip.timelineStart + keyframe.time - clip.start); }}
    />
  ));
  const audioClipNodes = useMemo(() => clips.map((clip) => <span key={clip.id} data-clip-id={clip.id} className={`audio-clip ${selectedClipId === clip.id ? "selected" : ""}`} style={{ left: timelineTimeToPixel(clip.timelineStart, timelineZoom), width: Math.max(24, timelineTimeToPixel(clip.end - clip.start, timelineZoom)) }}>{formatTime(clip.end - clip.start)}</span>), [clips, selectedClipId, timelineZoom]);
  const subtitleClipNodes = useMemo(() => visibleSubtitleBlocks.map((subtitle) => <button type="button" key={subtitle.id} className="subtitle-clip" title={subtitle.text} style={{ left: timelineTimeToPixel(subtitle.start, timelineZoom), width: Math.max(24, timelineTimeToPixel(subtitle.end - subtitle.start, timelineZoom)) }} onClick={() => seekTimeline(subtitle.start)}>{subtitle.text}</button>), [seekTimeline, timelineZoom, visibleSubtitleBlocks]);

  useEffect(() => {
    videoPreviewRefreshRef.current = handleVideoTimeUpdate;
  });

  useEffect(() => {
    if (!isVideoMedia) return;
    const video = videoRef.current;
    const activeClip = clips.find((clip) => clip.id === activeClipIdRef.current);
    if (
      video
      && activeClip
      && video.currentTime >= activeClip.start
      && video.currentTime < activeClip.end - 0.03
    ) {
      videoPreviewRefreshRef.current(video.currentTime);
    }
  }, [clips, isVideoMedia, selectedClipId]);

  useEffect(() => {
    if (!isPlaying || !isVideoMedia) return;
    let animationFrame = 0;
    const updatePlayhead = () => {
      const video = videoRef.current;
      if (video && !video.paused) {
        const activeClip = clips.find((clip) => clip.id === activeClipIdRef.current)
          ?? clips.find((clip) => video.currentTime >= clip.start && video.currentTime < clip.end);
        const timelineTime = activeClip
          ? activeClip.timelineStart + video.currentTime - activeClip.start
          : currentTimeRef.current;
        timelineScrollRef.current?.style.setProperty("--playhead-x", `${timelineTimeToPixel(timelineTime, timelineZoom)}px`);
      }
      animationFrame = window.requestAnimationFrame(updatePlayhead);
    };
    animationFrame = window.requestAnimationFrame(updatePlayhead);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [clips, isPlaying, isVideoMedia, timelineZoom]);

  useEffect(() => {
    const viewport = timelineScrollRef.current;
    if (!viewport) return;
    const updateSize = () => setTimelineViewport((current) =>
      current.width === viewport.clientWidth
        ? current
        : { left: viewport.scrollLeft, width: viewport.clientWidth }
    );
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      if (timelineScrollFrameRef.current) window.cancelAnimationFrame(timelineScrollFrameRef.current);
    };
  }, [isVideoMedia]);

  useEffect(() => {
    if (videoPreviewTimeRef.current) {
      videoPreviewTimeRef.current.textContent = `${formatTime(currentTime)} / ${formatTime(videoDuration)}`;
    }
    if (playheadRangeRef.current) {
      playheadRangeRef.current.value = String(Math.min(currentTime, timelineDuration || 0));
    }
    if (playheadOutputRef.current) playheadOutputRef.current.textContent = formatTime(currentTime);
  }, [currentTime, timelineDuration, videoDuration]);

  function navigateWorkflow(step: number) {
    if (step > completedStep + 1) return;
    setWorkflowStep(step);
    const target = step <= 2 ? document.getElementById("upload-panel") : step === 3 ? document.getElementById("editor") : exportSelectRef.current;
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: "smooth", block: step === 4 ? "center" : "start" });
      if (step === 4) window.setTimeout(() => exportSelectRef.current?.focus(), 350);
    }
  }

  const isComplete = job?.status === "completed" || job?.status === "ready_for_review";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#workspace" aria-label="KaraokeText AI home">
          <span className="brand-mark"><AudioLines size={21} strokeWidth={2.2} /></span>
          <span>KaraokeText<span className="brand-ai">AI</span></span>
        </a>
        <div className="workspace-switcher">
          <span className="workspace-avatar">S</span>
          <span className="workspace-copy"><strong>Studio workspace</strong><small>Free plan</small></span>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          <button className="nav-item active" type="button" onClick={startNewWorkspace} disabled={busy || saving} title="Save this workspace and start a new conversion"><Plus size={17} /> New conversion</button>
          <a className="nav-item" href="#sync"><Activity size={17} /> Sync lyrics</a>
          <a className="nav-item" href="#editor"><FileText size={17} /> Subtitle editor</a>
          <a className="nav-item" href="#preview"><Clapperboard size={17} /> Karaoke preview</a>
          <a className="nav-item" href="#saved-projects"><FolderOpen size={17} /> My projects <span className="nav-count">{projects.length}</span></a>
        </nav>
        {projects.length > 0 && <div className="saved-project-list" id="saved-projects" aria-label="Saved workspaces">{projects.map((saved) => <div className={`saved-project-row ${project?.id === saved.id ? "selected" : ""}`} key={saved.id}><button className="saved-project-link" type="button" onClick={() => void openSavedProject(saved.id)} disabled={busy || saving} title={`Open ${saved.title}`}>{saved.title}</button><button className="delete-project-button" type="button" aria-label={`Delete ${saved.title}`} title={`Delete ${saved.title}`} disabled={busy || saving} onClick={() => { setError(""); setDeleteTarget(saved); }}><Trash2 size={13} /></button></div>)}</div>}
        <div className="sidebar-bottom">
          <div className="privacy-note"><span className="privacy-dot" /><span><strong>Your audio stays private</strong><small>Files are stored securely for processing.</small></span></div>
          <a className="nav-item" href="#settings"><Settings2 size={17} /> Settings</a>
          <a className="nav-item" href="#help"><CircleHelp size={17} /> Help center</a>
          <div className="profile-row"><span className="profile-avatar">VT</span><span className="workspace-copy"><strong>My account</strong><small>Local workspace</small></span><ChevronDown size={15} /></div>
        </div>
      </aside>

      <section className="main-area" id="workspace">
        <header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <strong>{project?.title ?? "New conversion"}</strong></div><div className="topbar-right"><span className={`status-indicator ${apiAvailable ? "api-online" : apiAvailable === false ? "api-offline" : ""}`}><span />{isStaticDemo ? "Frontend demo only" : apiAvailable ? "API connected" : apiAvailable === false ? "API unavailable" : "Checking API"}</span><button className="icon-button" aria-label="Settings"><Settings2 size={18} /></button></div></header>
        <div className="content-wrap">
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> AUDIO WORKSPACE</div><h1>Turn every song into <span>timed lyrics.</span></h1><p>Transcribe a track or align lyrics you already have. Review the timing, then export for your next edit.</p></div><button className="text-action" type="button" onClick={() => document.getElementById("sync")?.scrollIntoView({ behavior: "smooth" })}><FileText size={16} /> Sync existing lyrics</button></div>
          {isStaticDemo && <div className="static-demo-notice" role="note">Frontend demo hosted on GitHub Pages only. Upload, transcription, project saving, and exports need a separately hosted API and worker.</div>}

          <div className="workflow-strip" aria-label="Conversion workflow">
            {[
              { step: 1, title: "Upload media" },
              { step: 2, title: "Transcribe" },
              { step: 3, title: "Review timing" },
              { step: 4, title: "Export" },
            ].map(({ step, title }, index) => {
              const isCompleted = completedStep >= step;
              const isCurrent = workflowStep === step;
              const isLocked = step > completedStep + 1;
              return (
                <Fragment key={step}>
                  <button
                    type="button"
                    className={`workflow-step ${isCurrent ? "current" : ""} ${isCompleted ? "completed" : ""} ${isLocked ? "locked" : ""}`}
                    aria-current={isCurrent ? "step" : undefined}
                    disabled={isLocked}
                    title={isLocked ? `Complete step ${step - 1} first` : `Go to step ${step}: ${title}`}
                    onClick={() => navigateWorkflow(step)}
                  >
                    <span>{isCompleted ? <Check size={11} /> : String(step).padStart(2, "0")}</span>
                    <strong>{title}</strong>
                  </button>
                  {index < 3 && <i className={completedStep >= step ? "workflow-connector completed" : "workflow-connector"} />}
                </Fragment>
              );
            })}
          </div>

          <div className="work-grid">
            <section className="panel upload-panel" id="upload-panel" aria-labelledby="upload-title">
              <div className="panel-heading"><div className="heading-icon"><Upload size={18} /></div><div><h2 id="upload-title">Add your audio or video</h2><p>Choose a track to begin a new lyric transcript.</p></div><span className="step-tag">STEP 01</span></div>
              <div className={`dropzone ${isDragging ? "dragging" : ""} ${file ? "has-file" : ""}`} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={onDrop}>
                <input ref={inputRef} type="file" accept={supportedFormats} onChange={onFileChange} hidden aria-label="Choose an audio or video file" />
                {file || project?.asset_id ? <div className="file-selected"><span className="file-icon"><FileAudio2 size={22} /></span><span className="file-copy"><strong>{file?.name ?? project?.title}</strong><small>{file ? `${formatSize(file.size)} · Browser preview ready` : "Saved project audio · Ready to process"}</small></span><button className="icon-button remove-file" aria-label="Remove audio" onClick={() => { setFile(null); setAudioUrl(undefined); if (!project?.id) setJob(null); }}><X size={17} /></button></div> : <><span className="upload-symbol"><Upload size={21} /></span><strong className="drop-title">Drop your track here</strong><span className="drop-subtitle">or <button type="button" className="browse-link" onClick={() => inputRef.current?.click()}>browse files</button> from your device</span><span className="file-limit">MP3, WAV, OGG, FLAC, M4A, AAC, MP4, MOV, WebM, MKV, AVI <i /> SERVER STORAGE / HOST LIMITS APPLY</span></>}
              </div>
              {(file || audioUrl) && !isVideoMedia && <div className="audio-preview"><button className="play-button" type="button" onClick={togglePlayback} aria-label={isPlaying ? "Pause preview" : "Play preview"}>{isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><div className="preview-track"><div className="preview-track-top"><span>{file ? "LOCAL AUDIO PREVIEW" : "SAVED AUDIO PREVIEW"}</span><span ref={audioPreviewTimeRef}>{formatTime(currentTime)}{audioRef.current?.duration ? ` / ${formatTime(audioRef.current.duration)}` : ""}</span></div><input ref={audioSeekRangeRef} aria-label="Seek audio" className="seek-range" type="range" min="0" max="100" defaultValue="0" onChange={(event) => { if (audioRef.current) audioRef.current.currentTime = Number(event.target.value); }} /></div><Headphones size={17} className="headphone-icon" /><audio ref={audioRef} src={audioUrl} /></div>}
              <div className="settings-row">
                <label className="select-field"><Languages size={16} /><span><small>TRANSCRIPTION MODE</small><select value={transcriptionMode} onChange={(event) => setTranscriptionMode(event.target.value as "auto" | "selected" | "multilingual")}><option value="auto">Auto detect language</option><option value="selected">Use selected language</option><option value="multilingual">Mixed-language (best effort)</option></select></span><ChevronDown size={14} /></label>
                <label className="select-field"><Languages size={16} /><span><small>EXPECTED LANGUAGE</small><select value={language} disabled={transcriptionMode !== "selected" || !transcriptionCapabilities} onChange={(event) => setLanguage(event.target.value)}><option value="">Choose language</option>{transcriptionCapabilities?.languages.map((option) => <option value={option.code} key={option.code}>{option.name}</option>)}</select></span><ChevronDown size={14} /></label>
                <label className="select-field"><WandSparkles size={16} /><span><small>WHISPER MODEL</small><select value={model} onChange={(event) => setModel(event.target.value)}>{(transcriptionCapabilities?.models ?? [{ id: "small", name: "Small", tradeoff: "Balanced speed and resource use." }, { id: "medium", name: "Medium", tradeoff: "Higher resource use." }, { id: "large-v3", name: "Large v3", tradeoff: "Highest resource use." }]).map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}</select></span><ChevronDown size={14} /></label>
              </div>
              <p className="transcription-mode-hint">{transcriptionMode === "selected"
                ? language
                  ? `The selected language code is sent to faster-whisper. ${transcriptionCapabilities?.languages.find((option) => option.code === language)?.script ?? ""} script is preserved; no translation is applied.`
                  : "Choose an expected language before starting a job."
                : transcriptionMode === "multilingual"
                  ? `No language hint is forced. ${transcriptionCapabilities?.mixed_language_detection ?? "Mixed-language detection is best effort; detected language is recording-level, not per-segment."}`
                  : "Automatic language detection uses the model's recording-level estimate. Song vocals may need review."}
                {capabilityError && <span role="alert"> Language/model options could not be loaded: {capabilityError}</span>}
              </p>
              {transcriptionCapabilities?.models.find((option) => option.id === model) && <p className="transcription-model-hint">{transcriptionCapabilities.models.find((option) => option.id === model)?.tradeoff} Model weights load locally on first use; availability depends on host resources and network/cache.</p>}
              {error && job?.status !== "failed" && <div className="error-message" role="alert"><X size={16} />{error}</div>}
              {job && <div className={`job-status ${job.status === "failed" ? "job-failed" : ""}`} role="status">{job.status === "failed" ? <X size={16} /> : busy || !isComplete ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}<span><strong>{job.stage ?? job.status.replaceAll("_", " ")}</strong><small>{job.status === "failed" ? job.error : job.progress != null ? `${Math.round(job.progress)}% complete${job.elapsed_seconds != null ? ` · ${formatElapsed(job.elapsed_seconds)}` : ""}` : "Your transcript is ready to review."}</small>{job.status !== "failed" && job.progress != null && job.progress >= 35 && <small className="job-hint">{job.model_size === "large-v3" ? "Large v3 can take several minutes on CPU; progress updates as segments are recognized." : "Recognition progress updates as audio segments are processed."}</small>}</span>{job.status !== "failed" && job.progress != null && <span className="job-progress"><i style={{ width: `${Math.min(100, job.progress)}%` }} /></span>}</div>}
              {job?.transcript && <div className="transcription-details" role="note">
                <strong>Recognition details</strong>
                <span>Detected language: {transcriptionCapabilities?.languages.find((option) => option.code === job.transcript?.language)?.name ?? job.transcript.language ?? "Not reported"}{job.transcript.language_probability !== undefined ? ` · model estimate ${(job.transcript.language_probability * 100).toFixed(0)}% (not calibrated accuracy)` : ""}</span>
                {job.transcript.requested_language && <span>Language hint: {transcriptionCapabilities?.languages.find((option) => option.code === job.transcript?.requested_language)?.name ?? job.transcript.requested_language}</span>}
                <span>Mode: {job.transcript.language_mode ?? transcriptionMode} · Model: {job.transcript.model_size ?? job.model_size ?? model}</span>
                <span>{job.transcript.audio_preprocessing ?? "Audio decoded to mono 16 kHz; no vocal isolation or denoising."}</span>
                <span>{job.transcript.word_timestamps_available ? "Model word timestamps available." : "Word timestamps unavailable; line-level text remains editable."}</span>
                {job.transcript.alignment_method && <span>Alignment: {job.transcript.alignment_method}</span>}
              </div>}
              <button className="primary-button" type="button" onClick={startTranscription} disabled={(!file && !project?.asset_id) || busy || (transcriptionMode === "selected" && !language)}><WandSparkles size={17} />{busy ? "Processing track..." : "Transcribe lyrics"}<span>→</span></button>
              <div className="upload-footnote"><Check size={14} /> Original language preserved <span /> No automatic translation</div>
            </section>

            <section className="panel transcript-panel" id="editor" aria-labelledby="transcript-title"><div className="panel-heading transcript-heading"><div className="heading-icon muted"><FileText size={18} /></div><div><h2 id="transcript-title">Transcript preview</h2><p>{isComplete ? `${transcript.length} lines · ${job?.transcript?.language ?? "Language detected"}` : "Lyrics will appear here after processing."}</p></div><button className="more-button" aria-label="Transcript options" disabled={!isComplete}><span>•••</span></button></div>
              {transcript.length ? <><div className="lyrics-list" ref={lyricsListRef}>{transcript.map((segment, index) => <div data-lyric-index={index} className={`lyric-row ${currentTime >= segment.start && currentTime <= segment.end ? "lyric-active" : ""}`} key={`${segment.start}-${index}`}><button className="lyric-time" type="button" onClick={() => { if (audioRef.current) { audioRef.current.currentTime = segment.start; void audioRef.current.play(); } }}>{formatTime(segment.start)}</button><input className="lyric-text" aria-label={`Edit lyric line ${index + 1}`} value={editedSegments[index]?.text ?? segment.text} onChange={(event) => setEditedSegments((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} /><span className={`lyric-confidence ${segment.status === "aligned" ? "" : "needs-review"}`} title={segment.alignment ? `${segment.alignment.matched_units ?? segment.alignment.matched_words ?? 0}/${segment.alignment.total_units ?? segment.alignment.total_words ?? 0} ${segment.alignment.unit ?? "words"} matched` : "Recognized text; review recommended"}>{segment.status === "aligned" ? <Check size={13} /> : <CircleHelp size={13} />}</span></div>)}</div>{job?.transcript?.diagnostics?.unmatched_lines?.length ? <div className="alignment-diagnostics"><strong>{job.transcript.diagnostics.unmatched_lines.length} lines need manual timing</strong><ul>{job.transcript.diagnostics.unmatched_lines.slice(0, 5).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>{job.transcript.diagnostics.unmatched_lines.length > 5 && <small>And {job.transcript.diagnostics.unmatched_lines.length - 5} more...</small>}</div> : null}</> : <div className="transcript-empty"><div className="empty-graphic"><span className="empty-disc"><Music2 size={24} /></span><span className="empty-wave wave-one" /><span className="empty-wave wave-two" /><span className="empty-wave wave-three" /></div><strong>{job?.status === "failed" ? "Transcript unavailable" : "Your lyrics, in time"}</strong><p>{job?.status === "failed" ? "Fix the processing issue and try again." : "Upload a track to see recognized lyrics and their timestamps. You can review and adjust every line."}</p><div className="empty-features"><span><Clock3 size={14} /> Line timing</span><span><AudioLines size={14} /> Audio sync</span></div></div>}
              <div className="transcript-footer"><span><span className={`connection-dot ${isComplete ? "connected" : ""}`} />{project ? "Saved project" : isComplete ? "Ready for review" : "Waiting for audio"}</span>{project ? <div className="editor-actions"><button type="button" onClick={saveEdits} disabled={saving}>{saving ? "Saving..." : "Save edits"}</button><select ref={exportSelectRef} aria-label="Export subtitles" defaultValue="" onChange={(event) => { if (event.target.value) void exportProject(event.target.value); }}><option value="" disabled>Export...</option><option value="srt">SRT</option><option value="vtt">VTT</option><option value="lrc">LRC</option><option value="txt">TXT</option><option value="json">JSON</option></select></div> : <button type="button" disabled={!isComplete}>Open editor <span>→</span></button>}</div>
            </section>
          </div>

          {isVideoMedia && <section className="video-editor panel" id="preview" aria-labelledby="video-editor-title">
            <header className="video-editor-heading" data-history-version={historyVersion}>
              <div><div className="eyebrow"><span className="eyebrow-line" /> VIDEO EDITOR</div><h2 id="video-editor-title">Karaoke video preview</h2><p>Trim and arrange source ranges; subtitle times are remapped to the final cut.</p></div>
              <div className="video-editor-actions">
                <button type="button" className="secondary-button timeline-history-button" onClick={undoClips} disabled={clipHistoryRef.current.past.length === 0} title="Undo (Ctrl+Z)" aria-label="Undo video edit"><Undo2 size={15} /></button>
                <button type="button" className="secondary-button timeline-history-button" onClick={redoClips} disabled={clipHistoryRef.current.future.length === 0} title="Redo (Ctrl+Y)" aria-label="Redo video edit"><Redo2 size={15} /></button>
                <button type="button" className="secondary-button" onClick={saveEdits} disabled={!project || saving} title="Save edits (Ctrl/Cmd+S)">{saving ? "Saving..." : "Save edits"}</button>
                <button type="button" className="primary-button video-export-button" onClick={() => void renderVideo()} disabled={videoExporting || (!file && !project?.asset_id)}><VideoIcon size={16} />{videoExporting ? "Rendering..." : "Export MP4"}</button>
              </div>
            </header>
            <div className="video-editor-layout">
              <div className="video-preview-wrap">
                <canvas ref={transitionCanvasRef} className="transition-frame" style={{ aspectRatio: previewAspectRatio.replace(":", " / ") }} aria-hidden="true" />
                <video
                  ref={videoRef}
                  className="video-preview"
                  style={{ aspectRatio: previewAspectRatio.replace(":", " / "), visibility: playheadInGap ? "hidden" : "visible" }}
                  src={audioUrl}
                  crossOrigin="anonymous"
                  playsInline
                  onLoadedMetadata={(event) => {
                    const duration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
                    const initialClip: VideoClip = { id: crypto.randomUUID(), start: 0, end: duration, timelineStart: 0 };
                    setVideoDuration(duration);
                    setClips((previous) => previous.length || !duration ? previous : [initialClip]);
                    setSelectedClipId((previous) => previous || clips[0]?.id || initialClip.id);
                    activeClipIdRef.current = clips[0]?.id ?? initialClip.id;
                    setCurrentTime(0);
                    currentTimeRef.current = 0;
                    updatePlayheadInGap(false);
                  }}
                  onTimeUpdate={(event) => handleVideoTimeUpdate(event.currentTarget.currentTime)}
                  onSeeked={(event) => videoPreviewRefreshRef.current(event.currentTarget.currentTime)}
                  onError={() => setError("This browser cannot preview the selected video codec. Try MP4/H.264 or use a browser-supported source format.")}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                />
                <div ref={videoLyricOverlayRef} className="video-lyric-overlay" aria-live="polite">{activeLyric?.text ?? ""}</div>
                <div className="video-preview-meta"><span><VideoIcon size={13} /> {file?.name ?? project?.title ?? "Video source"}</span><span ref={videoPreviewTimeRef}>{formatTime(currentTime)} / {formatTime(videoDuration)}</span></div>
                <div className="video-preview-toolbar">
                  <button type="button" className="secondary-button" onClick={() => seekTimeline(Math.max(0, currentTimeRef.current - 5))}>−5 sec</button>
                  <button type="button" className="secondary-button" onClick={() => {
                    if (videoRef.current?.paused) {
                      if (playheadInGap || !clips.some((clip) => currentTimeRef.current >= clip.timelineStart && currentTimeRef.current < clip.timelineStart + clip.end - clip.start)) {
                        const nextClip = [...clips].sort((a, b) => a.timelineStart - b.timelineStart).find((clip) => clip.timelineStart >= currentTimeRef.current);
                        if (nextClip) seekTimeline(nextClip.timelineStart);
                      }
                      void videoRef.current.play();
                    } else videoRef.current?.pause();
                  }}>{isPlaying ? "Pause" : "Play"}</button>
                  <button type="button" className="secondary-button" onClick={() => seekTimeline(Math.min(timelineDuration, currentTimeRef.current + 5))}>+5 sec</button>
                  <label>Speed <select aria-label="Video playback speed" defaultValue="1" onChange={(event) => { if (videoRef.current) videoRef.current.playbackRate = Number(event.target.value); }}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
                  <label>FPS <select aria-label="Timeline frame rate" value={frameRate} onChange={(event) => setFrameRate(Number(event.target.value))}><option value="23.976">23.976</option><option value="24">24</option><option value="25">25</option><option value="29.97">29.97</option><option value="30">30</option><option value="50">50</option><option value="59.94">59.94</option><option value="60">60</option></select></label>
                  <label>Aspect <select aria-label="Preview aspect ratio" value={previewAspectRatio} onChange={(event) => setPreviewAspectRatio(event.target.value)}><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="4:3">4:3</option></select></label>
                </div>
              </div>
              <aside className="video-edit-controls" aria-label="Video edit controls">
                <div className="video-control-heading"><strong>{selectedClip ? "Clip Properties" : "Project Properties"}</strong><span className="property-heading-actions">{selectedClip ? formatTime(selectedClip.end - selectedClip.start) : "No clip selected"}<button type="button" className="property-settings-button" aria-label="Toggle advanced clip tools" aria-pressed={showAdvancedTools} onClick={() => setShowAdvancedTools((visible) => !visible)}><Settings2 size={16} /></button></span></div>
                <div className="property-tabs" role="tablist" aria-label="Clip property sections">
                  <button type="button" role="tab" aria-selected={propertyTab === "Basic"} className={propertyTab === "Basic" ? "active" : ""} onClick={() => setPropertyTab("Basic")}><SlidersHorizontal size={16} /><span>Basic</span></button>
                  <button type="button" role="tab" aria-selected={propertyTab === "Effects"} className={propertyTab === "Effects" ? "active" : ""} onClick={() => setPropertyTab("Effects")}><Sparkles size={16} /><span>Effects</span></button>
                  <button type="button" role="tab" aria-selected={propertyTab === "Transitions"} className={propertyTab === "Transitions" ? "active" : ""} onClick={() => setPropertyTab("Transitions")}><Film size={16} /><span>Transitions</span></button>
                  <button type="button" role="tab" aria-selected={propertyTab === "Keyframes"} className={propertyTab === "Keyframes" ? "active" : ""} onClick={() => setPropertyTab("Keyframes")}><Diamond size={16} /><span>Keyframes</span></button>
                </div>
                {showAdvancedTools && <div className="property-secondary-tools" aria-label="More clip tools">
                  {(["Animation", "Color", "Transform"] as const).map((tool) => <button type="button" className={propertyTab === tool ? "active" : ""} key={tool} onClick={() => setPropertyTab(tool)}>{tool}</button>)}
                </div>}
                {propertyTab === "Basic" && <>
                  {selectedClip ? <>
                    <label className="video-number-field"><span>Source start (seconds)</span><input aria-label="Clip start time in seconds" type="number" min="0" max={selectedClip.end - 1 / frameRate} step={1 / frameRate} value={selectedClip.start.toFixed(3)} onChange={(event) => setSelectedClipEdge("start", Number(event.target.value))} /></label>
                    <label className="video-number-field"><span>Source end (seconds)</span><input aria-label="Clip end time in seconds" type="number" min={selectedClip.start + 1 / frameRate} max={videoDuration || undefined} step={1 / frameRate} value={selectedClip.end.toFixed(3)} onChange={(event) => setSelectedClipEdge("end", Number(event.target.value))} /></label>
                    <div className="video-edit-buttons">
                      <button className="secondary-button" type="button" onClick={splitSelectedClip}><Scissors size={14} /> Split at playhead</button>
                      <button className="secondary-button" type="button" onClick={() => removeSelectedClip(false)} disabled={clips.length <= 1}><Trash2 size={14} /> Delete (leave gap)</button>
                      <button className="secondary-button" type="button" onClick={() => removeSelectedClip(true)} disabled={clips.length <= 1}><Trash2 size={14} /> Ripple delete</button>
                    </div>
                    <button className="secondary-button reset-video-trim" type="button" onClick={() => {
                      if (videoDuration) {
                        const resetClip: VideoClip = { id: crypto.randomUUID(), start: 0, end: videoDuration, timelineStart: 0 };
                        commitClips([resetClip]);
                        setSelectedClipId(resetClip.id);
                        activeClipIdRef.current = resetClip.id;
                        setCurrentTime(0);
                        currentTimeRef.current = 0;
                        updatePlayheadInGap(false);
                        if (videoRef.current) videoRef.current.currentTime = 0;
                      }
                    }}>Reset to original</button>
                  </> : <p className="video-editor-hint">Select a video clip to edit its properties. Project-wide subtitle and export settings remain available below.</p>}
                  <label className="video-option"><input type="checkbox" checked={burnSubtitles} onChange={(event) => setBurnSubtitles(event.target.checked)} /><span>Burn subtitles into video</span></label>
                  {burnSubtitles && <label className="video-number-field"><span>Subtitle font size</span><input type="number" min="12" max="72" value={fontSize} onChange={(event) => setFontSize(Math.min(72, Math.max(12, Number(event.target.value) || 24)))} /></label>}
                  <p className="video-editor-hint">MP4 rendering uses FFmpeg on the API host.</p>
                </>}
                {propertyTab === "Effects" && (selectedClip ? <>
                  <div className="property-section-heading"><h3>Effects applied</h3><span>{selectedClip.effects?.length ?? 0}</span></div>
                  <div className="effect-stack-tools">
                    <button type="button" onClick={resetAllEffects} disabled={!selectedClip.effects?.length}>Reset all</button>
                    <button type="button" onClick={copyEffectStack} disabled={!selectedClip.effects?.length}>Copy stack</button>
                  </div>
                  <div className="effect-stack">{(selectedClip.effects ?? []).map((effect, index) => {
                    const definition = EFFECT_REGISTRY[effect.type];
                    const effectName = effect.name ?? definition?.name ?? String(effect.type);
                    const supported = !!definition;
                    const expanded = activeSelectedEffectId === effect.id;
                    const summary = effect.type === "blur" ? `Blur radius · ${effect.intensity.toFixed(0)} px`
                      : effect.type === "brightness" ? `Brightness · ${effect.intensity >= 0 ? "+" : ""}${Math.round(effect.intensity * 100)}%`
                      : effect.type === "contrast" || effect.type === "saturation" ? `${effect.type[0].toUpperCase() + effect.type.slice(1)} · ${Math.round(effect.intensity * 100)}%`
                      : supported ? `Intensity · ${Math.round(effect.intensity * 100)}%` : "Unsupported effect · excluded from preview and export";
                    return <div
                      className={`effect-card ${expanded ? "selected" : ""} ${!effect.enabled ? "disabled" : ""} ${draggedEffectId === effect.id ? "dragging" : ""}`}
                      key={effect.id}
                      draggable={supported}
                      onDragStart={(event) => {
                        setDraggedEffectId(effect.id);
                        event.dataTransfer.setData("text/plain", effect.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDraggedEffectId("")}
                      onDragOver={(event) => {
                        if (draggedEffectId && draggedEffectId !== effect.id) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const sourceId = event.dataTransfer.getData("text/plain") || draggedEffectId;
                        if (sourceId) reorderEffect(sourceId, effect.id);
                        setDraggedEffectId("");
                      }}
                    >
                      <div className="effect-card-main">
                        <button type="button" className="effect-select-button" aria-expanded={expanded} onClick={() => setSelectedEffectId(expanded ? "" : effect.id)}>
                          <span className="effect-icon"><Sparkles size={16} /></span><span className="effect-copy"><strong>{effectName}</strong><small>{summary}</small></span>
                        </button>
                        <div className="effect-actions">
                          <button type="button" className={`effect-toggle ${effect.enabled ? "on" : ""}`} title={effect.enabled ? "Disable effect" : "Enable effect"} aria-label={`${effect.enabled ? "Disable" : "Enable"} ${effectName}`} aria-pressed={effect.enabled} onClick={() => updateEffect(effect.id, { enabled: !effect.enabled })}>{effect.enabled ? <Check size={13} /> : <span>○</span>}</button>
                          <button type="button" className="effect-delete" title="Remove effect" aria-label={`Remove ${effectName}`} onClick={() => { updateSelectedClipData({ effects: (selectedClip.effects ?? []).filter((item) => item.id !== effect.id) }); if (selectedEffectId === effect.id) setSelectedEffectId(""); }}><Trash2 size={13} /></button>
                        </div>
                      </div>
                      {expanded && supported && <div className="effect-controls">
                        <label className="effect-intensity"><span>Intensity</span><output>{effect.intensity.toFixed(2)}{effect.type === "blur" ? " px" : ""}</output>
                          <input
                            type="range"
                            aria-label={`${effectName} intensity`}
                            min={definition.min}
                            max={definition.max}
                            step={definition.step}
                            value={effect.intensity}
                            onPointerDown={() => beginEffectIntensityGesture(selectedClip, effect)}
                            onInput={(event) => previewEffectIntensity(selectedClip, effect, Number(event.currentTarget.value), event.currentTarget)}
                            onPointerUp={commitEffectIntensityGesture}
                            onPointerCancel={commitEffectIntensityGesture}
                            onKeyDown={() => beginEffectIntensityGesture(selectedClip, effect)}
                            onKeyUp={commitEffectIntensityGesture}
                            onBlur={commitEffectIntensityGesture}
                          />
                        </label>
                        <div className="effect-utility-actions">
                          <button type="button" onClick={() => resetEffect(effect.id)}>Reset</button>
                          <button type="button" onClick={() => copyEffect(effect)}>Copy</button>
                          <button type="button" onClick={() => duplicateEffect(effect.id)} disabled={!definition.allowMultiple}>Duplicate</button>
                          <button type="button" disabled={index === 0} onClick={() => reorderEffect(effect.id, selectedClip.effects?.[index - 1]?.id ?? effect.id)} aria-label="Move effect up">↑</button>
                          <button type="button" disabled={index === (selectedClip.effects?.length ?? 0) - 1} onClick={() => reorderEffect(effect.id, selectedClip.effects?.[index + 1]?.id ?? effect.id)} aria-label="Move effect down">↓</button>
                        </div>
                      </div>}
                    </div>;
                  })}</div>
                  {!selectedClip.effects?.length && <p className="video-editor-hint">No effects applied to this clip yet.</p>}
                  <div className="effect-library-actions"><button type="button" className="secondary-button" onClick={() => setEffectLibraryOpen(true)} disabled={!selectedClip}><Plus size={14} /> Add Effect</button><button type="button" className="secondary-button" disabled={!effectClipboard.length} onClick={pasteEffect}>Paste Effects ({effectClipboard.length})</button></div>
                  {effectLibraryOpen && <div className="effect-library-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEffectLibraryOpen(false); }}>
                    <section className="effect-library-dialog" role="dialog" aria-modal="true" aria-labelledby="effect-library-title">
                      <div className="effect-library-header"><div><h3 id="effect-library-title">Effects Library</h3><p>Choose an effect for this clip only.</p></div><button type="button" className="icon-button" aria-label="Close effects library" onClick={() => setEffectLibraryOpen(false)}><X size={16} /></button></div>
                      <label className="effect-library-search"><span className="sr-only">Search effects</span><input autoFocus value={effectSearch} onChange={(event) => setEffectSearch(event.target.value)} placeholder="Search effects…" /><span><Activity size={14} /></span></label>
                      <div className="effect-library-categories">{(["All", "Color & Light", "Blur & Focus", "Cinematic Looks"] as const).map((category) => <button key={category} type="button" className={effectCategory === category ? "active" : ""} onClick={() => setEffectCategory(category)}>{category}</button>)}</div>
                      <div className="effect-library-list">{filteredEffectCatalog.map((effect) => <button type="button" className="effect-library-option" key={effect.type} onClick={() => addEffectPreset(effect.type)}>
                        <span className={`effect-preview-tile preview-${effect.type}`}><Sparkles size={17} /></span><span><strong>{effect.name}</strong><small>{effect.description}</small><small className="effect-support">Preview: {effect.previewRenderer === "css-filter" ? "CSS filter" : "CSS overlay"} · Export: FFmpeg</small></span><Plus size={15} />
                      </button>)}
                      {!filteredEffectCatalog.length && <p className="video-editor-hint">No effects match that search.</p>}</div>
                    </section>
                  </div>}
                </> : <p className="video-editor-hint">Select a video clip before adding effects.</p>)}
                {propertyTab === "Transitions" && (selectedClip ? <>
                  <p className="video-editor-hint">Only the supported fades and adjacent-clip cross dissolve are listed. Transition progress is evaluated from timeline time; clip timing is unchanged.</p>
                  <label className="effect-library-search transition-search"><span className="sr-only">Search transitions</span><input value={transitionSearch} onChange={(event) => setTransitionSearch(event.target.value)} placeholder="Search transitions..." /><span><Activity size={14} /></span></label>
                  <div className="transition-library">
                    {filteredTransitions.map((transition) => {
                      const enabled = transition.edge === "in"
                        ? !!selectedClip.transitionIn
                        : transition.type === "cross-dissolve"
                          ? selectedClip.transitionOut?.type === transition.type
                          : selectedClip.transitionOut?.type === transition.type;
                      const unavailable = transition.type === "cross-dissolve" && !canCrossDissolve;
                      return <div className={`transition-option ${enabled ? "selected" : ""}`} key={transition.type}>
                        <span className="transition-preview-tile"><Film size={16} /></span>
                        <span className="transition-option-copy"><strong>{transition.name}</strong><small>{unavailable ? "Requires a directly adjacent next clip." : transition.description}</small></span>
                        <button type="button" disabled={unavailable || enabled} aria-pressed={enabled} onClick={() => {
                          if (transition.edge === "in") {
                            setTransition("transitionIn", selectedClip.transitionIn?.duration || 0.5);
                          } else if (transition.type === "cross-dissolve") {
                            setTransitionOutType("cross-dissolve");
                          } else {
                            setTransitionOutType("fade-out");
                          }
                        }}>{enabled ? "Applied" : "Add"}</button>
                      </div>;
                    })}
                    {!filteredTransitions.length && <p className="video-editor-hint">No supported transition matches that search.</p>}
                  </div>
                  {(["transitionIn", "transitionOut"] as const).map((edge) => {
                    const activeTransition = selectedClip[edge];
                    if (!activeTransition) return null;
                    const maximumDuration = Math.min(
                      2,
                      (selectedClip.end - selectedClip.start) / 2,
                    edge === "transitionOut" && activeTransition.type === "cross-dissolve" && selectedClipNext
                      ? (selectedClipNext.end - selectedClipNext.start) / 2
                        : 2,
                    );
                    return <div className="transition-duration-control" key={edge}>
                      <label className="video-number-field"><span>{edge === "transitionIn" ? "Fade in duration (seconds)" : `${activeTransition.type === "cross-dissolve" ? "Cross dissolve" : "Fade out"} duration (seconds)`}</span><input aria-label={`${edge === "transitionIn" ? "Fade in" : "Transition out"} duration`} type="number" min="0.05" max={maximumDuration} step="0.05" value={activeTransition.duration} onFocus={() => beginTransitionDurationGesture(edge)} onChange={(event) => previewTransitionDuration(edge, Number(event.target.value))} onBlur={() => finishTransitionDurationGesture()} /></label>
                      <input aria-label={`${edge === "transitionIn" ? "Fade in" : "Transition out"} duration slider`} type="range" min="0.05" max={Math.max(0.05, maximumDuration)} step="0.05" value={activeTransition.duration} onPointerDown={() => beginTransitionDurationGesture(edge)} onChange={(event) => previewTransitionDuration(edge, Number(event.target.value))} onPointerUp={() => finishTransitionDurationGesture()} onPointerCancel={() => finishTransitionDurationGesture(true)} />
                    </div>;
                  })}
                  <button type="button" className="secondary-button" disabled={!selectedClip.transitionIn && !selectedClip.transitionOut} onClick={() => updateSelectedClipData({ transitionIn: undefined, transitionOut: undefined })}>Remove clip transitions</button>
                </> : <p className="video-editor-hint">Select a video clip to edit its fade transitions.</p>)}
                {propertyTab === "Animation" && (selectedClip ? <>
                  <p className="video-editor-hint">Presets write editable, source-time keyframes to this clip.</p>
                  <div className="video-edit-buttons"><button className="secondary-button" type="button" onClick={() => applyAnimationPreset("fade-in")}>Fade In</button><button className="secondary-button" type="button" onClick={() => applyAnimationPreset("fade-out")}>Fade Out</button><button className="secondary-button" type="button" onClick={() => applyAnimationPreset("zoom-in")}>Zoom In</button><button className="secondary-button" type="button" onClick={() => applyAnimationPreset("zoom-out")}>Zoom Out</button><button className="secondary-button" type="button" onClick={() => applyAnimationPreset("slow-zoom")}>Slow Cinematic Zoom</button><button className="secondary-button" type="button" onClick={() => applyAnimationPreset("pan-left")}>Pan Left</button><button className="secondary-button" type="button" onClick={() => applyAnimationPreset("pan-right")}>Pan Right</button><button className="secondary-button" type="button" onClick={() => applyAnimationPreset("flash")}>Brightness Flash</button></div>
                </> : <p className="video-editor-hint">Select a clip to apply animation presets.</p>)}
                {propertyTab === "Keyframes" && (selectedClip ? <>
                  <div className="property-section-heading"><h3>Keyframe Animation</h3><span>{formatTime(getCurrentSourceTime(selectedClip))}</span></div>
                  {([
                    { property: "scale", label: "Scale", min: 0.1, max: 4, fallback: 1, unit: "×" },
                    { property: "position_x", label: "Position X", min: -500, max: 500, fallback: 0, unit: " px" },
                    { property: "position_y", label: "Position Y", min: -500, max: 500, fallback: 0, unit: " px" },
                    { property: "rotation", label: "Rotation", min: -360, max: 360, fallback: 0, unit: "°" },
                    { property: "opacity", label: "Opacity", min: 0, max: 1, fallback: 1, unit: "%" },
                    { property: "brightness", label: "Brightness", min: -1, max: 1, fallback: 0, unit: "" },
                  ] as const).map(({ property, label, min, max, fallback, unit }) => {
                    const sourceTime = getCurrentSourceTime(selectedClip);
                    const value = getAnimatedValue(selectedClip, property, sourceTime, fallback);
                    const propertyKeyframes = (selectedClip.keyframes ?? []).filter((keyframe) => keyframe.property === property).sort((a, b) => a.time - b.time);
                    const current = propertyKeyframes.find((keyframe) => Math.abs(keyframe.time - sourceTime) < 1 / frameRate / 2);
                    const previous = [...propertyKeyframes].reverse().find((keyframe) => keyframe.time < sourceTime - 1 / frameRate / 2);
                    const next = propertyKeyframes.find((keyframe) => keyframe.time > sourceTime + 1 / frameRate / 2);
                    const displayValue = property === "opacity" ? `${Math.round(value * 100)}%` : `${value.toFixed(2)}${unit}`;
                    return <div className={`keyframe-property ${current ? "has-keyframe" : ""} ${selectedKeyframe?.property === property ? "keyframe-selected" : ""}`} key={property}>
                      <span className="keyframe-property-name">{label}</span>
                      <input className="keyframe-value-input" aria-label={`${label} value`} type="number" min={min} max={max} step={property === "opacity" ? 0.01 : 0.1} value={Number(value.toFixed(2))} onChange={(event) => setKeyframe(property, Number(event.target.value))} />
                      <span className="keyframe-value-display">{displayValue}</span>
                      <div className="keyframe-row-actions">
                        <button type="button" className={`keyframe-diamond ${current ? "active" : ""}`} title={`${current ? "Remove" : "Add"} ${label} keyframe at playhead`} aria-label={`${current ? "Remove" : "Add"} ${label} keyframe`} aria-pressed={!!current} onClick={() => current ? removeCurrentKeyframe(property) : setKeyframe(property, value)}><Diamond size={15} fill={current ? "currentColor" : "none"} /></button>
                        <button type="button" title={`Previous ${label} keyframe`} aria-label={`Previous ${label} keyframe`} disabled={!previous} onClick={() => previous && seekTimeline(selectedClip.timelineStart + previous.time - selectedClip.start)}>‹</button>
                        <button type="button" title={`Next ${label} keyframe`} aria-label={`Next ${label} keyframe`} disabled={!next} onClick={() => next && seekTimeline(selectedClip.timelineStart + next.time - selectedClip.start)}>›</button>
                      </div>
                    </div>;
                  })}
                  <div className="keyframe-list-heading"><span>Clip keyframes</span><small>Source-media time · drag to retime · frame-snapped</small></div>
                  <div className="keyframe-list">{(selectedClip.keyframes ?? []).map((keyframe) => <button type="button" className={selectedKeyframeId === keyframe.id ? "selected" : ""} key={keyframe.id} onClick={() => { setSelectedKeyframeId(keyframe.id); seekTimeline(selectedClip.timelineStart + keyframe.time - selectedClip.start); }}>{keyframe.property.replace("_", " ")} · {formatTime(keyframe.time)} · {keyframe.value.toFixed(2)} · {keyframe.interpolation}</button>)}</div>
                  {selectedKeyframe && <div className="selected-keyframe-editor">
                    <div className="property-section-heading"><h3>Selected keyframe</h3><button type="button" className="secondary-button" onClick={() => {
                      updateSelectedClipData({ keyframes: (selectedClip.keyframes ?? []).filter((keyframe) => keyframe.id !== selectedKeyframe.id) });
                      setSelectedKeyframeId("");
                    }}>Remove</button></div>
                    <label className="video-number-field"><span>Source time (seconds)</span><input aria-label="Selected keyframe time" type="number" min={selectedClip.start} max={selectedClip.end} step={1 / frameRate} value={selectedKeyframe.time} onChange={(event) => updateSelectedKeyframe({ time: Number(event.target.value) })} /></label>
                    <label className="video-number-field"><span>Value</span><input aria-label="Selected keyframe value" type="number" step="0.01" value={selectedKeyframe.value} onChange={(event) => updateSelectedKeyframe({ value: Number(event.target.value) })} /></label>
                    <label className="video-number-field"><span>Interpolation to next key</span><select aria-label="Selected keyframe interpolation" value={selectedKeyframe.interpolation} onChange={(event) => updateSelectedKeyframe({ interpolation: event.target.value as KeyframeInterpolation })}><option value="linear">Linear</option><option value="hold">Hold</option><option value="ease-in">Ease In</option><option value="ease-out">Ease Out</option><option value="ease-in-out">Ease In Out</option></select></label>
                  </div>}
                </> : <p className="video-editor-hint">Select a clip to edit keyframes.</p>)}
                {propertyTab === "Color" && (selectedClip ? <>
                  <label className="video-number-field"><span>Add color adjustment</span><select aria-label="Add color adjustment" defaultValue="" onChange={(event) => { if (event.target.value) addEffect(event.target.value as EffectType); event.target.value = ""; }}><option value="" disabled>Choose an adjustment…</option><option value="brightness">Brightness</option><option value="contrast">Contrast</option><option value="saturation">Saturation</option><option value="sepia">Warm / Sepia</option><option value="grayscale">Black &amp; white</option></select></label>
                  <p className="video-editor-hint">Adjustments are non-destructive and export through FFmpeg.</p>
                </> : <p className="video-editor-hint">Select a clip to edit color.</p>)}
                {propertyTab === "Transform" && (selectedClip ? <>
                  {(["scale", "x", "y", "rotation"] as const).map((property) => <label className="video-number-field" key={property}><span>{property === "scale" ? "Scale" : property === "x" ? "Position X (px)" : property === "y" ? "Position Y (px)" : "Rotation (degrees)"}</span><input type="number" aria-label={`Transform ${property}`} min={property === "scale" ? 0.1 : undefined} max={property === "scale" ? 4 : undefined} step={property === "scale" ? 0.05 : 1} value={selectedClip.transform?.[property] ?? (property === "scale" ? 1 : 0)} onChange={(event) => updateSelectedClipData({ transform: { scale: 1, x: 0, y: 0, rotation: 0, ...selectedClip.transform, [property]: Number(event.target.value) } })} /></label>)}
                  <button className="secondary-button" type="button" onClick={() => updateSelectedClipData({ transform: { scale: 1, x: 0, y: 0, rotation: 0 } })}>Reset transform</button>
                </> : <p className="video-editor-hint">Select a clip to edit its transform.</p>)}
              </aside>
            </div>
            <div className="video-timeline">
              <div className="video-timeline-top">
                <strong>EDIT TIMELINE</strong>
                <span>{clips.length} clip{clips.length === 1 ? "" : "s"} · {formatTime(clips.reduce((total, clip) => total + clip.end - clip.start, 0))} media · {formatTime(timelineDuration)} timeline</span>
                <div className="timeline-toolbar">
                  <button type="button" className="timeline-tool-button" onClick={undoClips} disabled={clipHistoryRef.current.past.length === 0} title="Undo · Ctrl+Z" aria-label="Undo timeline edit"><Undo2 size={14} /></button>
                  <button type="button" className="timeline-tool-button" onClick={redoClips} disabled={clipHistoryRef.current.future.length === 0} title="Redo · Ctrl+Y" aria-label="Redo timeline edit"><Redo2 size={14} /></button>
                  <button type="button" className={`timeline-tool-button ${snapEnabled ? "enabled" : ""}`} onClick={() => setSnapEnabled((enabled) => !enabled)} title="Snap to playhead and clip edges" aria-pressed={snapEnabled}>Snap</button>
                  <button type="button" className="timeline-tool-button" onClick={() => zoomTimeline(timelineZoom / 1.25)} title="Zoom out (-)" aria-label="Zoom timeline out"><ZoomOut size={14} /></button>
                  <label className="timeline-zoom"><span>Zoom</span><input aria-label="Timeline zoom" type="range" min="0.01" max="240" step="0.01" value={timelineZoom} onChange={(event) => setTimelineZoom(Number(event.target.value))} /></label>
                  <button type="button" className="timeline-tool-button" onClick={() => zoomTimeline(timelineZoom * 1.25)} title="Zoom in (+)" aria-label="Zoom timeline in"><ZoomIn size={14} /></button>
                  <button type="button" className="timeline-tool-button" onClick={() => {
                    setTimelineZoom(Math.max(0.01, Math.min(240, ((timelineScrollRef.current?.clientWidth ?? 600) - 40) / Math.max(timelineDuration, 1))));
                    if (timelineScrollRef.current) timelineScrollRef.current.scrollLeft = 0;
                  }} title="Fit timeline to screen" aria-label="Fit timeline to screen">Fit</button>
                  <button type="button" className="timeline-tool-button" onClick={splitSelectedClip} disabled={!selectedClip} title="Split at playhead (S)" aria-label="Split selected clip at playhead"><Scissors size={14} /></button>
                  <button type="button" className="timeline-tool-button" disabled={!selectedClip} onClick={() => removeSelectedClip(false)} title="Delete selected clip and keep the gap"><Trash2 size={14} /></button>
                  <button type="button" className="timeline-tool-button" disabled={!selectedClip} onClick={() => removeSelectedClip(true)} title="Ripple delete selected clip"><span>Ripple</span></button>
                </div>
              </div>
              <label className="playhead-control"><span>Playhead</span><input
                ref={playheadRangeRef}
                aria-label="Video timeline playhead"
                type="range"
                min="0"
                max={timelineDuration || 1}
                step={1 / frameRate}
                defaultValue={Math.min(currentTime, timelineDuration || 0)}
                onPointerDown={(event) => { playheadScrubbingPointerRef.current = event.pointerId; }}
                onChange={(event) => seekTimeline(Number(event.target.value), playheadScrubbingPointerRef.current === null)}
                onPointerUp={(event) => {
                  if (playheadScrubbingPointerRef.current !== event.pointerId) return;
                  playheadScrubbingPointerRef.current = null;
                  seekTimeline(Number(event.currentTarget.value));
                }}
                onPointerCancel={(event) => {
                  if (playheadScrubbingPointerRef.current !== event.pointerId) return;
                  playheadScrubbingPointerRef.current = null;
                  seekTimeline(Number(event.currentTarget.value));
                }}
              /><output ref={playheadOutputRef}>{formatTime(currentTime)}</output></label>
              <div className="timeline-viewport" ref={timelineScrollRef} onScroll={() => {
                if (timelineScrollFrameRef.current) return;
                timelineScrollFrameRef.current = window.requestAnimationFrame(() => {
                  timelineScrollFrameRef.current = 0;
                  const viewport = timelineScrollRef.current;
                  if (viewport) setTimelineViewport((current) => {
                    const nextLeft = viewport.scrollLeft;
                    const thresholdPixels = Math.max(32, Math.min(160, timelineZoom * 2));
                    return current.width === viewport.clientWidth
                      && Math.abs(nextLeft - current.left) < thresholdPixels
                      ? current
                      : { left: nextLeft, width: viewport.clientWidth };
                  });
                });
              }}>
                <div className="timeline-content" style={{ width: Math.max(600, timelineTimeToPixel(timelineDuration, timelineZoom) + 40) }}>
                  <div className="timeline-ruler" onPointerDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    rulerScrubPointerRef.current = event.pointerId;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    const rect = event.currentTarget.getBoundingClientRect();
                    seekTimeline(timelinePixelToTime(event.clientX, rect.left, timelineZoom), false);
                  }} onPointerMove={(event) => {
                    if (rulerScrubPointerRef.current !== event.pointerId) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    seekTimeline(timelinePixelToTime(event.clientX, rect.left, timelineZoom), false);
                  }} onPointerUp={(event) => {
                    if (rulerScrubPointerRef.current !== event.pointerId) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    seekTimeline(timelinePixelToTime(event.clientX, rect.left, timelineZoom));
                    rulerScrubPointerRef.current = null;
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                  }} onPointerCancel={(event) => {
                    if (rulerScrubPointerRef.current !== event.pointerId) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    seekTimeline(timelinePixelToTime(event.clientX, rect.left, timelineZoom));
                    rulerScrubPointerRef.current = null;
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                  }}>
                    {timelineRulerTicks.map((tick) => <button type="button" key={tick} className="timeline-ruler-tick" style={{ left: timelineTimeToPixel(tick, timelineZoom) }} onClick={() => seekTimeline(tick)}>{formatTime(tick)}</button>)}
                  </div>
                  <div className="timeline-lanes">
                    <div className="timeline-track-header"><strong><VideoIcon size={12} /> Video 1</strong><small>Main video</small></div>
                    <div
                      className="timeline-lane video-clip-track"
                      aria-label="Main video track. Drag clips to reposition."
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const clipId = event.dataTransfer.getData("text/plain");
                        const rect = event.currentTarget.getBoundingClientRect();
                        moveClipOnTimeline(clipId, timelinePixelToTime(event.clientX - nativeClipDragOffsetRef.current, rect.left, timelineZoom));
                      }}
                    >
                      {videoClipNodes}
                      <i className="timeline-playhead" />
                    </div>
                    <div className="timeline-track-header"><strong>◇ Keyframes</strong><small>Clip source time</small></div>
                    <div className="timeline-lane keyframe-track" aria-label="Keyframe animation lane">
                      {keyframeNodes}
                      <i className="timeline-playhead" />
                    </div>
                    <div className="timeline-track-header"><strong><AudioLines size={12} /> Audio 1</strong><small>Linked source audio</small></div>
                    <div className="timeline-lane audio-clip-track" aria-label="Audio track linked to video">
                      {audioClipNodes}
                      <i className="timeline-playhead" />
                    </div>
                    <div className="timeline-track-header"><strong><FileText size={12} /> Lyrics</strong><small>Subtitles</small></div>
                    <div className="timeline-lane subtitle-clip-track" aria-label="Subtitle track">
                      {subtitleClipNodes}
                      <i className="timeline-playhead" />
                    </div>
                  </div>
                </div>
              </div>
              <label className="trim-range-field"><span>Trim selection start</span><input type="range" min="0" max={selectedClip?.end ?? videoDuration} step="0.01" value={selectedClip?.start ?? 0} onChange={(event) => updateSelectedClip({ start: Math.min(Number(event.target.value), (selectedClip?.end ?? 0) - 0.05) })} /></label>
              <label className="trim-range-field"><span>Trim selection end</span><input type="range" min={selectedClip?.start ?? 0} max={videoDuration || 1} step="0.01" value={selectedClip?.end ?? 0} onChange={(event) => updateSelectedClip({ end: Math.max(Number(event.target.value), (selectedClip?.start ?? 0) + 0.05) })} /></label>
            </div>
            {videoExportMessage && <div className="video-export-success" role="status"><Check size={15} />{videoExportMessage}</div>}
            {error && <div className="error-message" role="alert"><X size={15} />{error}</div>}
          </section>}

          <section className="lyrics-sync" id="sync"><div className="sync-heading"><span className="lower-icon"><FileText size={17} /></span><div><strong>Already have the lyrics?</strong><small>Use your text as the source; only words matched to audio receive timestamps.</small></div><button className="secondary-button" type="button" onClick={() => lyricsInputRef.current?.click()}><Plus size={16} /> Choose TXT</button><input ref={lyricsInputRef} type="file" accept=".txt,text/plain" hidden onChange={async (event) => { const selected = event.target.files?.[0]; if (selected) setLyricsText(await selected.text()); event.target.value = ""; }} /></div><textarea className="lyrics-input" aria-label="Existing lyrics" placeholder="Paste lyrics here, or choose a TXT file. Section labels in [brackets] are ignored." value={lyricsText} onChange={(event) => setLyricsText(event.target.value)} /><div className="sync-actions"><span>{lyricsText.trim() ? `${lyricsText.trim().split(/\s+/).length} words ready` : "Select an audio track above first"}</span><button className="secondary-button" type="button" disabled={(!file && !project?.asset_id) || !lyricsText.trim() || busy || (transcriptionMode === "selected" && !language)} onClick={startAlignment}><Activity size={15} />{busy ? "Aligning..." : "Align lyrics to audio"}</button></div></section>
          <footer className="app-footer"><span>© 2026 KaraokeText AI</span><span><span className="footer-status" /> Secure processing <i /> UTF-8 lyric export</span><a href="#privacy">Privacy</a></footer>
        </div>
      </section>
      {deleteTarget && <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDeleteTarget(null); }}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description"><div className="confirm-icon"><Trash2 size={18} /></div><h2 id="delete-title">Delete saved workspace?</h2><p id="delete-description"><strong>{deleteTarget.title}</strong> will be permanently deleted. Its audio is removed only if no other workspace uses it.</p>{error && <div className="error-message" role="alert"><X size={15} />{error}</div>}<div className="confirm-actions"><button type="button" className="secondary-button" onClick={() => { setDeleteTarget(null); setError(""); }} disabled={saving}>Cancel</button><button type="button" className="danger-button" onClick={() => void deleteSavedProject(deleteTarget)} disabled={saving}>{saving ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}{saving ? "Deleting..." : "Delete workspace"}</button></div></section></div>}
    </main>
  );
}
