import json
import io
import struct
import wave
from types import SimpleNamespace

import pytest

from app.exporters import serialize, timestamp, validate_segments
from app.alignment import align_reference_lyrics
from app.transcription import FasterWhisperProvider


def test_srt_format_and_khmer_unicode():
    segments = [{"start": 5.2, "end": 8, "text": "សួស្តី, hello"}]
    content, extension, content_type = serialize(segments, "srt")
    assert content == "1\n00:00:05,200 --> 00:00:08,000\nសួស្តី, hello\n"
    assert extension == "srt"
    assert "utf-8" in content_type
    assert content.encode("utf-8").decode("utf-8") == content


def test_vtt_is_not_srt_with_a_different_extension():
    content, extension, _ = serialize([{"start": 1, "end": 2.5, "text": "line"}], "vtt")
    assert content == "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nline\n"
    assert extension == "vtt"


def test_lrc_and_text_exports():
    segments = [{"start": 61.25, "end": 62, "text": "Lyric"}]
    assert serialize(segments, "lrc")[0] == "[01:01.25]Lyric\n"
    assert serialize(segments, "txt")[0] == "Lyric\n"


def test_json_export_preserves_original_text():
    content, _, _ = serialize([{"start": 0, "end": 1, "text": "ភាសាខ្មែរ"}], "json")
    assert json.loads(content)["segments"][0]["text"] == "ភាសាខ្មែរ"
    assert "\\u" not in content


@pytest.mark.parametrize("start,end", [(-1, 1), (2, 2), (3, 1)])
def test_rejects_invalid_timestamps(start, end):
    with pytest.raises(ValueError):
        validate_segments([{"start": start, "end": end, "text": "invalid"}])


def test_rejects_unintended_overlap_and_allows_explicit_overlap():
    segments = [{"start": 0, "end": 2, "text": "first"}, {"start": 1, "end": 3, "text": "second"}]
    with pytest.raises(ValueError, match="overlap"):
        validate_segments(segments)
    validate_segments(segments, allow_overlaps=True)


def test_timestamp_rounds_milliseconds():
    assert timestamp(1.9996) == "00:00:02,000"


def test_rejects_unknown_export_format():
    with pytest.raises(ValueError, match="Unsupported"):
        serialize([], "doc")


def test_transcription_reports_model_loading_and_segment_progress(monkeypatch, tmp_path):
    import faster_whisper
    from app import transcription

    class FakeModel:
        def __init__(self, *_args, **_kwargs):
            pass

        def transcribe(self, *_args, **_kwargs):
            segments = [
                SimpleNamespace(start=0, end=5, text=" first", words=None),
                SimpleNamespace(start=5, end=10, text=" second", words=None),
            ]
            return iter(segments), SimpleNamespace(language="en", language_probability=0.99)

    monkeypatch.setattr(faster_whisper, "WhisperModel", FakeModel)
    monkeypatch.setattr(transcription, "_model_cache_key", None)
    monkeypatch.setattr(transcription, "_model_cache", None)
    updates = []
    result = FasterWhisperProvider("small", "cpu", "int8").transcribe(
        tmp_path / "audio.wav",
        language="en",
        duration_seconds=10,
        progress_callback=lambda stage, progress: updates.append((stage, progress)),
    )

    assert len(result["segments"]) == 2
    assert updates[0] == ("Loading transcription model; it is reused after first load", 20)
    assert updates[-1] == ("Recognizing lyrics", 95)


def test_transcription_reuses_model_for_same_configuration(monkeypatch, tmp_path):
    import faster_whisper
    from app import transcription

    created_models = []

    class FakeModel:
        def __init__(self, *_args, **_kwargs):
            created_models.append(self)

        def transcribe(self, *_args, **_kwargs):
            return iter([]), SimpleNamespace(language="en", language_probability=0.9)

    monkeypatch.setattr(faster_whisper, "WhisperModel", FakeModel)
    monkeypatch.setattr(transcription, "_model_cache_key", None)
    monkeypatch.setattr(transcription, "_model_cache", None)

    FasterWhisperProvider("small", "cpu", "int8").transcribe(tmp_path / "first.wav")
    FasterWhisperProvider("small", "cpu", "int8").transcribe(tmp_path / "second.wav")

    assert len(created_models) == 1


def test_transcription_keeps_only_ordered_word_timestamps_inside_segments(monkeypatch, tmp_path):
    import faster_whisper
    from app import transcription

    class FakeModel:
        def __init__(self, *_args, **_kwargs):
            pass

        def transcribe(self, *_args, **_kwargs):
            words = [
                SimpleNamespace(word="outside-before", start=0.8, end=1.0),
                SimpleNamespace(word="kept", start=1.1, end=1.4),
                SimpleNamespace(word="outside-after", start=1.9, end=2.2),
                SimpleNamespace(word="reversed", start=1.8, end=1.7),
            ]
            segment = SimpleNamespace(start=1.0, end=2.0, text=" transcript", words=words)
            return iter([segment]), SimpleNamespace(language="en", language_probability=0.9)

    monkeypatch.setattr(faster_whisper, "WhisperModel", FakeModel)
    monkeypatch.setattr(transcription, "_model_cache_key", None)
    monkeypatch.setattr(transcription, "_model_cache", None)

    result = FasterWhisperProvider("small", "cpu", "int8").transcribe(tmp_path / "audio.wav")

    assert result["segments"][0]["words"] == [
        {"text": "kept", "start": 1.1, "end": 1.4, "status": "model"},
    ]
    assert result["word_timestamps_available"] is True


