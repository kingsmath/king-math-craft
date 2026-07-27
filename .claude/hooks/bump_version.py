"""PostToolUse hook (Write|Edit): bumps index.html's patch version by 1 and refreshes its
timestamp whenever any OTHER project file is edited. Skips index.html itself so it can't
recurse back through PostToolUse. Reads the hook payload (tool_name/tool_input/tool_response
JSON) from stdin per the Claude Code hooks contract; writes the file directly (not via the
Edit/Write tools), so this run never re-triggers the hook.
"""
import json
import os
import re
import sys
import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INDEX_HTML = os.path.join(PROJECT_ROOT, "index.html")


def edited_file_path(payload):
    tool_input = payload.get("tool_input") or {}
    tool_response = payload.get("tool_response") or {}
    return tool_input.get("file_path") or tool_response.get("filePath") or ""


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return

    fp = edited_file_path(payload)
    if os.path.normcase(os.path.basename(fp)) == "index.html":
        return  # avoid recursing back into this same hook

    if not os.path.exists(INDEX_HTML):
        return

    with open(INDEX_HTML, "r", encoding="utf-8") as f:
        text = f.read()

    match = re.search(r"데모버전 (\d+)\.(\d+)\.(\d+)\(", text)
    if not match:
        return

    major, minor, patch = int(match.group(1)), int(match.group(2)), int(match.group(3)) + 1
    new_version = f"{major}.{minor}.{patch}"
    timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M")

    text = re.sub(r"\d+\.\d+\.\d+킹수학크래프트", new_version + "킹수학크래프트", text)
    text = re.sub(r"데모버전 \d+\.\d+\.\d+\(\d+\)", f"데모버전 {new_version}({timestamp})", text)

    with open(INDEX_HTML, "w", encoding="utf-8") as f:
        f.write(text)


if __name__ == "__main__":
    main()
