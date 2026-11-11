# Yinshengyunshu computing power and multi-modal channel interface description

## Plug-in identity

- Plug-in package name: `beeftv-plugin-ysdui`
-Default Base URL: `https://tokenhub.ysdui.cn`
- Authentication method: `Authorization: Bearer <apiKey>`
- Official interface document: `https://www.ysdui.cn/docs`

## Contributed multi-modal protocol Provider

| Provider ID | 能力 | 适用模型 | 创建接口 | 轮询接口 |
| --- | --- | --- | --- | --- |
| `ysdui-image` | `image` | `doubao-seedream-5-0-260128`、`doubao-seedream-5-0-pro-260628`、`qwen-image-3.0-pro`、`hy-image-v3.0` | `POST /v1/images/generations` | 同步返回 |
| `ysdui-image-task` | `image` | `wand-vega-image-pro`、`wand-vega-image-1.5-pro`、`wand-vega-image-flash` | `POST /v1/images/tasks` | `GET /v1/images/tasks/{{taskId}}` |
| `ysdui-video` | `video` | `doubao-seedance-2-0-260128`、`doubao-seedance-2-0-fast-260128`、`doubao-seedance-2-0-mini-260615`、`doubao-seedance-2-5-260628`、`wan3.0-video`、`wan3.0-video-prime`、`minimax-h3`、`wand-vega-video-1.0-lite` | `POST /v1/video/generations` | `GET /v1/video/generations/{{taskId}}` |

## Parameter mapping strictly differentiated by model (see official documentation)

### 1. Synchronized image (`POST /v1/images/generations`)

- **`doubao-seedream-5-0-260128` (Seedream 5.0 Lite)**: Supports Vincent pictures, multi-reference pictures (up to 14 pictures), group picture generation (only send `sequential_image_generation="auto"` and `sequential_image_generation_options.max_images` when `output.options.maxImages > 1`), `output_format` (`jpeg`/`png`), `watermark`; supported `2K`/`3K`/`4K` gear and custom pixel size.
- **`doubao-seedream-5-0-pro-260628` (Seedream 5.0 Pro)**: Supports textual pictures, multiple reference pictures (up to 10 pictures), transparent background (`background="transparent"` + `output_format="png"`), layer splitting (`layer_decomposition=true`, size transfer to `2K` or `auto`), `output_format`, `watermark`; supported `1K`/`1.5K`/`2K` gear and custom pixel size; **Do not send `sequential_image_generation` or `sequential_image_generation_options`**.
- **`qwen-image-3.0-pro`**: Supports Vincent pictures, reference pictures (up to 3 pictures), `n` (1–6), `negative_prompt`, `prompt_extend`, `watermark`, and does not send beanbag exclusive parameters.
- **`hy-image-v3.0` (Hunyuan Image 3.0)**: Supports Vincentian pictures and reference pictures (up to 3 pictures), and the size is strictly mapped to the officially supported 8 Group pixel specifications (`1024x1024`, `1280x720`, `720x1280`, `1024x768`, `768x1024`, `1152x768`, `768x1152`, `1344x576`), do not send `n`, Doubao exclusive parameters or Qianwen exclusive parameters.

### 2. Asynchronous image task (`POST /v1/images/tasks`)

- **`wand-vega-image-pro` / `wand-vega-image-1.5-pro` / `wand-vega-image-flash`**: Supports Vincent pictures and reference pictures (up to 14 pictures for `images`), maps official pixel specifications according to `1k`/`2k`/`4k` gears and ratios or transparently transmits explicit `WxH`, and polls through `GET /v1/images/tasks/{{taskId}}` until completed.

### 3. Unified asynchronous video (`POST /v1/video/generations`)

- **`doubao-seedance-2-0-260128`**: Resolution `480P` / `720P` / `1080P` / `4K`, duration `4–15` seconds or `-1` (auto duration), supports `reference_mode`, `generate_audio`, `watermark`, `output_format`, `return_last_frame`.
- **`doubao-seedance-2-0-fast-260128` / `doubao-seedance-2-0-mini-260615`**: Resolution is strictly limited to `480P` / `720P` (excluding `1080P` / `4K`), duration `4–15` seconds or `-1`.
- **`doubao-seedance-2-5-260628`**: Resolution `480P` / `720P` / `1080P`, supports pure audio video (`audio_to_video`) and full-modal reference.
- **`wan3.0-video` / `wan3.0-video-prime`**: resolution `480P` / `720P` / `1080P`, duration `2–30` seconds or `-1`, full-modal reference supports up to 10 pictures / 5 videos / 5 audios, supported `generate_audio`, `watermark`, and `prompt_extend` do not send beanbag exclusive parameters.
- **`minimax-h3`**: Resolution `768P` / `2K`, duration `4–15` seconds, no `generate_audio`, `watermark`, Doubao exclusive parameters or Qianwen exclusive parameters will be sent.
- **`wand-vega-video-1.0-lite`**: resolution `768P` / `1080P`, ratio `16:9` / `9:16` / `4:3` / `3:4` / `1:1` / `21:9`, duration `4–15` seconds, up to 7 reference pictures, up to 1 reference video, not sent `generate_audio`, `watermark`, Doubao exclusive parameters or Qianwen exclusive parameters.

## Reference material pre-upload (`mediaUpload`)

- Upload interface: `POST https://ysdui.cn/api/file/v1/upload` (custom gateway or test service fallback `POST <baseUrl>/api/file/v1/upload`)
- Request format: `multipart/form-data`, field name `file`, maximum single file size 20MB (`20971520` bytes)
- Response analysis: When `code=200` is used, the `data` public network link is taken, and the local `resource:*` / `data:*` reference image, first and last frame, and reference audio and video are automatically replaced and the generation request is submitted.