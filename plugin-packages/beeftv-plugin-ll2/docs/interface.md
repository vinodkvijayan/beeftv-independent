# LL2 computing power and video channel interface description

## Plug-in identity

- Plug-in package name: `beeftv-plugin-ll2`
-Default Base URL: `https://api.ll2.cn`
- Authentication method: `Authorization: Bearer <apiKey>`

## Contributed video protocol Provider

| Provider ID | Applicable models | Create interface | Polling interface |
| --- | --- | --- | --- |
| `ll2-seedance-video` | `doubao-seedance-2-0-fast`, `doubao-seedance-2-0` | `POST /seedance/api/v3/contents/generations/tasks` | `GET /seedance/api/v3/contents/generations/tasks/{{taskId}}` |
| `ll2-vidu-video` | `viduq3-turbo`, `viduq3-pro` | `POST /vidu/ent/v2/{text2video\|img2video\|start-end2video}` | `GET /vidu/ent/v2/tasks/{{taskId}}/creations` |
| `ll2-minimax-video` | `MiniMax-H3` | `POST /v2/video_generation` | `GET /v2/query/video_generation/{{taskId}}` |
| `ll2-super-vega-video` | `Super Vega 1.0-pro-mini`, `Super Vega 1.0-lite` | `POST /super-vega/tasks` | `GET /super-vega/tasks/{{taskId}}` |
| `ll2-auto-hd-video` | `auto-hd` | `POST /hd/tasks` | `GET /hd/tasks/{{taskId}}` |