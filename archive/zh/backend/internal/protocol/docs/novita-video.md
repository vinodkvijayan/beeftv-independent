# Novita Video Asynchronous API

The Novita video plug-in uses `/v3/video/create` to create a task, and uses the query parameter to carry the task ID to query the unified asynchronous results. The model field is named `model_name`, not the generic `model`.

## Interface and authentication

{{OPERATIONS}}

```http
POST {channel_base_url}/v3/video/create
GET  {channel_base_url}/v3/async/task-result?task_id={id}
Authorization: Bearer <NOVITA_API_KEY>
Content-Type: application/json
```

## Models and Constraints

Novita aggregates multiple video models, and the fields, picture requirements, duration, ratio and price of different `model_name` may be different. Currently the plugin only provides a common subset: prompt words, single reference image, duration and scale; it cannot be assumed that all Novita video models accept the same parameters.

## Parameter and field mapping

{{PARAMETERS}}

`model -> model_name`, `images[0] -> image_url`, the default duration is 5 seconds, and the default ratio is `16:9`. `resolution`, reference video, reference audio, audio generation and watermark are not currently sent.

## Create request example

```bash
curl "{channel_base_url}/v3/video/create" \
  -H "Authorization: Bearer <NOVITA_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model_name":"YOUR_NOVITA_VIDEO_MODEL",
    "prompt":"产品在黑色展台上缓慢旋转，轮廓光",
    "duration":5,
    "aspect_ratio":"16:9",
    "image_url":"https://example.com/product.png"
  }'
```

## Query and download

The create response should return `task_id/id`. When querying, the task ID will be URL query encoded:

```bash
curl "{channel_base_url}/v3/async/task-result?task_id=task_xxx" \
  -H "Authorization: Bearer <NOVITA_API_KEY>"
```

Success results are read from the video array or URL field by the unity parser. If Novita returns a unique nested structure for a model, it should build a fixture for that model instead of continuing to expand the global fuzzy fields. There is currently no cancellation interface; task refunds and result retention periods are subject to Novita's current rules.

## Official information

- [Novita Unified Video Generation](https://novita.ai/docs/api-reference/reference-unified-video-generation)
- [Novita Task Result Query](https://novita.ai/docs/api-reference/model-apis-task-result)

{{CONTRACT}}
