# Jimeng official picture asynchronous API

This plug-in uses the Jimeng Vision asynchronous task mode: submit the task to obtain `task_id`, and then query the result with the same `req_key`. The interface is protected by the AK/SK signature system of the Volcano Engine Vision Service and is not a Bearer compatible interface.

## Interface and signature

{{OPERATIONS}}

The logical operations are named `CVSync2AsyncSubmitTask` and `CVSync2AsyncGetResult`. The actual host, Query parameters, Service/Region and signature headers are the responsibility of the channel's Volcano signature implementation; you cannot just perform a normal HTTP POST on these two strings.

## Model and req_key

The host model ID is mapped to `req_key`, which must be completely consistent with the activated dream ability. The plug-in does not provide a whitelist of `req_key` that may be out of date, nor does it infer font, graph, or version capabilities from the name.

## Parameter and field mapping

{{PARAMETERS}}

Currently, `req_key` and `prompt` are sent, and `image_urls` is sent when there is a reference picture. `extra` can cover `req_key`, `prompt`, `image_urls`, `seed`, `width`, `height`. There is no automatic conversion for platforms `aspectRatio`, `quality`, `resolution` and `imageCount`.

## Create request body

```json
{
  "req_key":"YOUR_JIMENG_REQ_KEY",
  "prompt":"悬疑短剧分镜，楼道尽头的逆光人影",
  "image_urls":["https://example.com/reference.png"],
  "width":1536,
  "height":1024,
  "seed":42
}
```

Creating a response requires at least a recognizable task ID:

```json
{"data":{"task_id":"task_xxx"}}
```

## Polling requests and results

```json
{"req_key":"YOUR_JIMENG_REQ_KEY","task_id":"task_xxx"}
```

The poll response reads status from the top level, `task` or `data`, and extracts by image type `images`, `image_url`, `imageUrl`, `result_url` or `url`; the image array can contain URL strings or objects. If the result only appears in other exclusive nested fields of Jimeng, fixture and exclusive analysis need to be supplemented, and "get completed" cannot be regarded as a saved image.

## Errors and troubleshooting

Signature time deviation, Region/Service error, `req_key` not activated, material cannot be downloaded, width and height not supported, and content review will all cause failure. Logs may record request IDs and error codes, but may not record Secret Keys, full signatures, or private material data URLs.

## Official information

- [Volcano Engine Vision Intelligent Open Platform](https://www.volcengine.com/docs/85621)
- [Volcano Engine Signature Method](https://www.volcengine.com/docs/6369/67269)

{{CONTRACT}}
