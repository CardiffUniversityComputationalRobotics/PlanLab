"""Runs tests/test_extension.js with Node.js, or with the Node.js inside VS Code if Node.js isn't installed.

    python3 tests/run_extension_test.py          # the extension's Python is the one running this script
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

TEST = Path(__file__).resolve().parent / "test_extension.js"
CANDIDATES = [  # VS Code's own executable, which runs as Node.js with ELECTRON_RUN_AS_NODE=1
    "/snap/code/current/usr/share/code/code", "/usr/share/code/code", "/usr/lib/code/code",
    "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe"),
]
node = shutil.which("node") or next((c for c in CANDIDATES if Path(c).exists()), None)
if __name__ == "__main__" and not node:
    sys.exit("No Node.js found, and no VS Code in the usual places: run  node tests/test_extension.js  yourself.")
if __name__ == "__main__":
    sys.exit(subprocess.call([node, str(TEST), sys.executable], env={**os.environ, "ELECTRON_RUN_AS_NODE": "1"}))
