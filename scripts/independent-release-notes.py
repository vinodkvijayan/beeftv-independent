"""Write English release notes for this unofficial Windows build."""

import os
from pathlib import Path

version = Path("VERSION").read_text(encoding="utf-8").strip()
sha = os.environ.get("GITHUB_SHA", "unknown")
destination = Path(os.environ["RELEASE_NOTES_PATH"])
destination.write_text(
    f"""Unofficial independent Windows build of upstream BeefTV {version}.

This is not an official BeefTV release and it is not signed by BeefTV.
The interface is still the upstream Chinese UI. There is no English locale in this source.
Upstream: https://github.com/glanderness/BeefTV tag {version} ({sha}).
License: BeefTV Source Available License 1.0 (see LICENSE). Do not represent this as an official BeefTV download.

- BeefTV-{version}-windows-amd64-setup.exe is the installer.
- BeefTV-{version}-windows-amd64-portable.zip is the unpacked program directory.

Windows SmartScreen may warn because the installer is unsigned.
""",
    encoding="utf-8",
)
