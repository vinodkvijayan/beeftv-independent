# Jimeng official video asynchronous API

The Dream video plug-in uses `CVSync2AsyncSubmitTask` to create, `CVSync2AsyncGetResult` to query, and is signed by the channel's Volcano AK/SK implementation. Both creation and query are POST, and the model capability key is passed through `req_key`.

## Interface and signature

{{OPERATIONS}}

These two names are visual service Actions. The actual URL, Query, Region, Service, timestamp and signature header must be generated according to the official signature specification of Volcano. Putting AK/SK into JSON or the browser will leak the key.

## Model, version and material restrictions

`req_key` must be the dream video capability key for which the account has been activated. Each version has different constraints on the first frame/last frame, number of reference images, duration, scale and resolution; the plug-in does not maintain a model table that may expire. Currently only reference images are mapped, no reference video, audio, generated audio or watermarks are sent.

## Parameter and field mapping

{{PARAMETERS}}

Basic requests include `req_key`, `prompt`, and optionally `image_urls`. `extra` can transparently transmit and cover `req_key`, `prompt`, `image_urls`, `duration`, `ratio`, and `resolution`. It is suitable for administrators to fill in parameters according to the confirmed official version.

## Create task body

```json
{
  "req_key":"YOUR_JIMENG_VIDEO_REQ_KEY",
  "prompt":"保持参考人物，镜头从全景移动到近景",
  "image_urls":["https://example.com/subject.png"],
  "duration":5,
  "ratio":"16:9",
  "resolution":"720p"
}
```

Create response:

```json
{"data":{"task_id":"task_xxx"}}
```

Query text:

```json
{"req_key":"YOUR_JIMENG_VIDEO_REQ_KEY","task_id":"task_xxx"}
```

## Polling, results and failures

The poll response is read by a unified async parser that reads the status and video URL. The query must continue to carry the model `req_key` when it was created, and cannot only pass the task ID. Signing time deviation, Region error, unactivated capabilities, invalid material URL, parameter mismatch, and audit will all fail. There is currently no cancellation interface, and the quota processing after failure shall be subject to the official accounts.

## Official information

- [Volcano Engine Vision Intelligent Open Platform](https://www.volcengine.com/docs/85621)
- [Volcano Engine API Signature Method](https://www.volcengine.com/docs/6369/67269)

{{CONTRACT}}
