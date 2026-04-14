"""
Prompt builder for AI feedback generation.

_build_prompt(data) → str   — called by /generate_feedback
"""


def _build_prompt(data: dict) -> str:
    mode      = data.get("mode", "free")
    submode   = data.get("submode", "")
    topic     = data.get("topic", "")
    duration  = float(data.get("duration", 0))
    transcript = data.get("transcript", "")
    language  = data.get("language", "english")
    filler_words    = data.get("filler_words", [])
    confidence_avg  = float(data.get("confidence_avg", 0))
    emotion_timeline = data.get("emotion_timeline", [])

    # Language instruction — prepended to every prompt
    language_instruction = (
        "Respond in Russian language."
        if data.get("language") == "russian"
        else "Respond in English."
    )

    # Emotion timeline — first 20 entries formatted
    timeline_lines = []
    for entry in emotion_timeline[:20]:
        if isinstance(entry, dict):
            ms  = entry.get("ms", entry.get("timestamp", "?"))
            em  = entry.get("emotion", "?")
            pct = entry.get("confidence", entry.get("percent", "?"))
            timeline_lines.append(f"{ms}ms: {em} {pct}%")
        else:
            timeline_lines.append(str(entry))
    timeline_str = "\n".join(timeline_lines) if timeline_lines else "No data."

    # Filler words summary
    if isinstance(filler_words, list):
        if filler_words:
            filler_summary = f"{len(filler_words)} filler words detected: {', '.join(filler_words[:30])}"
        else:
            filler_summary = "No filler words detected."
    else:
        filler_summary = str(filler_words)

    # Common context block
    context = (
        f"Topic: {topic or 'Not specified'}\n"
        f"Duration: {duration:.1f} seconds\n"
        f"Confidence (avg): {confidence_avg:.1f}%\n"
        f"Fillers: {filler_summary}\n\n"
        f"Transcript:\n{transcript or '(empty)'}\n\n"
        f"Emotion timeline (first 20 samples):\n{timeline_str}\n"
    )

    # ── Progress mode ──────────────────────────────────────────────────────────
    if mode == "progress":
        sessions = data.get("sessions", [])
        n        = len(sessions)
        scores   = [str(s.get("overall_score", "?")) for s in sessions]
        modes    = [s.get("mode", "?") for s in sessions]
        return (
            language_instruction + "\n\n" +
            f"You are analyzing speaking progress over {n} sessions. "
            f"Scores: {', '.join(scores)}. "
            f"Modes: {', '.join(modes)}. "
            "Give a concise 3-4 sentence progress analysis covering: trend, main strength, "
            "main area to improve. Be specific and encouraging."
        )

    # ── IELTS mode ─────────────────────────────────────────────────────────────
    if mode == "ielts":
        part_labels = {
            "part1": "Part 1 (Introduction & Interview)",
            "part2": "Part 2 (Individual Long Turn / Cue Card)",
            "part3": "Part 3 (Two-Way Discussion)",
        }
        part_label = part_labels.get(submode, f"Part: {submode}")
        return (
            language_instruction + "\n\n" +
            f"You are a strict IELTS examiner assessing {part_label}. "
            "Evaluate the candidate's response using official IELTS band descriptors. "
            "Be precise, critical, and constructive.\n\n"
            f"{context}\n"
            "Provide your assessment using EXACTLY these sections:\n\n"
            "## Band Score Estimate\n"
            "Give an estimated band (e.g. 6.0, 6.5, 7.0) with one sentence justification.\n\n"
            "## Fluency & Coherence\n"
            "Comment on hesitations, self-corrections, topic development, and use of cohesive devices.\n\n"
            "## Lexical Resource\n"
            "Comment on vocabulary range, precision, collocations, and any errors.\n\n"
            "## Grammatical Range & Accuracy\n"
            "Comment on sentence complexity, tense use, and grammatical errors.\n\n"
            "## Pronunciation & Delivery\n"
            "Comment on pace, clarity, and emotional delivery based on the emotion timeline.\n\n"
            "## Key Moment Analysis\n"
            "Identify the single strongest moment and the single weakest moment in the transcript.\n\n"
            "## One Drill For Tomorrow\n"
            "Give one specific, actionable 5-minute practice drill to address the biggest weakness."
        )

    # ── Pitch mode ─────────────────────────────────────────────────────────────
    if mode == "pitch" and submode == "pitch":
        return (
            language_instruction + "\n\n" +
            "You are a startup coach who has evaluated pitches securing $500M+ in funding. "
            "Be direct, brutally honest, and actionable.\n\n"
            f"{context}\n"
            "Provide your assessment using EXACTLY these sections:\n\n"
            "## Hook Score X/10\n"
            "Rate the opening hook and explain why it works or fails.\n\n"
            "## Problem-Solution Clarity X/10\n"
            "Rate how clearly the problem and solution are articulated.\n\n"
            "## Confidence Arc\n"
            "Describe how the speaker's confidence evolved using the emotion timeline.\n\n"
            "## Killer Lines\n"
            "Quote the 1-2 strongest lines verbatim and explain why they land.\n\n"
            "## Fatal Weaknesses\n"
            "List the top 2-3 weaknesses that would make an investor tune out.\n\n"
            "## The Weakest Moment\n"
            "Identify the exact moment (with approximate timestamp if available) where the pitch lost momentum.\n\n"
            "## Rewrite This Line\n"
            "Pick the weakest line, quote it, then rewrite it to be investor-grade.\n\n"
            "## One Thing To Fix Before Next Pitch\n"
            "Give one clear, specific action to take before the next pitch."
        )

    # ── Interview mode ─────────────────────────────────────────────────────────
    if mode == "pitch" and submode == "interview":
        return (
            language_instruction + "\n\n" +
            "You are an expert interview coach who has prepared candidates for Google, McKinsey, and Goldman Sachs. "
            "Be rigorous, empathetic, and specific.\n\n"
            f"{context}\n"
            "Provide your assessment using EXACTLY these sections:\n\n"
            "## Overall Impression X/10\n"
            "Rate the overall interview performance and give a one-sentence summary.\n\n"
            "## STAR Structure Analysis\n"
            "Assess use of Situation, Task, Action, Result structure. Was it present? Complete? Compelling?\n\n"
            "## Confidence Arc\n"
            "Describe how the speaker's confidence evolved using the emotion timeline.\n\n"
            "## Strongest Moments\n"
            "Identify the 1-2 moments where the candidate shone brightest.\n\n"
            "## Critical Weaknesses\n"
            "List the top 2-3 weaknesses that would cost points with a real interviewer.\n\n"
            "## The Weakest Answer Moment\n"
            "Identify the exact moment where the answer fell apart or lost the interviewer.\n\n"
            "## Rewrite This Line\n"
            "Pick the weakest line, quote it, then rewrite it to be interview-grade.\n\n"
            "## One Thing To Fix Before The Interview\n"
            "Give one clear, specific action to take before the real interview."
        )

    # ── Presentation mode ──────────────────────────────────────────────────────
    if mode == "pitch" and submode == "presentation":
        return (
            language_instruction + "\n\n" +
            "You are a TED speaker coach who has prepared speakers for the main TED stage. "
            "Focus on storytelling, structure, and audience impact.\n\n"
            f"{context}\n"
            "Provide your assessment using EXACTLY these sections:\n\n"
            "## Overall Score X/10\n"
            "Rate the overall presentation and give a one-sentence summary.\n\n"
            "## Opening Impact X/10\n"
            "Rate the opening 30 seconds and explain whether it would hook an audience.\n\n"
            "## Structure & Flow\n"
            "Assess the logical flow, transitions, and whether the structure serves the message.\n\n"
            "## Audience Engagement\n"
            "Comment on techniques used (or missing) to engage the audience.\n\n"
            "## Storytelling Elements\n"
            "Identify any stories, analogies, or vivid examples. Were they effective?\n\n"
            "## The Weakest Moment\n"
            "Identify the exact moment where audience attention would be lost.\n\n"
            "## Rewrite The Opening\n"
            "Rewrite the first 2-3 sentences to be TED-stage worthy.\n\n"
            "## One Focus For Next Time\n"
            "Give one specific area to focus on for the next practice session."
        )

    # ── Free talk mode (default) ───────────────────────────────────────────────
    return (
        language_instruction + "\n\n" +
        "You are a supportive speaking coach who helps people become more confident communicators. "
        "Be encouraging, warm, and specific.\n\n"
        f"{context}\n"
        "Provide your assessment using EXACTLY these sections:\n\n"
        "## Overall Impression\n"
        "Give a brief warm summary of the speaker's performance.\n\n"
        "## Communication Strengths\n"
        "Highlight 2-3 genuine strengths observed in this session.\n\n"
        "## Speaking Patterns\n"
        "Describe recurring patterns (positive or negative) in pace, pausing, or structure.\n\n"
        "## Vocabulary Highlights\n"
        "Note any particularly effective word choices, or suggest upgrades for weak ones.\n\n"
        "## Emotional Presence\n"
        "Comment on emotional expressiveness based on the emotion timeline.\n\n"
        "## One Small Win For Tomorrow\n"
        "Give one tiny, achievable improvement to practice tomorrow."
    )
