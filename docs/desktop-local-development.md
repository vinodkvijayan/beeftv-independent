# BeefTV local desktop development and acceptance

The desktop version of BeefTV is a Wails app: the frontend runs in a WebView, and the Go backend starts a loopback API in the same process that only listens to `127.0.0.1`. The desktop profile does not register the interactive login route, and the local workspace is created or read through `/api/workspace/bootstrap` on first startup.

## Data location

默认数据目录由 Go 的 `os.UserConfigDir()` 决定，最终目录为 `<系统用户配置目录>/BeefTV`。Windows 上是 `%AppData%\BeefTV`，macOS 上是 `~/Library/Application Support/BeefTV`。

This contains the local SQLite database, resource files, and migration backups. The isolation directory can be specified through environment variables during acceptance or debugging:

```bash
CANVAS_DESKTOP_DATA_DIR="$(mktemp -d /tmp/beeftv-data.XXXXXX)" \
  backend/cmd/desktop/build/bin/BeefTV.app/Contents/MacOS/BeefTV
```

Windows：

```powershell
$env:CANVAS_DESKTOP_DATA_DIR = Join-Path $env:TEMP "beeftv-data"
backend\cmd\desktop\build\bin\BeefTV.exe
```

This variable only changes the data directory, not the local workspace and no-login behavior of the application. The official plug-in is still loaded from `plugin-packages\` next to the executable file, not from the data directory.

## Develop and build

Unified browser preview with Wails dev (shares `web/src`, Vite `3000` and native Go API `8080`):

```bash
./scripts/beeftv-shared-dev.sh
```

The script generates a temporary desktop token for this development session and has the Vite agent automatically forward to the same Go backend; the production package still uses the random token and dynamic loopback port.

Front-end inspection:

```bash
cd web
bun test test/local-workspace-bootstrap.test.ts test/local-project-library.test.ts test/local-generation-pipeline.test.ts
bun run build
```

Backend check:

```bash
cd backend
go test ./internal/bootstrap ./internal/handler ./cmd/desktop -count=1
```

Build the macOS desktop package:

```bash
cd backend/cmd/desktop
go run github.com/wailsapp/wails/v2/cmd/wails@v2.16.0 build -clean -m -nosyncgomod
```

Products are located at:

```text
backend/cmd/desktop/build/bin/BeefTV.app
```

## Manual acceptance list

1. Start the new data directory, and the home page will directly enter the local workspace without the login/registration page appearing.
2. Create a canvas, add nodes and save; after exiting, use the same data directory to restart, and the project and nodes will still exist.
3. Open the project library and verify search, folder, rename, move, recycle bin recovery, and ZIP import and export.
4. Open "Creation History" and confirm that the `/tasks` request returns successfully without a login cookie.
5. After configuring an available model, verify the submission, polling, result writing back to the canvas and restart recovery of the generated task.

The desktop profile will also adapt the shared canvas and Agent entrance to local mode: the shared canvas returns to the local workspace, and the Agent does not regard the login cookie as a startup condition for the local workspace.

## Native window routing

The Wails 2.16 production package only hands `/` and `index.html` to the front-end runtime; deep paths (e.g. `/canvas/:id`) will fall to the resource handler and return 404. Native windows therefore use hash routing: refresh still requests `/`, and the canvas address looks like `/#/canvas/<id>`. Browser deployment continues to use the History path, and `/api` and media addresses do not enter the hash.

##Latest acceptance

- The unified development script has been verified: the Wails log shows `Frontend DevServer URL: http://127.0.0.1:3000`; the browser proxy and `/api/health/live` directly connected to the backend return the same `dev` build information; `/api/workspace/bootstrap` returns HTTP 200 via the browser proxy.

- The Wails 2.16.0 production package has been rebuilt and self-signed, with the product `backend/cmd/desktop/build/bin/BeefTV.app`.
- `go test ./internal/handler ./internal/bootstrap ./cmd/desktop -count=1` passed.
- The protocol-directed test passed.
- After reopening `.app`, the desktop process runs normally and enters the local workspace; after manually creating a "local acceptance canvas", exiting and restarting, the project library still displays the canvas and displays "All 2 canvases have been loaded."

The model API Key is only used in the local workspace configuration; the current repository does not provide a default Key, and the Key will not be written into the code or test fixture.