# Volcano Ark image generation

This plug-in generates a JSON interface for Ark images. The prompt words are sent directly, the reference image array is mapped to `image`, and the continuous generation and watermark parameters can be transparently transmitted from the model extension field.

## Interfaces, Authentication and Zones

{{OPERATIONS}}

```http
POST {channel_base_url}/api/v3/images/generations
Authorization: Bearer <ARK_API_KEY>
Content-Type: application/json
```

Base URL, authentication method and available models are affected by the Volcano Ark console, region and access method. If AK/SK signature gateway is used, the signature should be completed by the channel layer, and the Secret Key cannot be written into the plug-in document or browser.

## Model and support boundaries

Model ID, size range and capabilities are based on the Volcano Ark console.

## Parameter and field mapping

{{PARAMETERS}}

Current implementation: `aspectRatio -> size`, all `images -> image[]`; `extra` can transparently transmit `size`, `sequential_image_generation`, `sequential_image_generation_options`, `watermark`. `imageCount`, `quality` and `resolution` have no universal mapping and must be adapted separately according to the model interface.

## Vincent diagram example

```bash
curl "{channel_base_url}/api/v3/images/generations" \
  -H "Authorization: Bearer <ARK_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_ARK_ENDPOINT_OR_MODEL",
    "prompt":"古城屋顶追逐，低机位，动态构图",
    "size":"2048x1152",
    "watermark":false
  }'
```

## Reference picture example

```json
{
  "model":"YOUR_ARK_ENDPOINT_OR_MODEL",
  "prompt":"保持人物服装和发型，生成侧面中景",
  "image":["https://example.com/character.png"],
  "size":"2048x1152"
}
```

## Response parsing and restrictions

The response is parsed as a `data[]` image array, and the elements must contain `url`, `b64_json` or `data`. The current plug-in does not do exclusive unpacking for Ark-specific error codes, task modes, or content filtering results; channels will explicitly fail when returning incompatible structures. Model size, number of reference drawings, upper limit of sequence diagrams, watermarks and billing are based on the current model description in the console and cannot be inferred from the plug-in default values.

## Official information

- [Volcano Ark Visual Model API Document](https://www.volcengine.com/docs/82379)
- [Volcano Ark API Access and Authentication Document](https://www.volcengine.com/docs/82379/1263279)

{{CONTRACT}}
