# Gemini image generation

The Gemini picture plug-in calls `generateContent` to organize the prompt words and reference pictures into a `user` content. The Data URL is split into `inline_data` and the external URL is sent as `file_data.file_uri`; the response is parsed from the inline image in the candidate content.

## Interface and authentication

{{OPERATIONS}}

```http
POST {channel_base_url}/v1beta/models/{model}:generateContent
x-goog-api-key: <GEMINI_API_KEY>
Content-Type: application/json
```

When transferring through back-end channels, the API Key must remain in the server header and cannot be placed in the browser URL. Vertex AI uses different Base URLs, OAuth and resource paths, and this plug-in cannot be reused directly unless the gateway converts the protocol.

## Model and output mode

Only Gemini models that support native image output can return inline images. The model ID is put into the URL as is and path escaped. The plugin does not maintain model whitelists, image size tables, or billing, as these should be determined by a combination of the official model page and the channel model configuration.

## Parameter and field mapping

{{PARAMETERS}}

`aspectRatio -> generationConfig.imageConfig.aspectRatio`. `quality` takes priority, `resolution` falls back, and is mapped to `generationConfig.imageConfig.imageSize` by the plug-in (only `1K` / `2K` / `4K`); unknown values ​​(such as canvas video resolution `720`) are omitted and cannot overwrite the selected picture level. Multiple images are created one by one by the host, and `candidateCount` is not mapped. `extra` replaces `generationConfig`, `safetySettings`, and `systemInstruction`; the caller must retain the desired picture output configuration when replacing the complete configuration.

## Vincent picture request

```bash
curl "{channel_base_url}/v1beta/models/YOUR_MODEL:generateContent" \
  -H "x-goog-api-key: <GEMINI_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "contents":[{"role":"user","parts":[{"text":"复古科幻电影海报，中文标题清晰"}]}],
    "generationConfig":{"imageConfig":{"aspectRatio":"3:4","imageSize":"2K"}}
  }'
```

## Reference picture request

```json
{
  "contents":[{"role":"user","parts":[
    {"text":"保持人物一致，改为冬季服装"},
    {"inline_data":{"mime_type":"image/png","data":"<BASE64>"}}
  ]}]
}
```

The external URL will be constructed as `file_data.file_uri`. Whether this URI allows any HTTP URL depends on the upstream; if the official only accepts Files API URI, the file must be uploaded first, and the current plug-in will not automatically transfer it.

## Response parsing and security

The parser traverses `candidates[].content.parts[]`, identifies `inlineData` or `inline_data`, and generates `data:<mime>;base64,...`. Requests with only text, finishReason, or safety feedback without inline images will fail. Large images cannot be entered into localStorage and should be transferred to the host resource storage immediately.

## Official information

- [Gemini native image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Gemini generateContent API](https://ai.google.dev/api/generate-content)

{{CONTRACT}}
