#AgnesAIVideoProtocol

Agnes AI official video interface uses Bearer API Key and asynchronous task model. The host implementation covers `agnes-video-v2.0`, `agnes-video-2.5`, and `agnes-video-2.5-flash`. After creating the task, save `video_id` in the response, and then query the task status. The base URL of the official international site is `https://apihub.agnes-ai.com/v1`; the key is only configured in the back-end channel and does not enter the browser URL, logs or task text.

## Interface and authentication

{{OPERATIONS}}

Create request sent to `/v1/videos`. The polling interface is special: it is under the root path `/agnesapi` of the same host, not the Base URL `/v1`. The host splices requests through the "same root path" contract, so when configuring `https://apihub.agnes-ai.com/v1` you get `https://apihub.agnes-ai.com/agnesapi?...`, not misspelled as `/v1/agnesapi`, and the host is not hard-coded into the protocol adapter.

The request headers use `Authorization: Bearer <API_KEY>` and `Content-Type: application/json`. The creation response preferentially reads `video_id`, and is compatible with reads `task_id` and `id`; polling always carries `video_id`, and `model_name` when the model name is available.

## Models and Patterns

- `agnes-video-2.5`: Supports `text`, `keyframe`, `reference`. The duration is the string `"4"` to `"12"`, the default is 5 seconds; the resolution supports `720P`, `960P`, and `2K`.
- `agnes-video-2.5-flash`: The mode is the same as 2.5, but `720P` is fixed, the reference picture can be up to 5, and the reference video is not supported.
- `agnes-video-v2.0`: supports Vincent video, single-image video and multiple key frames; the duration is controlled by `num_frames / frame_rate`, `num_frames` must comply with `8n + 1` and not exceed 441.

When the 2.5 series does not explicitly transmit `mode`, `text` is used for plain text; `reference` is used when there is audio or video; `keyframe` is used when there are only one or two pictures. If the business needs to use pictures as style or subject reference, `mode: "reference"` should be clearly passed in the extended parameters. When the combination of mode and media is illegal, the host directly rejects the request before sending the upstream request.

## Parameter mapping

{{PARAMETERS}}

### Agnes Video 2.5 / 2.5 Flash

Common request fields include `model`, `prompt`, `mode`, `seconds`, `size`, `aspect_ratio`, `seed`, `n`. Host fixed `n: 1`. The host field `images` maps the first two pictures to `first_frame` and `last_frame` in sequence in `keyframe` mode; in `reference` mode it maps to the official picture array. Host fields `videos` and `audios` are respectively mapped to official arrays with the same name. The reference video currently sends `{ "url": "..." }`, not infer `start_seconds` or `require_audio`.

### Agnes Video V2.0

A single `images` input is mapped to `image`; multiple pictures are mapped to `extra_body.image` and set to `extra_body.mode: "keyframes"`. The host field `duration` will be scaled to the nearest `8n + 1` frame by `frame_rate` (default 24) and limited to 441 frames. Advanced fields `width`, `height`, `num_frames`, `frame_rate`, `num_inference_steps`, `seed`, `negative_prompt` can be passed in by model protocol extension parameters. V2.0 does not use `aspectRatio` or `resolution` to directly guess the size.

## Response, status and errors

`video_id` in the creation success response is the recommended polling ID. The status mapping is: `queued` -> waiting, `in_progress` -> processing, `completed` -> successful, `failed` -> failed. The successful result reads `metadata.url` in the 2.5 official structure first, and is compatible with the top-level `url` returned by V2.0; if the response claims completion but does not have a video URL, the host will return a true protocol error and will not generate a fake URL. The failure information reads `error.message` first, followed by the top-level `message` or `detail`.

The reference media must be a URL that is publicly accessible to the Agnes service and remains valid until the task is completed. The adapter declares the public media URL requirement, and the host runtime will prepare the upstream accessible address according to the existing resource process; local, private network, cookie protected, or links that will expire soon cannot be entered as Agnes.

## Official information

- Official website: <https://agnes-ai.com/>
- Document homepage: <https://wiki.agnes-ai.com/en/docs/overview>
- Agnes Video 2.5: <https://wiki.agnes-ai.com/en/docs/agnes-video-25>
- Agnes Video 2.5 Flash：<https://wiki.agnes-ai.com/en/docs/agnes-video-25-flash>
- Agnes Video V2.0: <https://wiki.agnes-ai.com/en/docs/agnes-video-v20>

The official creation interface currently provided is `POST https://apihub.agnes-ai.com/v1/videos`, and the recommended query interface is `GET https://apihub.agnes-ai.com/agnesapi?video_id=<VIDEO_ID>&model_name=<MODEL>`. Prices and promotions change and are not fixed in the protocol adapter.

{{CONTRACT}}
