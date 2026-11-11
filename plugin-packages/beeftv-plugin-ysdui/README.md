# Yinshengyunshu One Computing Power and Multi-modal Channel (`beeftv-plugin-ysdui`)

BeefTV official built-in plug-in provides OneAxis (`https://tokenhub.ysdui.cn`)**’s one-click BYOK channel configuration panel and 32 preset protocol configurations for text/multi-modal understanding, synchronous images, asynchronous images and unified video models:

- **Text and multi-modal understanding (17 models)**: `POST /v1/chat/completions` (DeepSeek V4/V4.1, Qwen 3.7/3.8, GLM-5.3, Kimi K2.6/K2.7 Code/K3, MiniMax M2.7/M3, Hunyuan 3.0 / Role / MT2 Pro, follow the official documentation to enable reasoning and image/video understanding capabilities)
- **`ysdui-image` (4 simultaneous images)**: `POST /v1/images/generations` (`doubao-seedream-5-0-260128`, `doubao-seedream-5-0-pro-260628`, `qwen-image-3.0-pro`, `hy-image-v3.0`, the size, composition, transparent background, layer splitting and channel-specific parameters are strictly distinguished according to the official interface specifications of each model)
- **`ysdui-image-task` (3 asynchronous images)**: `POST /v1/images/tasks` + `GET /v1/images/tasks/{{taskId}}` (`wand-vega-image-pro`, `wand-vega-image-1.5-pro`, `wand-vega-image-flash`)
- **`ysdui-video` (8 unified asynchronous videos)**: `POST /v1/video/generations` + `GET /v1/video/generations/{{taskId}}` (`doubao-seedance-2-0-260128`, `doubao-seedance-2-0-fast-260128`, `doubao-seedance-2-0-mini-260615`, `doubao-seedance-2-5-260628`, `wan3.0-video`, `wan3.0-video-prime`, `minimax-h3`, `wand-vega-video-1.0-lite`)
- **Built-in reference material upload**: Before initiating a generation request, all local materials of Tusheng pictures, Tusheng videos, and multi-modal reference videos/audios are automatically converted to the Yunshu One Computing public network link through the Yunshu One Computing file upload interface (`POST https://ysdui.cn/api/file/v1/upload`, `multipart/form-data` `file`, single file limit 20MB) and then the generation interface is called. No additional external OSS configuration is required.

## Usage

1. 打开 BeefTV「插件中心」，找到已预装启用的 **银盛云枢壹算算力与多模态渠道**，点击 **「设置」**（或直接在「设置 -> 模型服务 -> 连接你的模型服务」中选择 **银盛云枢壹算**）。
2. 填写银盛云枢壹算 API Key（`sk-...`），可点击 **「验证在线目录」** 校验连通性。
3. 点击 **「一键保存并同步到模型服务」**，即可将 `银盛云枢壹算` 渠道与全部预置模型自动写入「设置 -> 模型服务」，已保存的旧版 `ysdui-*` 模型能力也会在加载时自动按最新官方规格升级。
