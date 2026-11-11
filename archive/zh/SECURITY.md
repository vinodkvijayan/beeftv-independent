# security policy

## Support range

Security fixes are prioritized for `main` and latest releases. Historical versions do not guarantee individual backfill.

## Report a vulnerability

Please do not disclose unfixed vulnerabilities through public issues. Priority is given to using GitHub repositories
[Private vulnerability reporting](https://github.com/glanderness/BeefTV/security/advisories/new)，
Or send an email to `2667983673@qq.com`.

Please include the affected version, steps to reproduce, scope of impact, and possible mitigation suggestions in your report. Please do not access, download, or modify data that does not belong to you, and do not perform continuous stress testing on public instances.

The maintainer will confirm receipt of the report as soon as possible and synchronize the repair progress after verifying the impact. Before making a bug fix public, keep a reasonable fix window for the project and users.

## Deployer Responsibilities

- Production environments must use HTTPS and set `CANVAS_CORS_ORIGINS` as the explicit frontend Origin.
- The first administrator should complete registration before the service is exposed to the public network. Public registration remains closed by default.
- The data directory, SQLite database, backup, and `.settings-key` must be restricted to be readable by the service account.
- System model channels and OSS use least privilege keys, and set supplier-side budgets and alarms.
- Do not commit `.env`, databases, logs, backups, or real keys to Git.