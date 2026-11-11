# MiniMax video generation

The MiniMax video plug-in uses `/v2/video_generation` to create asynchronous tasks. It sends both the top-level `prompt` and the structured `content[]`: the text is a text item and the reference image is an image URL item with the `reference_image` role.

## Interface and authentication

{{OPERATIONS}}

```http
POST {channel_base_url}/v2/video_generation
GET  {channel_base_url}/v2/query/video_generation/{task_id}
Authorization: Bearer <MINIMAX_API_KEY>
Content-Type: application/json
```

## Models and Constraints

The current MiniMax V2 official documentation lists `MiniMax-H3`, duration as an integer of 4–15 seconds, resolution as `768P` or `2K`, and scale support for `adaptive`, `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`. The current adapter defaults to 6 seconds; the model name and other restrictions are still subject to the actual opening capabilities of the account.

## Parameter and field mapping

{{PARAMETERS}}

Each image is constructed as a `image_url` item in `content`. `extra` can cover `model`, `prompt`, `duration`, `content`, `resolution`, `aspect_ratio`. Reference video, reference audio, audio generation, and watermarks are not currently sent.

## Create task example

```bash
curl "{channel_base_url}/v2/video_generation" \
  -H "Authorization: Bearer <MINIMAX_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_MINIMAX_VIDEO_MODEL",
    "prompt":"保持角色一致，人物转身看向镜头",
    "duration":6,
    "content":[
      {"type":"text","text":"保持角色一致，人物转身看向镜头"},
      {"type":"image_url","image_url":{"url":"https://example.com/character.png"},"role":"reference_image"}
    ],
    "resolution":"720P",
    "aspect_ratio":"16:9"
  }'
```

##Queries, files and results

```bash
curl "{channel_base_url}/v2/query/video_generation/task_xxx" \
  -H "Authorization: Bearer <MINIMAX_API_KEY>"
```

The current V2 official successful response returns the video address at `task.content.url`. The general parser will first merge `task` and then extract the result from `content.url`. The official only allows querying the tasks of the last 7 days. The video URL is time-limited and should be transferred immediately. The current adapter does not yet send reference video, reference audio, `callback_url`, or `aigc_watermark`; although V2 upstream supports these fields, the host cannot claim support.

## Official information

- [MiniMax Create Video Generation Task](https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create)
- [MiniMax Query Task](https://platform.minimaxi.com/docs/api-reference/video-generation-v2-query)

{{CONTRACT}}
