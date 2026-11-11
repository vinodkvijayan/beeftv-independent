# xAI Grok Images

The Grok Images plugin uses OpenAI-style image generation paths, but the request fields are constructed according to the xAI image protocol: `aspect_ratio`, `resolution`, and a single `image` is sent when a reference image is available. It is not an alias for the OpenAI Images plugin.

## Interface and authentication

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/images/generations
Authorization: Bearer <XAI_API_KEY>
Content-Type: application/json
```

## Model and support boundaries

The model name is determined by the models currently available in the xAI account. Plugins do not hard-code model, pricing, concurrency or content limits. The current implementation only sends the first reference picture; multiple reference pictures, special editing paths, masks and batch generation are not implemented and cannot be shown as supported just because the upstream may support them.

## Parameter and field mapping

{{PARAMETERS}}

The actual structure is: `aspectRatio -> aspect_ratio`, when it is empty, it defaults to `1:1`; `quality -> resolution`, when it is empty, it defaults to `2k`; `images[0] -> image`. `imageCount`, `resolution` platform fields and other images will not be sent.

## Vincent picture request

```bash
curl "{channel_base_url}/v1/images/generations" \
  -H "Authorization: Bearer <XAI_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_GROK_IMAGE_MODEL",
    "prompt":"太空港的清晨，宽银幕概念设计",
    "aspect_ratio":"16:9",
    "resolution":"2k"
  }'
```

## Single image reference request

```json
{
  "model":"YOUR_GROK_IMAGE_MODEL",
  "prompt":"保持主体轮廓，改成铅笔分镜风格",
  "aspect_ratio":"16:9",
  "resolution":"2k",
  "image":"https://example.com/reference.png"
}
```

## Responses and Errors

The plugin parses `url`, `b64_json` or `data` from `data[]` in the OpenAI Images style. If xAI's actual response structure changes or only returns an asynchronous task, the current parsing will fail instead of falsifying the result. Materials that are not reachable, scales/resolutions not supported by the model, models without permissions, and review rejections should be exposed as is.

## Official information

- [xAI Image Generation](https://docs.x.ai/docs/guides/image-generation)
- [xAI API Reference](https://docs.x.ai/docs/api-reference)

{{CONTRACT}}
