# NewAPI Media Task Protocol

This plug-in uniformly packages multi-modal reference materials into `input.media[]`, puts the resolution, scale, duration and watermark into `parameters`, and uses `/v1/videos` to create and query asynchronous tasks. It is a channel contract for host adaptation, not an official agreement with a certain model manufacturer.

## Interface and authentication

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/videos
GET  {channel_base_url}/v1/videos/{task_id}
Authorization: Bearer <CHANNEL_API_KEY>
Content-Type: application/json
```

## Model, billing and material upper limit

Model inventory, billing, duration range, number of assets, and single file size are all determined by the current NewAPI deployment and its upstream channels. This plugin cannot promote a channel's Seedance, Veo or Kling restrictions to all deployments. Administrators should record model IDs in the model configuration that are verified by actual calls.

## Parameter and field mapping

{{PARAMETERS}}

Actual mapping: `input.media[].type` takes the material `role`. By default, the picture is `reference_image`, the video is `reference_video`, and the audio is `reference_voice`. The host video task will add `reference_audio` to the audio, so the audio type in the production request is `reference_audio`. Default is `resolution=720P`, `ratio=16:9`, `duration=5`. The watermark field is only sent for `watermark=true`; it is not currently sent for `generateAudio`.

## Multimodal creation example

```bash
curl "{channel_base_url}/v1/videos" \
  -H "Authorization: Bearer <CHANNEL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_CHANNEL_MODEL",
    "input":{
      "prompt":"保持人物外观，动作参考视频，节奏参考声音",
      "media":[
        {"type":"reference_image","url":"https://example.com/character.png"},
        {"type":"reference_video","url":"https://example.com/action.mp4"},
        {"type":"reference_voice","url":"https://example.com/beat.mp3"}
      ]
    },
    "parameters":{"resolution":"720P","ratio":"16:9","duration":8,"watermark":false}
  }'
```

## Responding, polling and troubleshooting

The creation response must contain `id/task_id/taskId/request_id` at the top level, `task` or `data`. Query the URL-encoded task ID. Parse the video array or `video_url/videoUrl/result_url/url` on completion. If the channel returns its own deep fields, exclusive analysis must be added, and empty results cannot be marked as successful.

Common issues include channels not mapped to the model, asset URLs cannot be downloaded by upstream, media type naming is not accepted by this deployment, and default parameters are outside the scope of the model. Check the deployment version and channel logs before modifying the adapter; do not repeatedly add compatible aliases to cover up protocol differences.

## Official information and boundaries

- NewAPI project and deployment documents are provided by the specific operation and maintenance party; this page is based on the request facts of the host's current adapter.
- The official documentation of the upstream model is only used to confirm the model's own capabilities and cannot replace the NewAPI gateway field contract.

{{CONTRACT}}
