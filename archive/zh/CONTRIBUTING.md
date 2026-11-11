# Contribution Guidelines

Thanks for participating in BeefTV. Before submitting changes, please confirm the relevant Issue or use a brief description to describe the problem, goals and external behavior changes.

## Development environment

- Front-end: Bun, Vite, React, TypeScript.
- Backend: Go, Gin, GORM, SQLite.
- Local full stack: `docker compose up -d --build`.

Do not submit `.env`, databases, data directories, builds, editor configurations, or real API/OSS keys. When adding a new configuration item, only instructions without sensitive information will be provided in `.env.example`.

## Submit request

- Keep changes focused and keep existing directory responsibilities, naming and error handling styles.
- Write paths must fail explicitly; default values cannot be used to mask save, permission, build, or delete errors.
- Backend object reading must verify the current user and resource ownership at the same time.
- Size, frequency, cost, and SSRF boundaries must be stated when involving uploads, external requests, or model calls.
- Use Chinese for user-visible copy; use short Chinese comments to explain the reasons for core business entrances and security boundaries.

The Pull Request should include a summary of the changes, risks, verification methods, and necessary screenshots.

## Contribution License

Since the submission of the new license, the first new original content submitted will be contributed according to [`LICENSE`’s Part A (BeefTV Source Available License 1.0)] (LICENSE) by default. You should have the authority to grant these permissions, retain existing attribution and license notices, and identify the source and applicable terms of third-party or historical MIT material. Do not submit other people's code, materials, or work owned by your employer as original contributions that you do not have permission to authorize.

Original contributions intentionally submitted under Part A also grant to the official `glanderness/BeefTV` repository maintainer a non-exclusive, perpetual, irrevocable, worldwide, royalty-free copyright license in accordance with Section 8 of Part A to copy, modify, distribute, and sublicense the contribution under a community license or separate commercial terms. Contributors retain copyright; this is not a transfer of copyright and does not apply retroactively to historical contributions or extend to third party material. If you do not accept this authorization, you should make it clear before accepting the contribution, and the maintainer will first confirm the handling method.

Contributions that have been released under MIT continue to retain MIT rights; content that requires a compatible license due to GPL and other terms cannot be forced to apply Part A, and compatibility should be clearly marked and stated in the contribution. See [Licensing Description](docs/content/docs/overview/licensing.mdx) for scenario and scope descriptions.