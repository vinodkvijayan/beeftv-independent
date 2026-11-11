# NewAPI Video Generations

The plug-in uses the `/v1/video/generations` JSON asynchronous interface to directly send image, video and audio URL arrays. It applies to NewAPI channels that implement this specific set of paths and fields and is not equivalent to the `/v1/videos` media task protocol.

## Interface and authentication

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/video/generations
GET  {channel_base_url}/v1/video/generations/{task_id}
Authorization: Bearer <CHANNEL_API_KEY>
Content-Type: application/json
```

## Model and constraint sources

Available models, per-material caps, duration ranges, audio capabilities, resolutions, and billing are determined upstream of this NewAPI deployment map. There is no universal whitelist for plugins. The Seedance restriction in the user example can only be used for channels that actually connect to the service and are verified consistently by the administrator.

## Parameter and field mapping

{{PARAMETERS}}

Actual fields are `model`, `prompt`, `seconds`, `aspect_ratio`, optional `resolution`, `generate_audio`, `image_urls`, `video_urls`, `audio_urls`. The duration defaults to 6 seconds and is sent as a string, and the ratio defaults to `16:9`. Watermarks are not currently being sent.

## Complete multimodal request

```bash
curl "{channel_base_url}/v1/video/generations" \
  -H "Authorization: Bearer <CHANNEL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_VIDEO_MODEL",
    "prompt":"人物参考第一张图，镜头运动参考视频，节奏跟随音频",
    "seconds":"10",
    "aspect_ratio":"9:16",
    "resolution":"720p",
    "generate_audio":true,
    "image_urls":["https://example.com/subject.png"],
    "video_urls":["https://example.com/motion.mp4"],
    "audio_urls":["https://example.com/beat.mp3"]
  }'
```

## Task status and results

```json
{"task_id":"task_xxx","status":"queued"}
```

```bash
curl "{channel_base_url}/v1/video/generations/task_xxx" \
  -H "Authorization: Bearer <CHANNEL_API_KEY>"
```

The status will be classified as waiting, processing, successful or failed. Successful results can come from an array of videos or a common top-level URL; there is currently no cancellation path. The refund, credit release, and result retention period after a task fails belong to the deployer's accounting contract, and the host will not commit without interface evidence.

## Official information and boundaries

- Subject to the connected NewAPI deployment interface document, version and channel configuration.
- The material must be accessible by the gateway and the final upstream; accessibility by the gateway does not mean that it is accessible by the final supplier.

{{CONTRACT}}
