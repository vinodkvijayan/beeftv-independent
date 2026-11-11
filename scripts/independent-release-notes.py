"""Write English release notes for the independent English Windows build."""

import os
from pathlib import Path

upstream = os.environ.get("UPSTREAM_VERSION") or Path("VERSION").read_text(encoding="utf-8").strip()
sha = os.environ.get("GITHUB_SHA", "unknown")
destination = Path(os.environ["RELEASE_NOTES_PATH"])
destination.write_text(
    f"""BeefTV English 1.0.0 for Windows.

This is an independent English edition based on upstream BeefTV {upstream}. It is not an official BeefTV release and it is not signed by BeefTV.

The desktop interface and the repository documents are English. Backend messages, agent prompts, and skill text are still Chinese. See docs/BACKEND_I18N_PLAN.md. Original Chinese documents are in archive/zh/.

Upstream: https://github.com/glanderness/BeefTV tag {upstream} ({sha}).
License: BeefTV Source Available License 1.0 (see LICENSE). Do not represent this as an official BeefTV download.

- BeefTV-English-1.0.0-windows-amd64-setup.exe is the installer.
- BeefTV-English-1.0.0-windows-amd64-portable.zip is the unpacked program directory.

Windows SmartScreen may warn because the installer is unsigned.
""",
    encoding="utf-8",
)
