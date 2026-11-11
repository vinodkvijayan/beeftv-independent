# BeefTV local workspace data source boundary

The goal of the desktop profile is not to stuff all content into the same storage, but to have only one clear source of truth for each type of data; the browser cache is only responsible for display acceleration or compatibility downgrade, not cloud synchronization semantics.

| Data Domain | Local Source of Truth | Browser Side Responsibilities | Cloud Sync |
| --- | --- | --- | --- |
| Canvas, project, folder | Desktop: Go SQLite; Browser purely local: scoped IndexedDB/localForage | The first screen displays cache, uncommitted drafts and operation records; if the back-end read fails, an error will be displayed and the draft will be retained | Close |
| Material metadata | Desktop/hosted: Go SQLite `asset.Library` (`GET /assets?page=`, `POST /assets/batch`); browser purely local: scoped IndexedDB | Display cache and uncommitted drafts; query failure must not be displayed as an empty database | Close |
| Images, videos, audios, model binaries | Local file directory for Go resource service | Blob/Object URL cache | Close |
| Model channels and API Keys | `local-model-config.json` in the Go workspace data directory | Zustand image and form status | Close |
| Generate tasks, status, logs | Go local SQLite | Query caching and real-time display | Close |
| Agent memory, plug-in status | scoped IndexedDB/localForage | Editing and caching | Close |

External footage plugins (such as Eagle) are not native footage sources of truth. The local profile does not enumerate, read, or write these sources in the material selector; to use them, the Hosted profile must be run explicitly.

## Run rules

- Desktop startup uses the synthetic `local` workspace identity and does not read the login status. Identity rules in `workspace.Service`: Local workspace projection is `username=local`, Administrator, enabled; HTTP JSON is still output by `AuthUser`.
- Local upload calls the local Go resource interface first; only returns to IndexedDB when the resource service is temporarily unavailable, and `pendingRemoteUpload` is not set.
- `resource:<id>` only represents native Go resources, not SaaS or object storage.
- Users can select other disks and migrate the complete data directory in "Storage Settings", see [Storage Settings](storage-settings.md) for details.
- Reference material object storage is explicitly enabled by the user. This reference resource is only uploaded when the channel rejects local reference material and requires a public URL; this is not workspace cloud synchronization.
- The server profile still retains the original remote synchronization implementation, and is isolated from the desktop profile through `storageMode`.
- Subsequently added functions must first declare the data domain and their source of fact, and it is prohibited to add implicit cloud fallback in local mode.

## Local task events

In local mode, task status receives progress and final status through the existing `/api/tasks/:id/text-events` SSE interface by default; the interface has cursor and disconnection reconnection logic, and no additional WebSocket service is introduced. Server profiles can still use the original polling path.