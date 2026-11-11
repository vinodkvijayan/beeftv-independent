# List of old video protocols

两份 JSON 逐字取自 BeefTV `v2.0.4`，提交 `542124baadcdbe5ce34ba9029ef7f1d192b49d16` 的 `plugin-packages/<协议 ID>/manifest.json`。保留原文（包括内嵌文档），不手写一个近似旧版。

The source is the research addendum of #78 (`961424b9`). `video_protocol_upgrade_test.go` will make it into a temporary package, install it through real SQLite and `NewLocal`, then change it to the current list and restart normally; the reference-free inventory constructor will not be called.

Corresponding regression also covers deletion ID retention and old package rollback. All credentials, tasks, databases, and HTTP upstreams are created for testing and do not contain user data.