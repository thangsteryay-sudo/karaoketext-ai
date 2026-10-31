import math
import re
import unicodedata


def _is_grapheme_script(char: str) -> bool:
    codepoint = ord(char)
    return (
        0x0E00 <= codepoint <= 0x0E7F
        or 0x0E80 <= codepoint <= 0x0EFF
        or 0x1000 <= codepoint <= 0x109F
        or 0x1780 <= codepoint <= 0x17FF
        or 0x3040 <= codepoint <= 0x30FF
        or 0x3400 <= codepoint <= 0x9FFF
        or 0xAC00 <= codepoint <= 0xD7AF
    )


def _tokens(text: str) -> list[str]:
    if not any(_is_grapheme_script(char) for char in text):
        return [token.casefold().replace("’", "'") for token in re.findall(r"[\w]+(?:['’][\w]+)*", text, flags=re.UNICODE)]

    tokens: list[str] = []
    latin_buffer: list[str] = []
    script_buffer: list[str] = []

    def flush_latin() -> None:
        if latin_buffer:
            tokens.append("".join(latin_buffer).casefold().replace("’", "'"))
            latin_buffer.clear()

    def flush_script() -> None:
        flush_latin()
        tokens.extend(script_buffer)
        script_buffer.clear()

    for char in text:
        category = unicodedata.category(char)
        if _is_grapheme_script(char) and category[0] in {"L", "N"}:
            flush_latin()
            script_buffer.append(char)
        elif category[0] == "M":
            if script_buffer:
                script_buffer[-1] += char
            elif latin_buffer:
                latin_buffer[-1] += char
        elif category[0] in {"L", "N"}:
            flush_script()
            latin_buffer.append(char)
        elif char in {"'", "’"} and latin_buffer:
            latin_buffer.append("'")
        else:
            flush_script()
            flush_latin()
    flush_script()
    flush_latin()
    return tokens


def _lyric_lines(text: str) -> list[str]:
    return [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not (line.strip().startswith("[") and line.strip().endswith("]"))
    ]


def align_reference_lyrics(lyrics: str, transcript: dict) -> dict:
    """Transfer only matched model word times to the user's supplied lyric lines."""
    lines = _lyric_lines(lyrics)
    reference = [(token, line_index) for line_index, line in enumerate(lines) for token in _tokens(line)]
    observed = []
    for segment in transcript.get("segments", []):
        segment_words = segment.get("words") or []
        if segment_words:
            for word in segment_words:
                for token in _tokens(word.get("text", "")):
                    observed.append({**word, "token": token})

    if len(reference) > 2000 or len(observed) > 6000:
        raise ValueError("Lyrics or recognized transcript is too large for local alignment.")
    if not reference or not observed:
        return {
            **{key: value for key, value in transcript.items() if key not in {"segments", "diagnostics"}},
            "segments": [],
            "diagnostics": {"source_lines": len(lines), "aligned_lines": 0, "unmatched_lines": lines, "match_ratio": 0.0},
        }

    observed_count = len(observed)
    directions = bytearray((len(reference) + 1) * (observed_count + 1))
    previous = [0] * (observed_count + 1)
    for ref_index, (reference_token, _) in enumerate(reference, start=1):
        current = [0] * (observed_count + 1)
        row_offset = ref_index * (observed_count + 1)
        for observed_index, item in enumerate(observed, start=1):
            if reference_token == item["token"]:
                current[observed_index] = previous[observed_index - 1] + 1
                directions[row_offset + observed_index] = 1
            elif previous[observed_index] >= current[observed_index - 1]:
                current[observed_index] = previous[observed_index]
                directions[row_offset + observed_index] = 2
            else:
                current[observed_index] = current[observed_index - 1]
                directions[row_offset + observed_index] = 3
        previous = current

    matched_by_line: dict[int, list[dict]] = {}
    ref_index, observed_index = len(reference), observed_count
    stride = observed_count + 1
    while ref_index and observed_index:
        direction = directions[ref_index * stride + observed_index]
        if direction == 1:
            _, line_index = reference[ref_index - 1]
            matched_by_line.setdefault(line_index, []).append(observed[observed_index - 1])
            ref_index -= 1
            observed_index -= 1
        elif direction == 2:
            ref_index -= 1
        else:
            observed_index -= 1

    segments = []
    unmatched_lines = []
    matched_token_count = 0
    for line_index, line in enumerate(lines):
        matches = matched_by_line.get(line_index, [])
        line_tokens = _tokens(line)
        threshold = 1 if len(line_tokens) == 1 else max(2, math.ceil(len(line_tokens) * 0.4))
        if len(matches) < threshold:
            unmatched_lines.append(line)
            continue
        matches.reverse()
        start = min(float(word["start"]) for word in matches)
        end = max(float(word["end"]) for word in matches)
        if end <= start:
            unmatched_lines.append(line)
            continue
        matched_token_count += len(matches)
        units = "characters" if any(_is_grapheme_script(char) for char in line) else "words"
        alignment = {
            "matched_units": len(matches),
            "total_units": len(line_tokens),
            "unit": units,
        }
        if units == "words":
            alignment.update({"matched_words": len(matches), "total_words": len(line_tokens)})
        segments.append({
            "start": round(start, 3),
            "end": round(end, 3),
            "text": line,
            "status": "aligned" if len(matches) == len(line_tokens) else "review",
            "alignment": alignment,
            "words": [
                {"text": word["token"], "start": round(float(word["start"]), 3), "end": round(float(word["end"]), 3), "status": "model-match"}
                for word in matches
            ],
        })

    diagnostics = {
        "source_lines": len(lines),
        "aligned_lines": len(segments),
        "unmatched_lines": unmatched_lines,
        "matched_units": matched_token_count,
        "source_units": len(reference),
        "match_ratio": round(matched_token_count / len(reference), 3),
    }
    return {
        **{key: value for key, value in transcript.items() if key not in {"segments", "diagnostics"}},
        "segments": segments,
        "diagnostics": diagnostics,
    }