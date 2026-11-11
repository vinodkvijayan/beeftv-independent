# Security policy

## Supported versions

Security fixes go to `main` and the latest published build first. Older builds are not guaranteed their own backport.

## Reporting a vulnerability

Do not file a public issue for a vulnerability that is still unfixed. Prefer GitHub
[private vulnerability reporting](https://github.com/glanderness/BeefTV/security/advisories/new)
on the upstream repository, or email `2667983673@qq.com`.

Include the affected version, steps to reproduce, impact, and any mitigation. Do not access, download, or modify data that is not yours, and do not load-test a public instance.

Maintainers acknowledge reports when they can, then share fix progress after they have confirmed the impact. Give the project and its users a reasonable window before you publish the details.

## Operator responsibilities

- Production must use HTTPS, and `CANVAS_CORS_ORIGINS` must be an explicit frontend origin.
- Register the first administrator before the service is on the public internet. Public registration stays off by default.
- The data directory, SQLite database, backups, and `.settings-key` must be readable only by the service account.
- System model channels and object storage should use least-privilege keys, with a provider-side budget and alerts.
- Do not commit `.env`, databases, logs, backups, or real keys.
