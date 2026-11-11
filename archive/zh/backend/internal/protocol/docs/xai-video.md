#xAI video generation

The xAI video plug-in creates an asynchronous generation request and then queries it based on the request ID. A single reference picture is sent as `image`, and multiple reference pictures are sent as `reference_images`; the duration, frame, and resolution use xAI style fields.

## Interface and authentication

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/videos/generations
GET  {channel_base_url}/v1/videos/{request_id}
Authorization: Bearer <XAI_API_KEY>
Content-Type: application/json
```

## Models and current support

The model ID, allowed duration, scale, resolution, number of reference images, review rules and billing are subject to the xAI console and official documents. The current adapter defaults to 6 seconds, `16:9`, and `720p`. Video references, audio references, audio generation switches, and watermarks are not sent.

## Parameter and field mapping

{{PARAMETERS}}

Single-picture structure: `"image":{"url":"..."}`; multi-picture structure: `"reference_images":[{"url":"..."}]`. Whether the URL or data URL is accepted by the specific model should be verified before calling.

## Request example

```bash
curl "{channel_base_url}/v1/videos/generations" \
  -H "Authorization: Bearer <XAI_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_XAI_VIDEO_MODEL",
    "prompt":"雨夜都市追逐，手持摄影，真实运动模糊",
    "duration":8,
    "aspect_ratio":"16:9",
    "resolution":"720p",
    "image":{"url":"https://example.com/character.png"}
  }'
```

## Create, query and download

Create a response that contains the `request_id` or other task field supported by the unified parser. After the query is completed, the media is read from the video array or `video_url/result_url/url`. There is currently no cancel adapter; closing the host popup will not cancel the upstream build. The resulting URL should be transferred promptly and cannot be assumed to be permanently valid.

## Error handling

Model permissions, invalid dimensions, inaccessible reference material, content moderation, rate or balance limits must be displayed as true failures. If the official response structure is inconsistent with the general parser, xAI-specific parser and fixture tests should be supplemented instead of continuing to stack fuzzy field guesses.

## Official information

- [xAI Video Generation guide](https://docs.x.ai/docs/guides/video-generation)
- [xAI API Reference](https://docs.x.ai/docs/api-reference)

{{CONTRACT}}
