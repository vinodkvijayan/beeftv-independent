#BeefTV Skills Official Access Pack

Provides a BeefTV canvas working skill, two generic skills, and a read-only market MCP connection. Public queries do not require a model key, contribution credentials, or a running BeefTV. Contributions are made through a separate CLI browser license; MCP does not provide upload, approval, or public publishing tools.

`skills/beeftv-canvas` is the same skill installed by the desktop version of "One-click access to Claude Code / Codex": it is written into the user-level skill directory of the corresponding Agent when the desktop version is connected, and removed when disconnected. The files here are the only editable source, with backend embedded copies synced by `scripts/sync-agent-skill.mjs`.

This directory is the source code of the access package to be reviewed. It does not mean that the public directory has been put on the shelves or that the production service has been opened. The production address can only be promoted to users after the backend and official website have completed deployment and joint debugging.

- `plugin.json`, `mcp.json`: Agent Plugins 1.0 format, used by Codex.
- `.claude-plugin/plugin.json`, `mcp.claude.json`: Claude Code adaptation, reusing the same Skill.
- Warehouses `.agents/plugins/marketplace.json` and `.claude-plugin/marketplace.json`: the warehouse source entrances of each host.
- `skills/`: BeefTV canvas working method, three workflows of searching for skills, and organizing submissions, without packaging the entire community directory.

Build the CLI locally: Execute `go -C backend build -o ../.local/bin/beeftv ./cmd/beeftv` in the repository root directory, then run `.local/bin/beeftv skills help`. Read-only MCP is located at `/api/beeftv/skillhub/v1/mcp`; defaults to remote HTTPS, local market can be specified explicitly when testing. The installation package does not run shell hooks or npm lifecycle scripts.

The host verification uses the command actually provided by it: Claude Code is `claude plugin validate ./plugins/beeftv-skills --strict`; the Codex list is based on the official Agent Plugins schema and the actual host version. Manifest verification does not equate to being installed, enabled, or in the official selection directory.

Source of specification: [OpenAI plug-in packaging](https://developers.openai.com/plugins/build/plugins)、[Claude plug-in list](https://code.claude.com/docs/en/plugins-reference)。