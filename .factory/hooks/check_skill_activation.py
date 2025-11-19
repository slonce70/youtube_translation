#!/usr/bin/env python3
"""UserPromptSubmit hook for Droid Factory.

Reads the incoming event JSON from stdin, matches the user prompt against
`.claude/skills/skill-rules.json`, and, when appropriate, injects additional
context for relevant skills (for example `route-tester` and `error-tracking`).

The script is intentionally defensive about the input shape so it can work
both with simple `{ "prompt": "..." }` payloads and nested
`{"UserPromptSubmit": { "prompt": "..." }}` envelopes.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional


def read_stdin() -> Optional[str]:
    """Read all of stdin, returning None if empty."""

    data = sys.stdin.read()
    if not data or not data.strip():
        return None
    return data


def parse_json(raw: str) -> Optional[Dict[str, Any]]:
    """Parse JSON safely, returning None on failure."""

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def find_prompt(payload: Dict[str, Any]) -> Optional[str]:
    """Best-effort extraction of the user prompt from an event payload.

    Supports a few common shapes:
    - {"prompt": "..."}
    - {"UserPromptSubmit": {"prompt": "..."}}
    - Any nested object that contains a "prompt" key with a string value.
    """

    # Direct root-level prompt
    prompt = payload.get("prompt")
    if isinstance(prompt, str) and prompt.strip():
        return prompt

    # Event-wrapped payload
    ups = payload.get("UserPromptSubmit")
    if isinstance(ups, dict):
        inner_prompt = ups.get("prompt")
        if isinstance(inner_prompt, str) and inner_prompt.strip():
            return inner_prompt

    # Fallback: recursive search for a "prompt" key
    def _search(obj: Any) -> Optional[str]:
        if isinstance(obj, dict):
            if "prompt" in obj and isinstance(obj["prompt"], str):
                value = obj["prompt"].strip()
                return value or None
            for v in obj.values():
                found = _search(v)
                if found is not None:
                    return found
        elif isinstance(obj, list):
            for item in obj:
                found = _search(item)
                if found is not None:
                    return found
        return None

    return _search(payload)


def get_project_root() -> Path:
    """Resolve the repository root from this file location.

    This script lives at `.factory/hooks/check_skill_activation.py`.
    The repo root is therefore two levels up.
    """

    return Path(__file__).resolve().parents[2]


def load_skill_rules(project_root: Path) -> Dict[str, Any]:
    """Load `.claude/skills/skill-rules.json` if present.

    If the file is missing or invalid, an empty ruleset is returned.
    """

    rules_path = project_root / ".claude" / "skills" / "skill-rules.json"
    try:
        text = rules_path.read_text(encoding="utf-8")
        return json.loads(text)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"skills": {}}


def match_skills(prompt: str, rules: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return a list of matched skills based on prompt triggers.

    Each entry has the shape:
    {"name": <skill-name>, "config": <rule>, "match_type": "keyword"|"intent"}
    """

    prompt_lower = prompt.lower()
    skills = rules.get("skills") or {}
    matches: List[Dict[str, Any]] = []

    for name, config in skills.items():
        if not isinstance(config, dict):
            continue
        triggers = config.get("promptTriggers") or {}

        keywords = triggers.get("keywords") or []
        intent_patterns = triggers.get("intentPatterns") or []

        match_type: Optional[str] = None

        # Simple substring keyword match (case-insensitive)
        for kw in keywords:
            if not isinstance(kw, str):
                continue
            if kw.lower() in prompt_lower:
                match_type = "keyword"
                break

        # Regex-based intent patterns
        if match_type is None:
            for pattern in intent_patterns:
                if not isinstance(pattern, str):
                    continue
                try:
                    if re.search(pattern, prompt, flags=re.IGNORECASE):
                        match_type = "intent"
                        break
                except re.error:
                    # Ignore invalid regex patterns
                    continue

        if match_type is not None:
            matches.append({"name": name, "config": config, "match_type": match_type})

    return matches


AUTO_INJECT_SKILLS = {"route-tester", "error-tracking"}


def read_skill_markdown(project_root: Path, skill_name: str) -> Optional[str]:
    """Read the SKILL.md file for a given skill, if it exists."""

    skill_path = project_root / ".claude" / "skills" / skill_name / "SKILL.md"
    try:
        return skill_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None


def build_additional_context(project_root: Path, matches: List[Dict[str, Any]]) -> str:
    """Construct a human-readable summary plus optional skill content."""

    lines: List[str] = []
    lines.append("===== SKILL ACTIVATION CHECK (Droid Factory) =====")
    lines.append("")

    def group_by_priority(priority: str) -> List[Dict[str, Any]]:
        return [m for m in matches if m["config"].get("priority") == priority]

    groups = [
        ("CRITICAL SKILLS (REQUIRED)", "critical"),
        ("RECOMMENDED SKILLS", "high"),
        ("SUGGESTED SKILLS", "medium"),
        ("OPTIONAL SKILLS", "low"),
    ]

    for title, prio in groups:
        group = group_by_priority(prio)
        if not group:
            continue
        lines.append(title + ":")
        for m in group:
            lines.append(f"  -> {m['name']} (matched by {m['match_type']})")
        lines.append("")

    lines.append("Action: consider consulting the relevant skill or custom droid before replying.")
    lines.append("")

    # Inline the full SKILL.md content for a small set of narrowly-focused skills
    for m in matches:
        name = m["name"]
        if name not in AUTO_INJECT_SKILLS:
            continue
        content = read_skill_markdown(project_root, name)
        if not content:
            continue
        lines.append(f"[Auto-injected skill: {name}]")
        lines.append("")
        lines.append(content.strip())
        lines.append("")

    return "\n".join(lines).strip()


def main() -> None:
    raw = read_stdin()
    if raw is None:
        print(json.dumps({"continue": True}))
        return

    payload = parse_json(raw)
    if payload is None:
        print(json.dumps({"continue": True}))
        return

    prompt = find_prompt(payload)
    if not prompt:
        print(json.dumps({"continue": True}))
        return

    project_root = get_project_root()
    rules = load_skill_rules(project_root)
    matches = match_skills(prompt, rules)

    if not matches:
        print(json.dumps({"continue": True}))
        return

    additional_context = build_additional_context(project_root, matches)
    result = {
        "continue": True,
        "hookSpecificOutput": {
            "additionalContext": additional_context
        },
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
