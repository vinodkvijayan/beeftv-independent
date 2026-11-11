# Contributing

Thanks for working on this independent English edition of BeefTV. Before sending a change, point at the related issue or describe the problem, the goal, and any user-visible behavior that changes.

## Setup

- Frontend: Bun, Vite, React, TypeScript.
- Backend: Go, Gin, GORM, SQLite.
- Full local stack: `docker compose up -d --build`.

Do not commit `.env`, databases, data directories, build output, editor settings, or real API or object-storage keys. New settings belong in `.env.example` with no secrets.

## Change rules

- Keep the change focused. Follow the existing directory roles, names, and error-handling style.
- Writes must fail in the open. Do not hide a save, permission, generation, or delete error behind a default.
- Backend reads must check both the current user and resource ownership.
- Uploads, outbound requests, and model calls must state size, rate, cost, and SSRF limits.
- User-visible copy in this edition is English. This is not an official BeefTV rule. Upstream still asks for Chinese copy.

A pull request should include a summary, the risk, how you verified it, and screenshots when the UI changes.

## License of contributions

From the commit that introduced the current license, new original material is contributed under [Part A of `LICENSE` (BeefTV Source Available License 1.0)](LICENSE). You need the right to grant that permission. Keep existing attribution and license notices, and mark third-party or historical MIT material with its source and terms. Do not submit someone else's code, media, or an employer's work as if it were yours to license.

Original contributions intentionally submitted under Part A also grant the maintainers of the official `glanderness/BeefTV` repository the non-exclusive, perpetual, irrevocable, worldwide, royalty-free copyright license in section 8 of that part: to copy, modify, distribute, and relicense that contribution under the community license or under separate commercial terms. You keep the copyright. This is not an assignment, it does not reach back to older contributions, and it does not cover third-party material. If you do not accept that grant, say so before the contribution is accepted so a maintainer can decide what to do.

Contributions already released under MIT stay MIT. Material that must use a compatible license because of the GPL or a similar term cannot be forced under Part A. Mark that material and explain the compatibility. See the [license notes](docs/content/docs/overview/licensing.mdx).
