# OpenAI Videos Compatible Protocol

This plug-in implements the `/v1/videos` asynchronous video contract: create a task with multipart, obtain the task ID, and query the task resources under the same path. It is used for Sora/OpenAI Videos style channels; model, size, duration, price, and retention are determined by the actual channel.

## Interface and authentication

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/videos
GET  {channel_base_url}/v1/videos/{task_id}
Authorization: Bearer <API_KEY>
Content-Type: multipart/form-data
```

## Model and capability boundaries

The model name must be the video model actually opened by the deployment service. The plugin does not consider any `sora-*` or `sd-*` names to be available, nor does it provide a price list. The current implementation supports Vincent video and single set of reference image input, and does not send reference video, reference audio, independent audio switches or watermarks.

## Parameter and field mapping

{{PARAMETERS}}

`duration -> seconds`, sent as a decimal string; `aspectRatio -> size`, the upstream size should be filled in here instead of just writing `16:9`; `images -> input_reference` multipart part. Empty fields are not sent.

## Vincent Video Example

```bash
curl -X POST "{channel_base_url}/v1/videos" \
  -H "Authorization: Bearer <API_KEY>" \
  -F "model=YOUR_VIDEO_MODEL" \
  -F "prompt=清晨薄雾中的竹林，镜头缓慢向前推进" \
  -F "seconds=8" \
  -F "size=1280x720"
```

## Image reference example

```bash
curl -X POST "{channel_base_url}/v1/videos" \
  -H "Authorization: Bearer <API_KEY>" \
  -F "model=YOUR_VIDEO_MODEL" \
  -F "prompt=保持参考图人物一致，镜头从中景推进到特写" \
  -F "seconds=8" \
  -F "size=720x1280" \
  -F "input_reference=@character.png"
```

## Create, poll and download

```json
{"id":"task_xxx","status":"queued"}
```

```bash
curl "{channel_base_url}/v1/videos/task_xxx" -H "Authorization: Bearer <API_KEY>"
```

The completion response can provide `url`, `video_url`, `result_url`, or a video array at the top level or in a nested object. Failure messages are extracted from `message`, `error`, `fail_reason`. The current plug-in does not have a cancellation interface, nor will it automatically delete upstream tasks; the polling interval and download validity period must comply with the channel instructions.

## Official and compatible information

- [OpenAI Videos API reference](https://developers.openai.com/api/reference/resources/videos)
- If the channel is NewAPI or other compatible implementation, the version description of the deployment must also be checked; the same path does not mean that the fields and models are completely consistent.

{{CONTRACT}}
