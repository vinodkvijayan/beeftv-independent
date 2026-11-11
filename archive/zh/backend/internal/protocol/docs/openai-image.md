# OpenAI Images

The OpenAI Images plugin implements JSON image requests and parses OpenAI Images style `data[]` responses. The upstream official also provides a multipart image editing interface, but the current creation path of the host adapter only constructs `/v1/images/generations`; the editing interface is listed in the details to illustrate the protocol capabilities, and does not mean that the current canvas has sent an editing request.

## Interface and authentication

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/images/generations
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

The official editing interfaces are `POST /v1/images/edits` and `multipart/form-data`. The current adapter does not switch to this path when a reference map is available, which is a clear implementation gap.

## Model, size and quality

Models, allowed sizes, quality enumerations, number of shots per shot, and billing will change with the upstream service, and the plugin does not maintain a whitelist that may expire. If the channel is an OpenAI compatible implementation, it must separately verify that it supports `n`, `quality`, `background`, `output_format`, and Base64 responses.

## Parameter and field mapping

{{PARAMETERS}}

Current implementation: `imageCount -> n`, `aspectRatio -> size`, `quality -> quality`; `extra` can transparently transmit `size`, `quality`, `background`, `response_format`, `output_format`, `style`, `n`. `images` and `resolution` currently do not enter Vincentian graph requests.

## Vincent picture request

```bash
curl "{channel_base_url}/v1/images/generations" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_IMAGE_MODEL",
    "prompt":"雨夜便利店门口，青绿色霓虹，电影剧照",
    "size":"1536x1024",
    "quality":"high",
    "n":1
  }'
```

URL response:

```json
{"created":1780000000,"data":[{"url":"https://cdn.example/generated.png"}]}
```

Base64 response:

```json
{"created":1780000000,"data":[{"b64_json":"iVBORw0KGgo..."}]}
```

The parser iterates over `data[]`, identifying `url` first, but also accepts `b64_json` or `data`. The URL should be downloaded immediately; the bare Base64 will be converted to `data:image/png;base64,...`, and the value prefixed with the data URL will remain unchanged. If a channel uses WebP/JPEG Base64 and the response does not return MIME, the current protocol cannot reliably infer the format and should prioritize requesting the URL or supplementing the response contract with MIME.

## Image editing reference request

```bash
curl "{channel_base_url}/v1/images/edits" \
  -H "Authorization: Bearer <API_KEY>" \
  -F "model=YOUR_IMAGE_MODEL" \
  -F "image=@reference.png" \
  -F "prompt=保持人物一致，改成雨夜街道"
```

This example is an upstream protocol reference; the multipart construct, reference image number and MIME verification, and edit response testing must be completed before use in the host.

## Official information

- [OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI Images API reference](https://developers.openai.com/api/reference/resources/images)

{{CONTRACT}}