def test_faster_whisper_decoder_supports_pinned_pyav():
    from faster_whisper.audio import decode_audio

    sample_rate = 16000
    audio_file = io.BytesIO()
    with wave.open(audio_file, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(struct.pack("<h", 0) * sample_rate)

    decoded = decode_audio(io.BytesIO(audio_file.getvalue()), sampling_rate=sample_rate)

    assert decoded.shape == (sample_rate,)


def test_reference_alignment_uses_matched_word_times_and_preserves_lyrics():
    reference = "[Verse]\nSix a.m., my phone lights up\nYour sleepy voice is here"
    transcript = {
        "language": "en",
        "segments": [{
            "start": 1,
            "end": 4,
            "text": "6 AM my phone lights up your sleepy voice",
            "words": [
                {"text": "six", "start": 1.0, "end": 1.2},
                {"text": "a.m.", "start": 1.2, "end": 1.5},
                {"text": "my", "start": 1.5, "end": 1.7},
                {"text": "phone", "start": 1.7, "end": 2.0},
                {"text": "lights", "start": 2.0, "end": 2.3},
                {"text": "up", "start": 2.3, "end": 2.5},
                {"text": "your", "start": 2.6, "end": 2.8},
                {"text": "sleepy", "start": 2.8, "end": 3.1},
                {"text": "voice", "start": 3.1, "end": 3.4},
            ],
        }],
    }

    aligned = align_reference_lyrics(reference, transcript)

    assert aligned["segments"][0]["text"] == "Six a.m., my phone lights up"
    assert aligned["segments"][0]["start"] == 1.0
    assert aligned["segments"][0]["end"] == 2.5
    assert aligned["segments"][0]["status"] == "aligned"
    assert aligned["segments"][1]["text"] == "Your sleepy voice is here"
    assert aligned["segments"][1]["status"] == "review"
    assert aligned["segments"][1]["alignment"] == {
        "matched_units": 3,
        "total_units": 5,
        "unit": "words",
        "matched_words": 3,
        "total_words": 5,
    }
    assert aligned["diagnostics"]["unmatched_lines"] == []


def test_khmer_combining_marks_are_preserved_during_alignment():
    lyrics = "\u179f\u17bd\u179f\u17d2\u178f\u17b8 \u1785\u1798\u17d2\u179a\u17c0\u1784\u1781\u17d2\u1798\u17c2"
    words = [
        {"text": "\u179f\u17bd\u179f\u17d2\u178f\u17b8", "start": 1.0, "end": 1.5},
        {"text": "\u1785\u1798\u17d2\u179a\u17c0\u1784\u1781\u17d2\u1798\u17c2", "start": 1.5, "end": 2.2},
    ]

    aligned = align_reference_lyrics(lyrics, {"language": "km", "segments": [{"words": words}]})

    assert len(aligned["segments"]) == 1
    assert aligned["segments"][0]["text"] == lyrics
    assert aligned["segments"][0]["alignment"]["unit"] == "characters"
    assert aligned["segments"][0]["alignment"]["matched_units"] == aligned["segments"][0]["alignment"]["total_units"]
    assert (aligned["segments"][0]["start"], aligned["segments"][0]["end"]) == (1.0, 2.2)


def test_reference_alignment_keeps_repeated_lyrics_in_audio_order():
    words = [
        {"text": "hello", "start": 1, "end": 1.2},
        {"text": "world", "start": 1.2, "end": 1.5},
        {"text": "hello", "start": 5, "end": 5.2},
        {"text": "world", "start": 5.2, "end": 5.5},
    ]
    aligned = align_reference_lyrics("Hello world\nHello world", {"segments": [{"start": 1, "end": 6, "words": words}]})

    assert [segment["start"] for segment in aligned["segments"]] == [1, 5]
    assert aligned["diagnostics"]["aligned_lines"] == 2


def test_reference_alignment_without_matching_audio_does_not_invent_timestamps():
    aligned = align_reference_lyrics(
        "These lyrics are not present",
        {"segments": [{"start": 10, "end": 12, "words": [{"text": "unrelated speech", "start": 10, "end": 12}]}]},
    )

    assert aligned["segments"] == []
    assert aligned["diagnostics"]["unmatched_lines"] == ["These lyrics are not present"]


def test_reference_alignment_requires_real_word_timestamps():
    aligned = align_reference_lyrics(
        "Known reference lyric words",
        {"segments": [{"start": 10, "end": 12, "text": "Known reference lyric words"}]},
    )

    assert aligned["segments"] == []
    assert aligned["diagnostics"]["unmatched_lines"] == ["Known reference lyric words"]