#VolcanoArk Agent Plan video mission

This plug-in uses Agent Plan’s exclusive Contents Generations Tasks asynchronous interface. Prompt word, reference picture, reference video and reference audio constitute `content[]`; scale, resolution, duration, generated audio and watermark are located in the top-level task parameters. The request body is consistent with the official Ark Seedance, and the entry is changed to `/api/plan/v3`.

## Interface and authentication

{{OPERATIONS}}

```http
POST {channel_base_url}/api/plan/v3/contents/generations/tasks
GET  {channel_base_url}/api/plan/v3/contents/generations/tasks/{task_id}
DELETE {channel_base_url}/api/plan/v3/contents/generations/tasks/{task_id}
Authorization: Bearer <AGENT_PLAN_API_KEY>
Content-Type: application/json
```

Differences from the official `/api/v3`:

| Item | Official Ark | Agent Plan |
| --- | --- | --- |
| Base URL | `https://ark.cn-beijing.volces.com/api/v3` | `https://ark.cn-beijing.volces.com/api/plan/v3` |
| API Key | Inference Access Console Key | Agent Plan Exclusive Key |
| Billing | Post-inference payment/project quota | AFP package deduction |
| Request body | contents/generations/tasks | Same as left |

## Parameter and field mapping

{{PARAMETERS}}

The material mapping for full-modal reference is as follows:

- Picture: `{"type":"image_url","image_url":{"url":"..."},"role":"reference_image"}`
- Video: `{"type":"video_url","video_url":{"url":"..."},"role":"reference_video"}`
- Audio: `{"type":"audio_url","audio_url":{"url":"..."},"role":"reference_audio"}`

You can send up to 9 pictures, 3 videos and 3 audios at a time. Reference material can be combined, but audio-only or "text + audio" is not supported upstream.

## Official information

- [Volcano Ark Agent Plan Document](https://www.volcengine.com/docs/82379/2375486)
- [Volcano Ark Content Generation Task Document](https://www.volcengine.com/docs/82379/1520757)

{{CONTRACT}}
