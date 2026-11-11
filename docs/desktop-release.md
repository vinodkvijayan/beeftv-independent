#BeefTV Desktop Publishing

Public distribution is subject to [Licensing and Source Delivery of Media Components](media-source-distribution.md). The pipeline will come with the license file and macOS ffprobe source code package; the complete source code materials of the pre-built components still need to be implemented by the distributor, and a successful build cannot be regarded as completing all license obligations.

The production desktop package uses `VERSION` in the repository root directory as the only version source. The release script injects the version number, current Git commit, and UTC build time into both the front-end and Go back-end, and generates a Wails application package that does not rely on the Vite development server.

Production packages with automatic updates also need to inject the update source address and Ed25519 public key. See "Desktop Automatic Updates" below for keys, draft releases, signature lists, and rollback semantics. `v1.5.2` and previous installation packages do not contain an updater, and you cannot rely on the reissue list to automatically update already installed binaries.

Local contract checking remains the responsibility of `scripts/verify-beeftv-local-release.sh`. The macOS publishing script will run the access control first; the Windows publishing script only does local packaging and does not repeat the entire set of access control.

The default size limit for front-end uncompressed products is 105 MiB, adjustable via `BEEFTV_WEB_BUDGET_MIB`. Mainline baseline with FFmpeg, MediaPipe, and preset assets is ~99.24 MiB; auto-update increments are ~25 KiB. This limit is not the zip download size.

## macOS

```bash
./scripts/build-beeftv-release.sh
```

macOS builds build and verify native media detection components from fixed source and do not require the build machine to have BeefTV pre-installed. Additional encoders can be provided with `BEEFTV_FFMPEG_RUNTIME`, and the license file is specified with `BEEFTV_FFMPEG_LICENSE` (default search is in the same directory as `ffmpeg.LICENSE`); the build fails when explicitly specified but missing or not executable. The encoder target architecture and system dynamic library dependencies are still verified when packaging, and public distribution must meet the above media component delivery requirements.

If the system does not have global Go, you can specify the local tool chain directory through `BEEFTV_GO_DIR`:

```bash
BEEFTV_GO_DIR=/tmp/beeftv-go.rpIfVN/go ./scripts/build-beeftv-release.sh
```

Additional environment variables are required to produce automatic update packages:

| Variable | Function |
| --- | --- |
| `BEEFTV_UPDATER_PUBLIC_KEY` | Inject the update source public key; by default, the updater remains closed |
| `BEEFTV_UPDATER_FEED_URL` | Optional, default official `desktop-update-v2.json` address (`v2.0.6` and earlier versions use `desktop-update.json`) |
| `BEEFTV_WAILS_PLATFORM` | Optional, such as `darwin/arm64` or `darwin/amd64` |
| `BEEFTV_SKIP_LOCAL_VERIFY` | When set to `1`, the local access control is skipped; the verification job of the release pipeline will run the access control |
| `BEEFTV_EXTRA_LDFLAGS` | Append to Wails `-ldflags` |

Products:

```text
backend/cmd/desktop/build/bin/BeefTV.app
backend/cmd/desktop/build/bin/BeefTV.app/Contents/Resources/plugin-packages/*.beeftv-plugin
backend/cmd/desktop/build/bin/BeefTV.app/Contents/Resources/agent-host/bundled-plugins/{beeftv-plugin-market,beeftv-plugin-ll2,beeftv-plugin-ysdui}
```

Key points for acceptance:

- `backend/cmd/desktop/build/bin/BeefTV.app` exists;
- Wails compiles `frontend/dist` into the application binary; `Contents/MacOS/BeefTV` should exist in the application package, and `Compiling frontend` and `Packaging application` are confirmed by the build log;
- `CFBundleShortVersionString` and `CFBundleVersion` of macOS `Info.plist` are consistent with the root directory `VERSION` (remove the `v` prefix);
- The version information returned by `/api/health/live` and `/api/system/version` comes from the same release metadata;
- Release launch of Vite development server that does not require `127.0.0.1:3000`.

## Windows (amd64, must be executed on Windows native machine)

