"""
AI / media routes — Blueprint: ai

/analyze_video      POST  video blob → Hume batch → emotion_timeline
/transcribe         POST  audio → Groq Whisper → {text, words}
/interviewer        POST  stateless IELTS question generator
/generate_feedback  POST  SSE-streamed AI feedback
/vocabulary_analysis POST SSE-streamed vocabulary analysis
"""

import json
import os
import tempfile
import time
import traceback

from flask import (Blueprint, Response, jsonify, request,
                   session as flask_session, stream_with_context)

from services.auth_helpers import require_auth
from services.prompt import _build_prompt

ai_bp = Blueprint("ai", __name__)

# ── Hume AI setup ──────────────────────────────────────────────────────────────

_HUME_KEY     = os.getenv("HUME_API_KEY", "")
_hume_enabled = bool(_HUME_KEY)

if _hume_enabled:
    print("[hume] API key found — video emotion analysis enabled")
else:
    print("[hume] WARNING: HUME_API_KEY not set — emotion analysis will return empty timeline")


def _parse_hume_predictions(predictions) -> list[dict]:
    """Convert Hume job predictions → unified emotion_timeline list."""
    timeline: list[dict] = []
    try:
        for file_pred in predictions:
            results = getattr(file_pred, "results", None)
            if results is None:
                continue
            for inference_pred in (results.predictions or []):
                models = getattr(inference_pred, "models", None)
                if models is None:
                    continue
                face_model = getattr(models, "face", None)
                if face_model is None:
                    continue
                for group in (face_model.grouped_predictions or []):
                    for pred in (group.predictions or []):
                        t_sec    = float(getattr(pred, "time", 0) or 0)
                        emotions = getattr(pred, "emotions", None) or []
                        if not emotions:
                            continue
                        sorted_emos = sorted(emotions, key=lambda e: float(e.score or 0), reverse=True)
                        top         = sorted_emos[0]
                        top_name    = (top.name or "neutral").lower()
                        top_score   = round(float(top.score or 0) * 100, 1)
                        all_emos    = {
                            e.name.lower(): round(float(e.score or 0) * 100, 1)
                            for e in sorted_emos[:8]
                        }
                        timeline.append({
                            "timestamp":    round(t_sec, 3),
                            "ms":           round(t_sec * 1000),
                            "emotion":      top_name,
                            "confidence":   top_score,
                            "all_emotions": all_emos,
                        })
    except Exception as exc:
        print(f"[hume] parse error: {exc}")
        traceback.print_exc()
    return sorted(timeline, key=lambda x: x["timestamp"])


# ── Routes ─────────────────────────────────────────────────────────────────────

