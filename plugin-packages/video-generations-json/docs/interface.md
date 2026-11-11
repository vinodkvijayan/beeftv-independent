# Interface description

## Selection conditions

The service provider document must also comply with the following formats: Bearer authentication; `POST /v1/video/generations`; JSON; `images`. It supports object arrays with `url` and `role`; the duration is an integer `duration`, and the ratio is `ratio`. You can’t tell just by the model name or “OpenAI compatibility”.

例如 [WhatsToken 视频接口](https://www.whatstoken.ai/docs/openai/doc0007)及 [Seedance 示例](https://www.whatstoken.ai/docs/examples/doc0047)公开了此格式。服务地址和 API Key 由用户填写，不内置域名识别。

## Input and image roles

`model`, `prompt`, `duration`, `ratio`, `resolution`, `generate_audio`, `watermark` are sent as original values. Pictures are sent in user order, retaining `first_frame`, `last_frame` or `reference_image`; when there is no character, `reference_image` is sent explicitly to avoid the two reference pictures being inferred as the first and last frames by the upstream. `videos` and `audios` are material address arrays. The specific quantity, size, duration and available functions are subject to the model contract and user configuration.

## Queries, responses and errors

The creation response should contain `task_id` or `id`. The query is `GET /v1/video/generations/{task_id}`; successful responses use `status: completed` and `data: [{url: "https://..."}]`. Failure status and `error.code` are handled as failures, `error.message` retains description; HTTP errors are not packaged as successes. The result link is temporary material, which is retrieved and saved by the host.

This plug-in does not declare the cancellation or authentication of the content download endpoint, nor will it switch to other protocols to resend after failure.

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest complete interface definition

The following JSON is consistent field by field with the actual `manifest.json` in the plug-in package, covering plug-in identity, permissions, configuration, authentication, parameters, verification, creation, Agent, query, cancellation, result download, response and Agent response mapping. The value of the `documentation` field is the current complete document; in order to avoid infinite recursion of the document within itself, only equivalent placeholder text is used to represent the main text in JSON.

```json
{
  "apiVersion": "beeftv.plugin/v2",
  "id": "video-generations-json",
  "name": "视频生成 JSON · ratio / duration",
  "version": "1.0.0",
  "author": "BeefTV Contributors",
  "description": "使用 images、ratio、duration 的异步视频 JSON 协议。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "video-generations-json",
        "label": "视频生成 JSON · ratio / duration",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "服务商提供的准确模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "images",
            "description": "保留顺序与 role 的图片对象数组。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "mapping": "videos",
            "description": "参考视频链接数组。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "mapping": "audios",
            "description": "参考音频链接数组。"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "时长，单位为秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "ratio",
            "description": "画幅比例。"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "description": "分辨率。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "mapping": "generate_audio",
            "description": "声音开关。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "mapping": "watermark",
            "description": "水印开关。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/video/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "images": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.images"
                    }
                  },
                  "as": "media",
                  "in": {
                    "url": {
                      "$ref": "media.value"
                    },
                    "role": {
                      "$coalesce": [
                        {
                          "$ref": "media.role"
                        },
                        "reference_image"
                      ]
                    }
                  }
                }
              }
            },
            "videos": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.videos"
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "audios": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.audios"
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "duration": {
              "$ref": "request.duration"
            },
            "ratio": {
              "$ref": "request.aspectRatio"
            },
            "resolution": {
              "$omitEmpty": {
                "$ref": "request.resolution"
              }
            },
            "generate_audio": {
              "$ref": "request.generateAudio"
            },
            "watermark": {
              "$ref": "request.watermark"
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/video/generations/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.task_id"
              },
              {
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              "pending"
            ]
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              },
              {
                "$ref": "response.fail_reason"
              }
            ]
          },
          "videos": {
            "$map": {
              "from": {
                "$ref": "response.data"
              },
              "as": "item",
              "in": {
                "$ref": "item.url"
              }
            }
          },
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- BEEFTV_PLUGIN_MANIFEST_END -->