Execute in the warehouse root directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-beeftv-windows-release.ps1
```

Products:

```text
backend\cmd\desktop\build\bin\BeefTV.exe
backend\cmd\desktop\build\bin\plugin-packages\*.beeftv-plugin
backend\cmd\desktop\build\bin\agent-host\bundled-plugins\{beeftv-plugin-market,beeftv-plugin-ll2,beeftv-plugin-ysdui}
```

The official protocol plug-in archive (`*.beeftv-plugin`) must be placed in `plugin-packages\` in the same directory as `BeefTV.exe` (subdirectories cannot be placed under `plugin-packages\`, otherwise the in-application update verification of the published client will be rejected); the package pi plug-in directory (according to the `plugin-packages/bundled-plugin-dirs.txt` list) is placed under `agent-host\bundled-plugins\`, and the entire tree is updated with `agent-host`. When starting from the start menu, shortcut or resource manager, the working directory is not necessarily the directory where the warehouse or exe is located; the application searches for the official plug-in and packaged plug-in directories based on the location of the executable file, and does not rely on the current working directory.

### Native prerequisites

The script will exit when it finds that the tool is missing. It will not install global tools or change the user's PATH.

| Premise | Purpose | Basis |
| --- | --- | --- |
| Windows 10/11 amd64 | Wails Windows target | [Wails CLI platforms](https://wails.io/docs/reference/cli) |
| Go 1.25 or newer and in PATH (or `BEEFTV_GO_DIR\bin\go.exe`) | Compiling the desktop backend; `backend/go.mod` requires 1.25 | Repository `backend/go.mod` |
| Bun in PATH | `bun install --frozen-lockfile` and `bun run build:desktop` of `wails.json` | Warehouse `backend/cmd/desktop/wails.json` |
| `CGO_ENABLED` cannot be `0` | `gorm.io/driver/sqlite` depends on `github.com/mattn/go-sqlite3` | [go-sqlite3 README](https://github.com/mattn/go-sqlite3#windows) |
| `gcc`/`clang` in PATH, or executable `CC` | Compile go-sqlite3. Go 1.25 onwards Windows CGO requires GCC with DWARF 5 support (binutils 2.37 or newer) | [go-sqlite3 Windows](https://github.com/mattn/go-sqlite3#windows)、[Go Minimum Requirements · cgo](https://go.dev/wiki/MinimumRequirements#cgo) |
| Already have `plugin-packages/*.beeftv-plugin`, or can be packaged on site | The official protocol package is a runtime dependency | Warehouse `plugin-packages/build-packages.sh` |
| Microsoft WebView2 Runtime | Run Wails window. Windows 11 is usually installed | [Wails Windows](https://wails.io/docs/guides/windows)、[Wails installation](https://wails.io/docs/gettingstarted/installation) |

The order when packaging official plug-ins on site:

1. If you already have `plugin-packages/*.beeftv-plugin`, use it directly;
2. Otherwise, if the local machine has `bash`, `zip` and `node`, call the existing `plugin-packages/build-packages.sh`;
3. Otherwise, use Bun or Node to run `plugin-packages/embed-documentation.mjs`, and then use PowerShell to write the zip with forward slash path. Backslash paths will be rejected by plugin validation.

The build uses the same Wails module `github.com/wailsapp/wails/v2/cmd/wails@v2.16.0` as macOS, and explicitly passes in `-platform windows/amd64`, `-webview2 download`. Wails writes the production binary to `build/bin`. When WebView2 is missing, the download policy prompts to install the official bootstrapper.

This script does not generate an NSIS installation package. Wails' `-nsis` requires NSIS to be installed separately, and whether the default installation script contains `plugin-packages\` has not been verified by this repository. The currently supported release form is: distribute `BeefTV.exe` together with `plugin-packages\` next to it.

### NSIS installation package

`scripts/package-desktop-installer.py --platform windows-amd64` calls `scripts/installers/windows.nsi` to type `BeefTV.exe`, `plugin-packages\`, `agent-host\`, `cli\`, `media-runtime\` and other loads into `BeefTV-vX.Y.Z-windows-amd64-setup.exe`.

- 安装位置可选。默认 `%LOCALAPPDATA%\Programs\BeefTV`；覆盖安装默认沿用上一次的安装位置（读取注册表 `InstallLocation`），用户仍可另选。静默安装用 `/D=<目录>` 指定。
- 无论选择哪个文件夹，安装包都装入其下名为 `BeefTV` 的子目录：选择 `D:\Apps` 会安装到 `D:\Apps\BeefTV`。
- 安装器以当前用户权限运行（`RequestExecutionLevel user`）。它会拒绝盘符根目录、非空的非 BeefTV 目录（避免覆盖用户数据）以及当前用户无写权限的目录（例如 `Program Files`，需改用其他文件夹），并在目录页给出提示。
- 卸载只删除随包文件、`agent-host`、`plugin-packages`、`cli`、`media-runtime` 和根目录清单内的文件；未知用户文件保留。安装位置的临时暂存和备份目录与被替换目录同卷，替换完成前不删除旧程序。

An exe cross-compiled on a non-Windows host cannot be regarded as passing Windows acceptance.

## Startup directory and data directory

The default data directory of the desktop process comes from Go's `os.UserConfigDir()`, and then spells it as `BeefTV`:

| System | Default Data Directory |
| --- | --- |
| Windows | `%AppData%\BeefTV`（Roaming） |
| macOS | `~/Library/Application Support/BeefTV` |

其中包含 SQLite、本地资源和迁移备份。隔离调试时设置 `CANVAS_DESKTOP_DATA_DIR`，或启动桌面程序时传入 `--data-dir=/绝对路径/独立测试目录`；启动参数优先于环境变量，拒绝相对路径和文件系统根目录。`CANVAS_BACKEND_DATA_DIR` 只作用于 `cmd/server`，不会改桌面数据目录。

The official plug-in source directory is a read-only input in the installation package; it will be copied to `plugin-packages\` in the data directory after startup. The desktop backend cannot complete startup when the source directory cannot be found.

Restrictions to know:

- Unsigned `BeefTV.exe` may be intercepted by SmartScreen; this script does not sign it.
- The script fails when the build machine does not have a C compiler. If a common MSYS2/MinGW path exists but is not in PATH, the script will point out the path and will not automatically add it to PATH.
- The database connection string currently splices the data directory directly with `/open_ai_canvas.db`. Windows generally accepts forward slashes; if `?` or `#` appears in the data directory name, it may be regarded as a DSN parameter.

Stop the Wails/Vite development process before publishing to avoid concurrent writing of development output to the same directory as the production build.

## Desktop automatic update

Automatic updates only serve users who have installed the "production package with updater". Checking, downloading, and installation are all completed within the application; the running version will not be replaced before installation and restart.

### Existing installation

There is no updater in the `v1.5.2` and previous installation packages. Adding update sources or signature lists to the repository will not allow these already installed versions to be upgraded by themselves.

Users need to manually download and install the first version with an updater first. You can then check for updates in the app. Projects, materials, settings, BeefTV account connections and custom plug-ins will remain in the original data directory and will not follow the installation package.

### Data that will be retained

The update package only replaces the application itself:

| System | Replaced | Will not receive update package and will not be replaced |
| --- | --- | --- |
| macOS | `BeefTV.app` | `~/Library/Application Support/BeefTV` |
| Windows | `BeefTV.exe` and next to `plugin-packages\*.beeftv-plugin` | `%AppData%\BeefTV` |

The application package identity and executable path remain unchanged, so the front-end IndexedDB will continue to be available. Official plug-ins are updated with the application package; plug-ins installed by users will remain if they are placed in the data directory.

Programs and data must use separate directories. In particular, do not unzip the Windows zip to `%AppData%\BeefTV`, and do not point `CANVAS_DESKTOP_DATA_DIR` to the directory where the exe is located. The updater will reject such directory overlaps before exiting.

The update package is prohibited from bringing `.env`, SQLite database and `.settings-key`. When the packaging tool encounters the user data directory, it will be directly rejected.

### Update Signature and Apple Signature

These are two separate things.

- **Update signature**: Ed25519 signed the list in `desktop-update.json`. The manifest states the download address, SHA-256 and size of each system package. The application verifies the signature using the compiled public key and then checks the zip hash. It does not rely on Apple certificates or use business cloud interfaces.
- **Apple Signature/Notarization**: Determines whether the downloaded `.app` can pass Gatekeeper's default trust check. Existing macOS scripts still use ad hoc `codesign --sign -` without Developer ID status or Apple notarization; first manual installation may be blocked. The updater itself does not rely on Apple certificates, but does require Developer ID Application signature and Apple notarization so that users do not need to manually release it. For first-time installation instructions, see [Quick Start](../QUICKSTART.md#Download and first-time opening).

Release acceptance must record the results of the installation package hash, `codesign --verify --deep --strict` and `spctl --assess --type execute --verbose=4` respectively. Passing the first two items does not mean Gatekeeper release; it also needs to be downloaded, decompressed and opened from Finder for the first time on a Mac without historical release records through a browser for acceptance. When GitHub and Cloudflare provide the same byte package, it does not change Apple's determination of the app signature.

Windows does not currently do Authenticode signing either. SmartScreen may block first manual installation.

### Key

Generate it locally, do not write it into the warehouse, and do not print the private key in the terminal:

```bash
cd backend
go run ./cmd/update-release gen-key \
  --private-key /path/to/beeftv-updater.private \
  --public-key /path/to/beeftv-updater.public
```

The private key file permissions are `0600` and the content is the standard Base64 of a 64-byte Ed25519 private key. The public key is a standard Base64 32-byte public key.

GitHub repository configuration:

| Location | Name | Content |
| --- | --- | --- |
| Actions secret | `BEEFTV_UPDATER_PRIVATE_KEY` | Full text of private key file |
| Actions variable | `BEEFTV_UPDATER_PUBLIC_KEY` | Full text of public key file |

The release pipeline will use the private key to derive the public key, which must be consistent with the variable, otherwise it will fail and the unsigned update source will not be released.

When you want to download a package with an updater locally, just export the public key:

```bash
export BEEFTV_UPDATER_PUBLIC_KEY="$(tr -d '[:space:]' < /path/to/beeftv-updater.public)"
./scripts/build-beeftv-release.sh
```

The script will write the following two link-time variables into the binary:

- `infinite-canvas/backend/internal/desktopupdate.FeedURL` = `https://updates.beefapi.com/beeftv/desktop-update-v2.json` (`v2.1.0+`; `v2.0.6` and previously `desktop-update.json`)
- `infinite-canvas/backend/internal/desktopupdate.PublicKey` = public key Base64

When both are empty, the updater in the app remains closed but still displays the current version.

**Lost private key**: The package that has been sent out only recognizes the public key compiled at that time. The list signed by the new key cannot be verified by the old package. Changing the key is equivalent to re-issuing a boot package that requires manual installation by the user. Do not rotate production keys unless the old private key has been compromised or is confirmed lost.

**Leaking the private key**: Immediately disable the automatic update source (do not publish manifests signed with this key again), replace the key with a new one, and let users manually install the new boot package.

### Publish

The version number only comes from the warehouse root directory `VERSION` and must be stable `vMAJOR.MINOR.PATCH`. Do not use the pre-release number, and do not poll by the commit SHA of `main`.

The official file name is fixed as:

```text
BeefTV-vX.Y.Z-darwin-arm64.zip
BeefTV-vX.Y.Z-darwin-amd64.zip
BeefTV-vX.Y.Z-windows-amd64.zip
BeefTV-vX.Y.Z-linux-amd64.zip
BeefTV-vX.Y.Z-<platform>-from-vA.B.C.delta.zip
desktop-update.json
desktop-update-v2.json
```

The `desktop-*` temporary installation package in Actions is retained for 7 days and is used for file transfer between release tasks and short-term troubleshooting. Official GitHub Release and R2 downloads are not affected by this deadline. Before clearing historical temporary packages, you should confirm that the corresponding release task is successful, and that the platform installation package and update list of the corresponding version are complete; packages and upgrade verification reports that have not been confirmed to be successfully released will be retained.

Layout in zip:

- macOS: `BeefTV.app/...`, retain executable permissions; internal secure symlinks will be decoded into normal files and will not be written as zip symlink items. The included plug-in directory is located at `Contents/Resources/agent-host/bundled-plugins/`.
- Windows: `BeefTV.exe`, `plugin-packages/*.beeftv-plugin` (flat files only) and `agent-host/` (including `agent-host/bundled-plugins/` packaged plug-in directory) in the root directory.
- Linux x64: `BeefTV-linux/` includes `BeefTV`, `cli/beeftv`, `agent-host/` (including the plug-in directory included with `agent-host/bundled-plugins/`) and `plugin-packages/`. Built natively on Ubuntu 24.04, using GTK3 and WebKitGTK 4.1; for installation dependencies and startup methods, see [Linux Installation Instructions](linux-install.md). Updates and rollbacks replace the entire program directory, leaving user data in the configuration directory.

The new version update list and installation package use Cloudflare R2 (domestic source mirrors are synchronized to CNB `https://cnb.cool/beeftv-downloads/desktop`):

```text
https://updates.beefapi.com/beeftv/desktop-update.json
https://updates.beefapi.com/beeftv/desktop-update-v2.json
```

`v2.0.6` 及更早客户端使用 `desktop-update.json`（`schema: 1`，严格解码，只含单 `url`）；`v2.1.0` 起使用 `desktop-update-v2.json`（`schema: 2`，含 `urls: [国内源, R2]` 或 `[R2]`，并可选携带 `deltas[fromVersion]` 增量包）。客户端按系统时区或语言判断：中国大陆优先连接国内源（CNB），其他地区优先 R2；任一源连接失败、超时或持续低速时自动切换另一源并从已下载字节续传，最终以同一份 `sha256` 校验为准。

When `desktop-update-v2.json` contains `deltas[currentVersion]` that matches the current running version, the `v2.1.0+` client gives priority to downloading the incremental package `BeefTV-vX.Y.Z-<platform>-from-vA.B.C.delta.zip`: unchanged runtime files (such as `node`, `ffmpeg`, static plug-ins) are reused directly from the local installation directory and verified SHA-256 file by file. The main program executable file uses the built-in pure Go The binary differential patch (`BTDELTA1`) restores and verifies the new version SHA-256, compressing the regular upgrade download size from 160–280 MB to a few MB. If the installed files on the local machine are missing or have inconsistent hashes, or the incremental package download/verification fails, the updater will automatically and seamlessly fall back to downloading and installing the complete platform `.zip`.

The pipeline first verifies the conditional writing capabilities of R2 and legacy COS manifest entries, and then builds the draft. The four platform construction tasks save the package as an Actions product. After collecting them all, build and self-check `.delta.zip` of the four platforms based on the last official version of the platform `.zip` (if the previous official version lacks the corresponding `.zip`, skip the incremental package), generate a signature list, first write the version package (including complete `.zip` and `.delta.zip`) and the version list into the R2 immutable path and read it back completely from the public address for verification. Then publish a GitHub Release, replace the latest R2 list according to the old ETag conditions (while activating `desktop-update-v2.json` containing only the R2 address), and then synchronize the activated original signature envelope to the legacy COS list entry. Then the `mirror` job triggers CNB to synchronize four installation packages, four complete update ZIPs and (if existing) four incremental `.delta.zip` to CNB and complete anonymous Range resume transmission and complete SHA-256 verification, and perform anonymous HTTP 206 resume transmission and complete SHA-256 on the GitHub Actions side again for all update ZIPs (including `.delta.zip`). Verification, only after all verifications are passed will the `desktop-update-v2.json` condition containing the domestic source and R2 dual source addresses be activated to R2; if the mirroring job fails, you only need to rerun `mirror-desktop.yml`, and do not need to rerun the entire release. Failure or missing packages will not activate the R2 update source. Failure in COS synchronization will cause the release job to fail, but will not roll back the active R2 manifest or delete the official GitHub Release.

The Linux release task will extract the packaged CLI from the final ZIP and launch the desktop program in Xvfb, confirming the local backend and visible windows. PR's `Linux desktop package checks` performs the same build and launch checks ahead of time, without releasing a version or calling a paid model.

Updaters v1.5.6 and earlier still have a built-in GitHub manifest address. If the old client cannot connect to GitHub, you need to manually install the new version first; the remote manifest cannot overwrite programs that have not been updated. Subsequent historical clients have built-in `updates.beefapi.com` or COS list addresses, so migration must retain these two types of entries and cannot just modify the FeedURL in the new package. The old signature envelope, version object and contained download address remain intact; the original COS package can still be read. Even if the signed manifest before migration is placed in R2, its internal COS address will not be automatically changed to R2; the download address will be switched through the new signature manifest released normally next time, and the same version will not be rebuilt or re-signed.

### R2 release configuration

Use the original `beeftv-releases` bucket and custom domain name `updates.beefapi.com` to store only public release documents. Actions uses the original Secret `BEEFTV_R2_ACCESS_KEY_ID`, `BEEFTV_R2_SECRET_ACCESS_KEY` and Variable `BEEFTV_R2_ENDPOINT`, and the region is `auto`. The update signing key remains unchanged. The version object is cached for a long time and is immutable. The latest list prohibits caching; production downloads do not use the current-limited `r2.dev` development domain name.

`scripts/publish-desktop-r2.py` uses R2 by default. `stage` performs full readback on the storage side and full size/SHA256 verification on the public network; `activate` still requires the latest official version of GitHub to be consistent with the original signature envelope. The formal job shares `--verification-receipt "$RUNNER_TEMP/release-public-verification.json"` between the two steps, retains two rounds of complete reads, and performs a conditional Range check on packages with valid receipts when activated. Receipts are not uploaded or reused across jobs, and the list is always fully read and verified.

`bridge-cos` is only used for clients with built-in COS update address. It is fixed to verify the four platform ZIP, version list, activated latest list and GitHub latest official version from `https://updates.beefapi.com/beeftv`, and then backup, conditional update and completely read back the original COS latest list through the following COS lock and claim protocol. Only writes small manifests and backups, and does not copy new installation packages to COS; it does not accept installer staging or cross-store receipt shortcut checks. The packet address in the update source continues to point to R2. After failure, the official release status of R2 is retained, and legacy locks are handled according to COS recovery instructions. Old entries cannot be overwritten unconditionally.

Before switching the original COS redirection rules of the custom domain name, first check the original R2 domain name binding, historical file list, and the original file size/SHA256 of the new version; only the missing objects are filled in, and the existing content is stopped at the same time. Keep the original redirection rules as rollback data. Source code merging, R2 file preparation, public domain name switching and next desktop release are recorded for acceptance respectively, and merging cannot be regarded as switching.

### Legacy COS inventory entry and manual recovery

Keep the original `beeftv/` file and `beeftv/desktop-update.json` update entry of Guangzhou public bucket `beeftv-components-1481187348`. Only a small manifest is synced here for historical clients; new packages are provided by R2. The migration of the old updated domain name is verified separately from the official website release, and the update signature key is not changed.

Warehouse Actions require the following configuration:

- Secret `BEEFTV_COS_ACCESS_KEY_ID`, `BEEFTV_COS_SECRET_ACCESS_KEY`: Only have required object read and write permissions on the release prefix, without using the account administrator token. Only the test object of `beeftv/.publication-probes/` and the release lock of `beeftv/.publication-locks/` are allowed to be deleted; delete permission should not be granted to release files and `beeftv/.publication-claims/`. Locks and claims are not configured for lifecycle or automatic cleanup, and bucket versioning must remain turned off; turning versioning on or pausing invalidates the guarantee against overwriting.
- Legacy entrance fixed endpoint `https://cos.ap-guangzhou.myqcloud.com`, region `ap-guangzhou`, bucket `beeftv-components-1481187348`, using virtual host addressing.
- The original `BEEFTV_UPDATER_PRIVATE_KEY` and `BEEFTV_UPDATER_PUBLIC_KEY` remain unchanged.

`scripts/publish-desktop-r2.py` retains the historical file name, supports `--provider cos|r2`, and reuses `update-release verify` for signature verification. COS uses the Python standard library and a single HTTP request signed by SigV4 to atomically create dependency `x-cos-forbid-overwrite: true`; R2 retains the native `IfMatch` and `IfNoneMatch` of AWS CLI v2. COS's S3-compatible interface may ignore these S3 conditional headers and cannot use them to protect COS's latest manifest. Each operation first verifies that native overwriting is prohibited and the original bytes remain unchanged on a random object in the target bucket; if a failure is detected, the issuance is stopped immediately.

COS publishing uses the following objects. Public download files and internal publishing objects have fixed prefixes:

- 不可变版本文件：`beeftv/vX.Y.Z/<文件名>`，使用原生禁止覆盖创建，已有内容逐字节核验。
- 发布锁：`beeftv/.publication-locks/<SHA256(目标key)>.json`，按目标固定命名，包含随机 nonce、GitHub 仓库/run/attempt/job 和创建时间。时间仅供排障，不是自动接管期限。创建回执丢失时只读回同一 nonce，不盲重发创建。
- ETag 消费记录：`beeftv/.publication-claims/<SHA256(JSON([目标key,预期ETag]))>.json`，原子创建后永久保留，记录预期 ETag、下一份完整字节的大小/SHA256 和持锁者。同一预期 ETag 只能消费一次。首次清单不存在时使用 JSON `null`，不使用随机值或字符串 `"null"`；另一目标使用不同标识。
- 测试对象及其 claim：`beeftv/.publication-probes/`，与正式 claim 隔离，成功后清理。真云双客户端探针需要显式运行 `python3 scripts/probe-desktop-cos.py --run`，不在普通本地单测中请求云端。

The latest list reads and checks the expected ETag during the lock period, then creates the consumption record atomically, and finally uploads it and reads it back completely for verification. Reject writing when the consumption record exists, preventing the COS origin station from repeatedly performing the same replacement when it briefly reads the old ETag. When the target PUT is not expected to exist, the target PUT also has a native prohibition of overwriting to prevent the short-lived 404 in the history list from being mistaken for the first release when there is no null claim; when the target already exists and returns 409, it refuses to write and retains the claim. The receipt of the consumption record or target write is uncertain. When the readback fails, the lock and the written claim are retained, and subsequent publishing is stopped. Only confirm your own nonce before unlocking, and DELETE is only sent once; only HTTP 200/204 counts as release confirmation. Non-successful status or lost receipt will always report "Unconfirmed Unlock". Subsequent GET 404 cannot prove that the deletion is successful, nor can it be repeated based on this to avoid deleting the lock of the next lock holder.

All tools that write up-to-date manifests, initial migrations, and manual operations must adhere to the same lock and claim protocol. The latest manifest cannot be unconditionally overwritten with COSCMD, a universal replication script, or another set of publishers. Before migrating, confirm that the old release job has ended and release credentials must not modify the bucket versioning or life cycle.

`stage` 只准备版本对象；`activate` 确认 GitHub 最新正式版本及公开清单与本次签名清单一致、全部公开对象可校验后，备份上一份清单，再执行上述条件更新。公网检查使用该版本客户端的请求标识。重复执行已成功的同一版本是幂等的，已有对象内容不同或试图降级会失败。历史 R2 操作必须显式指定 `--provider r2 --region auto --bucket beeftv-releases --endpoint-url <原账户端点> --public-base https://updates.beefapi.com/beeftv`。

The local receipts of `stage` and `activate` are bound to the signature envelope, storage configuration and GitHub warehouse/run/attempt/job, and are not uploaded as products, nor reused across jobs or releases. Legacy COS manual operations must explicitly specify `--provider cos`; bridge commands do not borrow R2's storage receipt.

Only COS's `activate` uses a receipt quick check: first use a random error ETag to confirm that the object rejects the request and returns 412, then sends `If-Match` with the original strong ETag and the first 1024 bytes of Range request, check 206, ETag, Content-Range, size and the fragment hash. File changes, missing files, invalid conditional requests, not supporting the required Range, or returning different fragments will prevent activation. When there is no receipt or complete verification, files lacking a strong ETag will still be fully verified; if a receipt exists but does not match the current release or job, an error will be reported directly. The list is always fully read, signed, and checked, and the lock and claim protocols remain unchanged; `resume` does not use receipt quick checks. COS large packet transmission is reduced from three rounds to two rounds, and activation only adds 1 KiB per packet and one rejection probe.

The CF cache hit of R2 custom domain name may ignore `If-Match`, and the above HTTP certificate cannot be reused. R2's `stage`, `activate`, and R2 origin checks in the COS bridge all fully read the exposed file and check SHA256; R2 receipts still verify the job binding, but do not log or reuse the HTTP attestation of the package. Complete verification does not incur R2 external network downlink traffic charges, and storage and requests are still billed according to actual usage. Conditional PUT on the R2 storage side is verified separately from public cache reads, and the latest manifests continue to use conditional activation and full readback.

#### Manual recovery of legacy locks and unfinished claims

The lock does not automatically expire, nor can you delete the claim and try another listing. `resume` only processes the same failed write that has not been unlocked. The following on-site evidence must be obtained before execution:

1. Manually freeze all latest list writers, including Actions, initial migration and manual release; check that there is no subsequent release. Save the GitHub Actions status and original log according to the original locked warehouse, run, attempt, and job, and confirm that the entire original attempt has terminated and the process has stopped.
2. Confirm that all COS PUTs in transit have ended. The job final status itself cannot prove that a remote PUT that lost a receipt has ended. If necessary, use the COS request log to check. The original release log must also prove that the DELETE that released the lock was never sent. `resume` is prohibited if the DELETE has been sent, the receipt is unknown, the log is incomplete, or cannot be confirmed; old lock GETs may be stale values ​​and cannot replace these evidences.
3. Read and save the original lock and the complete original bytes of the corresponding claim from COS without reformatting JSON. Check fixed target `beeftv/desktop-update.json`, original nonce, claim's publisher, expected ETag and next copy size/SHA256, and retrieve the original signed envelope. When the claim does not exist or its receipt is unknown, another claim cannot be generated based on a GET 404; first check the original request result.

In a controlled environment configured with issuing COS credentials, official update public keys `BEEFTV_UPDATER_PUBLIC_KEY` and `gh` certification, execute from the repository root directory:

```bash
go -C backend build -o /tmp/beeftv-update-release ./cmd/update-release
python3 scripts/publish-desktop-r2.py resume \
  --provider cos --endpoint-url https://cos.ap-guangzhou.myqcloud.com \
  --region ap-guangzhou --bucket beeftv-components-1481187348 \
  --public-base https://beeftv-components-1481187348.cos.ap-guangzhou.myqcloud.com/beeftv \
  --manifest /path/to/original-desktop-update.json \
  --verifier /tmp/beeftv-update-release \
  --lock-document /path/to/original-lock.json \
  --claim-document /path/to/original-claim.json \
  --confirm-writers-frozen --confirm-no-inflight-put --confirm-no-unlock-attempt
```

The three confirmation parameters respectively indicate that the operator has obtained the above-mentioned freezing, PUT completion in transit, and never unlocked evidence; if it cannot be obtained, it will not be executed. The portal will self-check the GitHub API status of the official `glanderness/BeefTV` original run/attempt, re-verify and check the public documents of the four platforms and the precise list of bytes of the latest official version of GitHub, and then match the current lock/claim byte by byte. It only accepts the same envelope corresponding to the original claim size/SHA256, and does not create a new nonce or claim, nor delete a claim. When the target is already in this list, only the original lock is verified and released; when the target is still the original ETag, the same list is continued. If it does not exist for the first time, the native prohibition of overwriting is still used. Transmission of other states and different nonces/targets/bytes will be stopped. Only send an unlocking DELETE after a complete readback of the match, non-HTTP 200/204 will still report unconfirmed.

If the original fault came from `bridge-cos`, change the command to `resume-cos-bridge` using exactly the same parameters and evidence. It always checks the package, version manifest, and the latest activated manifest from R2, then restores the original COS claim and reads back the latest manifest from COS in its entirety; it does not accept installer staging or verification receipts. The plain `resume` is still used for historical releases where the package address belongs to COS.

Failures for which DELETE was attempted do not belong to this recovery entry. First keep all writers frozen, verify the final public feed and the original request log, and then let the operator handle the remaining locks alone; resending PUT or blind deletion by recovery is not allowed. Normal issuance resumes after recording evidence of recovery.

Before switching to the public entrance, it is necessary to copy and verify all packages and original signature envelopes that retain historical versions, record the size and complete SHA256 item by item, verify anonymous downloads, range resumes, and the actual updates after reading the original feed of the installed old version. If the COS current origin site fails the conditional write self-test, it is allowed to prepare historical copies and read compatible copies, but it cannot activate a new latest list.

If GitHub publishing succeeds but storage activation fails, the official version and all immutable objects are retained. First check the storage and public entries; only when there are no remaining locks and unfinished claims, rerun the original command with the same version of the original list (R2 is `activate`, the old entry is `bridge-cos`), otherwise the above recovery conditions are followed. Do not remove official tags or rebuild the same version of the package with different content. When the condition is written successfully but the final readback fails, the new list may have taken effect and cannot be treated as unpublished. Clients that have already installed a new version are not automatically downgraded.

Manually run `.github/workflows/release-desktop.yml` on `main` on `glanderness/BeefTV`. The input `confirm_version` must be consistent with `VERSION`. `CHANGELOG.md` must have a corresponding `## vX.Y.Z` paragraph, and this text will become `notes` in both the GitHub Release description and the manifest.

The workflow will reject:

- Published on non-`main`, unofficial repository
- Missing key or mismatch between public and private keys
- Label or Release already exists (including draft)
- The new version is no higher than the already released stable version
- Signed before all four platform packages were collected

Apple notarization is not included in this workflow. macOS jobs inherit the ad hoc signature of existing scripts. Windows jobs install MSYS2 UCRT64 GCC and check binutils ≥ 2.37 to comply with DWARF 5 requirements of Go 1.25; do not use Chocolatey mingw or older versions of TDM-GCC.

Resources of the same version are immutable. Do not overwrite published tags, zips or `desktop-update.json`.

Pack and sign locally (use test key, do not experiment with production private key):

```bash
cd backend
go run ./cmd/update-release package \
  --platform darwin-arm64 \
  --input cmd/desktop/build/bin/BeefTV.app \
  --output /tmp/BeefTV-vX.Y.Z-darwin-arm64.zip
go run ./cmd/update-release sign \
  --version vX.Y.Z \
  --commit "$(git rev-parse HEAD)" \
  --changelog ../CHANGELOG.md \
  --private-key /path/to/beeftv-updater.private \
  --expect-public-key "$(tr -d '[:space:]' < /path/to/beeftv-updater.public)" \
  --require-platforms darwin-arm64,darwin-amd64,windows-amd64,linux-amd64 \
  --asset darwin-arm64=/tmp/BeefTV-vX.Y.Z-darwin-arm64.zip \
  --asset darwin-amd64=/tmp/BeefTV-vX.Y.Z-darwin-amd64.zip \
  --asset windows-amd64=/tmp/BeefTV-vX.Y.Z-windows-amd64.zip \
  --asset linux-amd64=/tmp/BeefTV-vX.Y.Z-linux-amd64.zip \
  --output /tmp/desktop-update.json
```

### Rollback

The client verifies and prepares updates to the disk where the program is located before exiting; the currently running application is retained when there is no write permission, insufficient disk space, or a signature error. Replacement/launch failure attempts to restore the old program. The `.beeftv-update-*` directory next to the program temporarily stores old programs and recovery records; after the local backend is started, the interface is mounted, the material and canvas cache are successfully loaded, and the local workspace and two types of resource lists are read successfully, the client automatically cleans up the directories that have been successfully upgraded in the same installation location (including the legacy directories of the old version). Directories that failed, rolled back, were incompletely logged, or contained extra files are retained. Windows upgrade locks are deleted when the handle is closed; macOS reserves zero bytes `.BeefTV.update.lock` to prevent concurrent replacement of apps by assistants that still use the legacy lock protocol. It does not store upgrade packages or legacy programs. If the cleanup fails, it will not block the use and try again next time. The new process that has been started will not be automatically downgraded to avoid handing over the migrated database to the old program; when restoring the old program, you need to confirm the database compatibility or restore a matching data backup.

Published versions cannot be withdrawn. Users who have successfully updated will not return to the old package due to deletion of GitHub Release.

Found a problem with the new version:

1. Do not rewrite or delete this version of zip and `desktop-update.json`, others may still be downloading it.
2. Write the problem clearly in `CHANGELOG.md` and upgrade `VERSION` to a higher stable number.
3. Run the release workflow again from the repaired `main`.
4. Users who have installed the updater will get a higher version after checking for updates.

If a draft fails and has never been made public: After confirming that no user can download it, you can delete the draft and the corresponding tag and try again with the same `VERSION`. Do not reuse tags that have been made public.

`/releases/latest` points to the latest official version released, based on release time rather than the maximum version number. Only incremental stable releases are released in chronological order.
# Really generate access control

The release access control acceptance must be completed before each release. The `docs/release-evidence/` directory of the public warehouse only retains the single minimum release receipt `docs/release-evidence/<VERSION>.json` corresponding to the current `VERSION` (version number `version`, source code fingerprint `sourceDigest`, whether the release access control has passed `passed`, and the SHA-256 summary of the complete internal evidence file `evidenceSha256`). The complete acceptance details and authorization records are saved in the internal evidence directory, and when generating or reviewing the receipt locally, the byte hash is verified to be consistent with `evidenceSha256` through `node scripts/verify-real-generation-release.mjs --evidence-file <path>`; the release workflow of the public warehouse uses `node scripts/verify-real-generation-release.mjs` to verify the unique minimum receipt structure, `passed === true`, `evidenceSha256` format and the current release source code fingerprint `sourceDigest` before creating the draft. Bindings do not allow releases based solely on unit tests or health checks.