@ai_bp.route("/analyze_video", methods=["POST"])
def analyze_video():
    """Receive a video blob, send to Hume Batch API, return emotion_timeline."""
    tmp_path = None
    try:
        if "video" not in request.files:
            return jsonify({"error": "No video file"}), 400

        video_file = request.files["video"]
        suffix     = ".webm"
        if video_file.content_type and "mp4" in video_file.content_type:
            suffix = ".mp4"

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            video_file.save(tmp.name)
            tmp_path = tmp.name

        size = os.path.getsize(tmp_path)
        print(f"[hume] video received: {size} bytes, suffix={suffix}")

        if size < 1000:
            return jsonify({"error": "Video too small", "emotion_timeline": []}), 400

        if not _hume_enabled:
            print("[hume] No API key — returning empty timeline")
            return jsonify({"emotion_timeline": [], "warning": "HUME_API_KEY not configured"})

        from hume import HumeClient
        from hume.expression_measurement.batch import Face, Models, InferenceBaseRequest

        client = HumeClient(api_key=_HUME_KEY)
        batch  = client.expression_measurement.batch

        with open(tmp_path, "rb") as f:
            job_id = batch.start_inference_job_from_local_file(
                file=[("file", f)],
                json=InferenceBaseRequest(models=Models(face=Face())),
            )

        print(f"[hume] job submitted: {job_id}")

        # Poll until complete (max 120s)
        deadline = time.time() + 120
        while time.time() < deadline:
            job_details = batch.get_job_details(job_id)
            status_str  = job_details.state.status if job_details.state else "UNKNOWN"
            if status_str == "COMPLETED":
                break
            if status_str == "FAILED":
                raise RuntimeError(f"Hume job failed: {job_details}")
            print(f"[hume] job status: {status_str} — waiting…")
            time.sleep(3)
        else:
            raise TimeoutError("Hume job timed out after 120s")

        predictions      = batch.get_job_predictions(job_id)
        print(f"[hume] got {len(predictions)} prediction file(s)")
        emotion_timeline = _parse_hume_predictions(predictions)
        print(f"[hume] parsed {len(emotion_timeline)} timeline entries")

        return jsonify({"emotion_timeline": emotion_timeline})

    except Exception as exc:
        print(f"[hume] analyze_video error: {exc}")
        traceback.print_exc()
        return jsonify({"emotion_timeline": [], "error": "Emotion analysis unavailable", "fallback": True})

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@ai_bp.route("/transcribe", methods=["POST"])
def transcribe():
    tmp_path = None
    try:
        print("=== TRANSCRIBE CALLED ===")
        print(f"Files: {list(request.files.keys())}")
        print(f"Form:  {list(request.form.keys())}")

        if "audio" not in request.files:
            print("ERROR: no 'audio' key in request.files")
            return jsonify({"error": "No audio file"}), 400

        audio_file = request.files["audio"]
        print(f"Audio file: name={audio_file.filename!r}, content_type={audio_file.content_type!r}")

        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
            audio_file.save(tmp.name)
            tmp_path = tmp.name

        size = os.path.getsize(tmp_path)
        print(f"Saved to: {tmp_path}, size: {size} bytes")

        if size == 0:
            print("ERROR: audio file is empty (0 bytes)")
            return jsonify({"error": "Audio file is empty"}), 400

        language = request.form.get("language", "en")
        print(f"Transcription language: {language!r}")

        from groq import Groq
        client = Groq(api_key=os.getenv("GROQ_API_KEY"))

        with open(tmp_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model="whisper-large-v3",
                file=f,
                response_format="verbose_json",
                timestamp_granularities=["word"],
                language=language,
            )

        print(f"Transcript ({len(result.text)} chars): {result.text[:120]!r}")

        words = []
        if hasattr(result, "words") and result.words:
            for w in result.words:
                if isinstance(w, dict):
                    words.append({"word": w["word"], "start": w["start"], "end": w["end"]})
                else:
                    words.append({"word": w.word, "start": w.start, "end": w.end})
        print(f"Words: {len(words)}")

        return jsonify({"text": result.text, "words": words})

    except Exception as exc:
        print(f"TRANSCRIBE ERROR: {exc}")
        traceback.print_exc()
        return jsonify({"text": "", "words": [], "error": "Transcription unavailable"})

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@ai_bp.route("/interviewer", methods=["POST"])
def interviewer():
    """Generate the next IELTS examiner question or cue card via Groq."""
    data            = request.get_json(silent=True) or {}
    part            = data.get("part", 1)
    context         = data.get("context", "")
    prev_answers    = data.get("previous_answers", "")
    question_number = int(data.get("question_number", 1))

    if part == 2 and data.get("cue_card"):
        prompt = (
            "You are a certified IELTS examiner creating a Part 2 cue card.\n"
            "Return ONLY a valid JSON object — no markdown, no explanation — in this exact format:\n"
            '{"topic":"Describe a ...","bullets":["You should say:","what it was","when it happened","why it was important","and explain how you felt about it"]}\n'
            "Make the topic varied and interesting. Bullets must be exactly 5 items starting with 'You should say:'."
        )
    elif part == "followup":
        prompt = (
            "You are a certified IELTS examiner. "
            f"The candidate just completed their Part 2 long turn. Topic: {context}\n"
            f"Summary of their answer: {prev_answers[:300]}\n"
            "Ask ONE short follow-up question to probe a little deeper. "
            "Return ONLY the question text, nothing else."
        )
    elif part == 1:
        topics_used = context or "none yet"
        prompt = (
            "You are a certified IELTS examiner conducting Part 1 (Introduction & Interview).\n"
            f"This is question {question_number} of 9.\n"
            f"Topics already covered: {topics_used}\n"
            f"Summary of previous answers: {prev_answers[:400] or 'none yet'}\n"
            "Generate the NEXT natural Part 1 question. Vary the topics across: "
            "hometown, home, work/study, hobbies, family, food, weather, technology, "
            "transport, health, friends, daily routine, sports, music, shopping.\n"
            "Keep it conversational and natural. Return ONLY the question text."
        )
    elif part == 3:
        prompt = (
            "You are a certified IELTS examiner conducting Part 3 (Two-Way Discussion).\n"
            f"The Part 2 topic was: {context}\n"
            f"This is Part 3 question {question_number} of 5.\n"
            f"Previous Part 3 answers: {prev_answers[:400] or 'none yet'}\n"
            "Generate an abstract, thought-provoking discussion question related to the Part 2 topic. "
            "Ask about societal trends, comparisons, opinions, or future predictions. "
            "Avoid repeating angles already covered. Return ONLY the question text."
        )
    else:
        return jsonify({"error": f"Unknown part: {part}"}), 400

    try:
        from groq import Groq
        client = Groq(api_key=os.getenv("GROQ_API_KEY"))
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=250,
            temperature=0.85,
        )
        result = completion.choices[0].message.content.strip()

        if part == 2 and data.get("cue_card"):
            result = result.strip("` \n")
            if result.startswith("json"):
                result = result[4:].strip()
            try:
                cue_card = json.loads(result)
            except json.JSONDecodeError:
                cue_card = {
                    "topic": "Describe a memorable experience from your life",
                    "bullets": [
                        "You should say:",
                        "what the experience was",
                        "when and where it happened",
                        "who was involved",
                        "and explain why it was memorable",
                    ],
                }
            return jsonify({"cue_card": cue_card})

        return jsonify({"question": result})

    except Exception as exc:
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500


