#BeefTV Local Desktop Version Quick Start

BeefTV Desktop is a local-first workspace that requires no login. Projects, canvases, materials, task records, and model configurations are saved locally by default; only when generating is executed, external model services will be requested through the channels you configured.

## Download and first open

Download the installation package corresponding to the system from [Official Release Page](https://github.com/glanderness/BeefTV/releases/latest)). For Mac, choose `darwin-arm64` for Apple chip and `darwin-amd64` for Intel chip; unzip and put `BeefTV.app` into "Application".

The Mac version has not yet been signed and notarized by Apple developers. When you open it for the first time, if it prompts "Apple cannot verify whether BeefTV.app contains malware", please first confirm that the installation package comes from the official release page, then open "System Settings → Privacy and Security", find BeefTV and click "Open Anyway", follow the system prompts to confirm. Macs that are managed by an organization may need to contact their administrator.

This is a macOS check for unnotarized apps, and changing the download address will not eliminate it. No need to shut down the entire system's security checks. For specific operations, see [Apple’s instructions for opening an app](https://support.apple.com/zh-cn/102445)。

For older versions that can be opened normally, you can check for updates within the app; the updater will verify the update manifest signature and installation package hash. These verifications are not equivalent to Apple notarization.

## Build desktop version

Environment requirements: Go 1.25, Bun, and system components required by Wails.

Execute in the warehouse root directory:

```bash
BEEFTV_GO_DIR=/path/to/go ./scripts/build-beeftv-release.sh
```

macOS apps output to `backend/cmd/desktop/build/bin/BeefTV.app`.

Windows amd64 must be built natively on Windows (requires Go, Bun in PATH, and GCC to compile go-sqlite3):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-beeftv-windows-release.ps1
```

The output is `backend\cmd\desktop\build\bin\BeefTV.exe`, with the official plugin next to `plugin-packages\`. See `docs/desktop-release.md` for prerequisites and data list.

After opening it for the first time, you will directly enter the local workspace, no registration or login is required.

## Configure model

Open "Model Configuration". BeefTV official computing power uses "Connect BeefTV", and you can pull the model after completing authorization in the system browser. Other channels still fill in the Base URL and key. The key is saved locally in the workspace and is not written to the canvas, assets, or task list.

Model requests may access external providers, but BeefTV does not sync project data to SaaS storage. The materials will be written to the local resource directory first, and then submitted to the model channel as a local resource reference.

## Local development and verification

When you need to debug the front and back ends at the same time, please refer to `scripts/beeftv-shared-dev.sh`. Verify local distribution boundaries:

```bash
BEEFTV_GO_DIR=/path/to/go ./scripts/verify-beeftv-local-release.sh
```

## Batch operations using the command line

The installation package comes with the `beeftv` command line tool, which can directly use shell scripts to read and organize canvases, materials, and tasks in batches without going through an assistant or starting the MCP service. The path for macOS is `/Applications/BeefTV.app/Contents/MacOS/cli/beeftv`, and for Windows it is `cli\beeftv.exe`, which is the same level as `BeefTV.exe`.

Select a tool on the "BeefTV MCP" page in the sidebar and "Generate Connection Configuration". The configuration already contains `BEEFTV_DATA_DIR`, `BEEFTV_CLIENT_ID` and `BEEFTV_CLIENT_TOKEN`. Just extract them and put them into environment variables; read-only credentials can only be read. Pure command line batch running does not require starting MCP. For complete usage, see [Basic usage of beeftv command line](docs/content/docs/backend/beeftv-cli.mdx).

## Data location and backup

The desktop runtime saves backups of SQLite databases, resource files, model configurations, and migrations in the local workspace. A database backup will be automatically created before upgrading and migrating; if you need to migrate or restore, please exit BeefTV and completely copy the workspace data directory.

Login, cloud storage, team sync and billing are not part of BeefTV local. Subject to local capability contract, streamlined schema and release access control, see `docs/local-first-architecture.md` for details.