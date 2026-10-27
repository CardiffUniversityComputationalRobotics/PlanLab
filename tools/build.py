#!/usr/bin/env python3
"""Bundles the app into one HTML file: dist/planlab.html.

It copies index.html and puts every local stylesheet and script inside it, in the same
order, so the single file behaves exactly like the folder. Handy for sharing or uploading.
Only the web fonts still come from the internet (without them, system fonts are used).

    python3 tools/build.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "dist" / "planlab.html"


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


def inline_stylesheet(match):
    path = match.group(1)
    return f"<style>\n/* ---- {path} ---- */\n{read(path)}</style>"


def inline_script(match):
    path = match.group(1)
    code = read(path)
    if "</script" in code.lower():
        raise SystemExit(f"{path} contains '</script', which would end the inlined script early.")
    return f"<script>\n/* ---- {path} ---- */\n{code}</script>"


def main():
    html = read("index.html")
    html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">', inline_stylesheet, html)
    html = re.sub(r'<script src="(js/[^"]+)"></script>', inline_script, html)
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(html, encoding="utf-8")
    print(f"Wrote {OUTPUT.relative_to(ROOT)} ({len(html) // 1024} KB)")


if __name__ == "__main__":
    main()