@ai_bp.route("/generate_feedback", methods=["POST"])
def generate_feedback():
    data   = request.get_json(silent=True) or {}
    prompt = _build_prompt(data)

    def _stream():
        try:
            from groq import Groq
            client = Groq(api_key=os.getenv("GROQ_API_KEY"))
            completion = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                stream=True,
                max_tokens=2000,
            )
            for chunk in completion:
                text = chunk.choices[0].delta.content
                if text:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"

    return Response(
        stream_with_context(_stream()),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@ai_bp.route("/vocabulary_analysis", methods=["POST"])
@require_auth
def vocabulary_analysis():
    data       = request.get_json(silent=True) or {}
    transcript = (data.get("transcript") or "").strip()
    topic      = data.get("topic") or "general"

    if not transcript:
        return Response(
            f"data: {json.dumps({'done': True})}\n\n",
            content_type="text/event-stream",
        )

    prompt = (
        "Analyze this speaking response and provide:\n"
        "1. List of 5 basic/weak words used that could be replaced with more sophisticated vocabulary "
        "(format each as: **basic** → **better** — example usage in parentheses)\n"
        "2. List of 3 topic-specific vocabulary words the speaker should have used\n"
        "Be concise. No long introductions.\n\n"
        f"Topic: {topic}\n"
        f"Transcript: {transcript[:1200]}"
    )

    def _stream():
        try:
            from groq import Groq
            client = Groq(api_key=os.getenv("GROQ_API_KEY"))
            completion = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                stream=True,
                max_tokens=500,
            )
            for chunk in completion:
                text = chunk.choices[0].delta.content
                if text:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc), 'done': True})}\n\n"

    return Response(
        stream_with_context(_stream()),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
