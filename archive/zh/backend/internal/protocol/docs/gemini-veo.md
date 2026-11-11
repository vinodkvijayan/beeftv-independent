#GeminiVeo long tasks

The Veo plug-in creates a Google long-running operation through `predictLongRunning`, and then queries the operation until it is completed. The prompt word is located at `instances[0]`. Currently, at most the first reference image is taken and sent inline Base64.

## Interface and authentication

{{OPERATIONS}}

```http
POST {channel_base_url}/v1beta/models/{model}:predictLongRunning
GET  {channel_base_url}/v1beta/{operation_name}
x-goog-api-key: <GEMINI_API_KEY>
Content-Type: application/json
```

The API Key must be relayed through the backend header and cannot be placed in the browser URL. The OAuth, project, region, and publisher paths of Vertex AI Veo are different and the Gemini Developer API Base URL cannot be directly applied.

## Model and Capability Limitations

The model ID is placed unchanged in the creation path. Allowed duration, scale, resolution, audio, reference image type, concurrency, result retention period and billing are subject to Google's official model page and account area. The plugin does not maintain a whitelist. Currently the adapter only uses the first image; video/audio references and watermarks are not sent.

## Parameter and field mapping

{{PARAMETERS}}

The actual mapping is `aspectRatio`, `durationSeconds`, `resolution`, `generateAudio`, all put into `parameters`. The reference graph is fixed to `instances[0].image.inlineData`; MIME and data degrade to empty/generic values ​​without a data URL, so the remote URL should be downloaded first and converted to a data URL.

## Create task example

```bash
curl "{channel_base_url}/v1beta/models/YOUR_VEO_MODEL:predictLongRunning" \
  -H "x-goog-api-key: <GEMINI_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "instances":[{
      "prompt":"夜间列车驶过雪原，航拍镜头缓慢下降",
      "image":{"inlineData":{"mimeType":"image/png","data":"<BASE64>"}}
    }],
    "parameters":{"aspectRatio":"16:9","durationSeconds":8,"resolution":"720p","generateAudio":true}
  }'
```

## Operation polling and results

Create response returns operation `name`. The host will remove the leading slash, automatically complete the `operations/` prefix if it is missing, and then request `/v1beta/operations/...`.

```json
{"name":"operations/op_xxx","done":false}
```

This plugin uses a standalone Google LRO parser that does not go through the common `status/state` compatible branch: `done:false` is considered processing, top-level `error` is considered failed, `done:true` is followed by `video.uri` which reads the video from `response.generatedVideos[]` or `response.generateVideoResponse.generatedSamples[]`. Successful but missing video address will be returned as a real error, and the operation completion will not be falsely reported as the media has been saved.

```json
{
  "name":"operations/op_xxx",
  "done":true,
  "response":{
    "generateVideoResponse":{
      "generatedSamples":[
        {"video":{"uri":"https://generativelanguage.googleapis.com/v1beta/files/..."}}
      ]
    }
  }
}
```

## Official information

- [Gemini API video generation with Veo](https://ai.google.dev/gemini-api/docs/video)
- [Google long-running operations](https://ai.google.dev/api/files#method:-operations.get)

{{CONTRACT}}
