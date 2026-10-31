import json


def timestamp(seconds: float, decimal_separator: str = ",") -> str:
    if seconds < 0:
        raise ValueError("Timestamp cannot be negative.")
    milliseconds = round(seconds * 1000)
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{whole_seconds:02}{decimal_separator}{millis:03}"


def validate_segments(segments: list[dict], allow_overlaps: bool = False) -> None:
    previous_start = -1.0
    previous_end = -1.0
    for segment in segments:
        start, end = float(segment["start"]), float(segment["end"])
        if start < 0 or end <= start:
            raise ValueError("Every subtitle must have a non-negative start earlier than its end.")
        if start < previous_start:
            raise ValueError("Subtitle segments must be ordered by start time.")
        if not allow_overlaps and start < previous_end:
            raise ValueError("Subtitle segments overlap.")
        previous_start, previous_end = start, end


def serialize(segments: list[dict], export_format: str, allow_overlaps: bool = False) -> tuple[str, str, str]:
    validate_segments(segments, allow_overlaps)
    kind = export_format.lower()
    if kind == "srt":
        content = "\n\n".join(
            f"{index}\n{timestamp(segment['start'])} --> {timestamp(segment['end'])}\n{segment['text']}"
            for index, segment in enumerate(segments, 1)
        )
        return content + ("\n" if content else ""), "srt", "application/x-subrip; charset=utf-8"
    if kind == "vtt":
        cues = "\n\n".join(
            f"{timestamp(segment['start'], '.')} --> {timestamp(segment['end'], '.')}\n{segment['text']}"
            for segment in segments
        )
        return "WEBVTT\n\n" + cues + ("\n" if cues else ""), "vtt", "text/vtt; charset=utf-8"
    if kind == "lrc":
        lines = []
        for segment in segments:
            centiseconds = round(float(segment["start"]) * 100)
            minutes, remainder = divmod(centiseconds, 6000)
            seconds, fraction = divmod(remainder, 100)
            lines.append(f"[{minutes:02}:{seconds:02}.{fraction:02}]{segment['text']}")
        return "\n".join(lines) + ("\n" if lines else ""), "lrc", "text/plain; charset=utf-8"
    if kind == "txt":
        return "\n".join(segment["text"] for segment in segments) + ("\n" if segments else ""), "txt", "text/plain; charset=utf-8"
    if kind == "json":
        return json.dumps({"segments": segments}, ensure_ascii=False, indent=2) + "\n", "json", "application/json; charset=utf-8"
    raise ValueError("Unsupported export format.")