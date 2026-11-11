# Backend translation plan

This English edition translates the desktop UI and the repository documents. The Go backend, agent prompts, and skill packages are still Chinese. This file is the plan for that later work. It is not a translation, and no backend strings should be changed as part of this step.

## Goal

Make every message a person can see come out in English: API errors, task status, CLI help, desktop startup errors, and log lines that are shown in the app. Keep the program able to recognize Chinese error text that model vendors still return.

## Do not translate

These strings are matchers, not copy. Rewriting them makes the app miss real failures.

- Short needles passed to `strings.Contains`, `HasPrefix`, `HasSuffix`, or a regex, when they detect vendor text. Examples already in `backend/internal/generation/provider_error_rules.go`: `额度`, `供应商`, `频繁`, and sentences the provider sends back unchanged.
- Chinese numeral character classes used by parsers, such as the class of `零〇○一二两三四五六七八九十…`.
- JSON keys and protocol field names stored in projects, timelines, or plugin manifests.
- The license text in `LICENSE`.

A string that this codebase itself emits, and later checks with `strings.Contains`, should be translated on both sides in the same change so the check still matches.

## Do translate, in this order

1. User-visible Go strings: `fmt.Errorf`, HTTP `message` fields, task `Reason` and `Action`, and CLI usage in `backend/cmd/beeftv`.
2. The Go tests that assert those exact strings. Update the test in the same commit as the message.
3. Desktop startup and updater text in `backend/cmd/desktop`.
4. Agent instructions in `agent-host/system-prompt.mjs` and skill markdown. Do this last. Those strings change how the model behaves, so they need a separate review, not a blind replace.
5. Plugin package descriptions under `plugin-packages/`, after the host messages, because several manifests repeat the same long document.

## How to do it

Do not run a repo-wide search-and-replace again. An earlier pass treated every `[...]` string as a character class and skipped real log lines such as `[报文过大，已省略，共 %d 字节]`.

1. Extract string literals with a Go parser, and tag each one as `display` or `matcher` from the call around it.
2. Put display copy in a catalog, for example `backend/internal/i18n`, instead of scattering English through a thousand files. Matchers stay at the call site in the original Chinese.
3. Keep printf verbs exactly: `%s`, `%d`, `%w`, `%v`, `%q`, and indexed forms such as `%[1]s`. Reject a translation that drops or reorders them.
4. Update `web/src/pages/canvas/use-canvas-project-lifecycle.ts`. It still matches `尚未建立云端同步会话|未登录`. When those backend messages become English, match the new sentences and keep the Chinese alternatives so older local errors still count as expected.
5. Extend `web/src/services/skill-runtime.ts` only in the agent-prompt phase. Its regular expression detects Chinese “must read” skill lines. Add an English pattern then; do not delete the Chinese one until shipped skills are English.
6. Run `go test` on the packages whose assertions changed, then the existing Windows workflow.

## Suggested slices

| Slice | Surface | Check |
|---|---|---|
| 1 | Generation and provider errors | `go test ./backend/internal/generation/... ./backend/internal/app/ -count=1` |
| 2 | Task status and HTTP errors | App and HTTP tests that compare `message` |
| 3 | CLI and desktop shell | `go test ./backend/cmd/... -count=1` |
| 4 | Agent prompts and skills | Host tests plus one manual canvas turn |
| 5 | Plugin manifest descriptions | Plugin list still loads and IDs are unchanged |

## Out of scope for v1.0.0

v1.0.0 of this independent edition is the English UI, English repository documents, and the Windows installer. Backend messages in that build are still the upstream Chinese text.
