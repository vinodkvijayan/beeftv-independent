# Volcano Ark Video Mission

This plugin uses the Ark Contents Generations Tasks asynchronous interface. Prompt word, reference picture, reference video and reference audio constitute `content[]`; scale, resolution, duration, generated audio and watermark are located in the top-level task parameters.

## Interface and authentication

{{OPERATIONS}}

```http
POST {channel_base_url}/api/v3/contents/generations/tasks
GET  {channel_base_url}/api/v3/contents/generations/tasks/{task_id}
Authorization: Bearer <ARK_API_KEY>
Content-Type: application/json
```

## Models and Constraints

Models typically correspond to console-available models or endpoint IDs. The allowed duration, resolution, frame, number of reference images, whether audio can be generated, and billing are determined by the specific model. The plug-in defaults to 5 seconds, `16:9`, and `720p`. The default value is not an upstream capability commitment.

## Parameter and field mapping

{{PARAMETERS}}

The material mapping for full-modal reference is as follows:

- Picture: `{"type":"image_url","image_url":{"url":"..."},"role":"reference_image"}`
- Video: `{"type":"video_url","video_url":{"url":"..."},"role":"reference_video"}`
- Audio: `{"type":"audio_url","audio_url":{"url":"..."},"role":"reference_audio"}`

You can send up to 9 pictures, 3 videos and 3 audios at a time. Reference materials can be used in combination, but upstream does not support pure audio or "text + audio"; when using audio, at least one reference image or one reference video must be provided at the same time. `generate_audio` and `watermark` are only sent when true.

## Create task example

```bash
curl "{channel_base_url}/api/v3/contents/generations/tasks" \
  -H "Authorization: Bearer <ARK_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_ARK_VIDEO_MODEL",
    "content":[
      {"type":"text","text":"沿用图片 1 的主体、视频 1 的运镜和音频 1 的音乐风格"},
      {"type":"image_url","image_url":{"url":"https://example.com/subject.png"},"role":"reference_image"},
      {"type":"video_url","video_url":{"url":"https://example.com/motion.mp4"},"role":"reference_video"},
      {"type":"audio_url","audio_url":{"url":"https://example.com/music.mp3"},"role":"reference_audio"}
    ],
    "ratio":"16:9",
    "resolution":"720p",
    "duration":5,
    "generate_audio":true,
    "watermark":false
  }'
```

## Query, status and results

The create response task ID is extracted by the unified parser from the top level, `task` or `data`. Read the video array or common URL field after the query is successful. If Ark places the results in other nested paths, it must use real fixtures to add exclusive analysis, and it is not allowed to return empty success based only on `completed`.

Task failure may result from unavailable endpoints, failed material downloads, unsupported parameter combinations, content review, concurrency or quota restrictions. The upstream request ID should be retained for troubleshooting, and the API Key and material text should not be entered into the log.

## Official information

- [Volcano Ark Video Generation API](https://www.volcengine.com/docs/82379)
- [Volcano Ark Content Generation Task Document](https://www.volcengine.com/docs/82379/1520757)
- [Doubao Seedance 2.0 full-modal reference tutorial](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2291680?lang=zh#50e1b4ea)

{{CONTRACT}}
