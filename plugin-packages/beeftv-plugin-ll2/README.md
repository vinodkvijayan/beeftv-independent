# LL2 computing power and video channel (`beeftv-plugin-ll2`)

BeefTV official built-in plug-in provides **LL2 (DMC) (`https://api.ll2.cn`)** one-click BYOK channel configuration panel and 5 sets of asynchronous video generation/super-resolution protocols:

- `ll2-seedance-video`: Seedance 2.0/2.0 Fast (`/seedance/api/v3/contents/generations/tasks`)
- `ll2-vidu-video`: Vidu Q3 Pro/Turbo (`/vidu/ent/v2/text2video`, `img2video`, `start-end2video` + `/vidu/ent/v2/tasks/{taskId}/creations`)
- `ll2-minimax-video`: MiniMax H3 (`/v2/video_generation` + `/v2/query/video_generation/{taskId}`)
- `ll2-super-vega-video`: Super Vega 1.0 Pro Mini/1.0 Lite (`/super-vega/tasks` + `/super-vega/tasks/{taskId}`)
- `ll2-auto-hd-video`: Auto HD asynchronous video super resolution (`/hd/tasks` + `/hd/tasks/{taskId}`)

## Usage

1. Open the BeefTV "Plug-in Center", find the pre-installed and enabled **LL2 computing power and video channel**, and click **"Settings"**.
2. Fill in the LL2 API Key (`sk-...`) and click **"Verify Online Directory"** to verify connectivity.
3. Click **"One-click save and synchronize to model service"** to automatically write the `LL2 (DMC)` channel and all preset models into "Settings -> Model Service" without changing BeefTV's original default protocols and presets.