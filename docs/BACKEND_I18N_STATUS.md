# Backend translation status

This branch is unfinished work for a later 1.x to 2.0 pass. `main` and the Windows **v1.0.0** release do not include it.

## What is already on this branch

A machine-translation map was applied to Go, JSON, JavaScript, and Markdown string literals that were still Chinese when the map was built. The map is not a reviewed localization.

- Display strings, many errors, plugin descriptions, and agent-host text were replaced when the translator returned English.
- Short vendor-error needles (`strings.Contains` / prefix / regex, 8 Chinese characters or fewer) were left in Chinese on purpose. Those match replies from Chinese model APIs.
- Chinese numeral character classes were left unchanged.
- Strings the translator rejected, and the longest plugin manuals, are still Chinese.
- Tests were translated with the production strings. They have not been run. Expect failures where a matcher and a message no longer agree, or where a placeholder was altered.

## How to finish it

Follow [BACKEND_I18N_PLAN.md](BACKEND_I18N_PLAN.md). Suggested order for 1.x through 2.0:

1. Diff this branch against `main` and keep only replacements that are real user-facing sentences.
2. Move those sentences into a Go catalog instead of leaving them inline.
3. Re-check every `strings.Contains` that used to look for a Chinese sentence this branch translated.
4. Run `go test` on the packages that changed, then the agent-host tests.
5. Translate the remaining Chinese manuals under `docs/content/` and `plugin-packages/*/docs`.
6. Ship that as 2.0 only after the tests pass. Do not merge this branch into `main` as-is.

## Not done

- No Windows build of this branch.
- No review of translation quality.
- Format verbs (`%s`, `%d`, `%w`) were protected when the request succeeded, but rejected strings stayed Chinese rather than being fixed by hand.
