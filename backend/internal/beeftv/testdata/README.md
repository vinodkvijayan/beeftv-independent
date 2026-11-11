`managed-video-catalog.json` is the real TokenAuth + `/v1/models` handler's serialized response in the isolation database of BeefTV official computing power 2026-10-29. Includes unfamiliar ID, Kling, H3, Wan video directories, does not contain real credentials or paid calls.

`managed-video-catalog-live.json` is a snapshot of the video field of `/v1/models` released by the enterprise website on the same day, retaining the entire Seedance series and the catalog that was missing at that time. The test only treats rows for which a valid version exists as server declarations and does not guess at missing rows.

The two pieces of data are simultaneously consumed by the Go directory persistence test and the front-end directory, configuration recovery, and control read test.

The candidate snapshot includes BeefTV official computing power PR #683 operationReferences for per-operation reference counts. Defaults are form initial values; supported controls are explicitly serialized by the client.