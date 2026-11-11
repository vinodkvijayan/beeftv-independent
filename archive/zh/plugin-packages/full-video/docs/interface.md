#Interface contract

Create `POST /v1/videos`; query `GET /v1/videos/{id}`; download the original film `GET /v1/videos/{id}/download`. Credentials are only sent to the user-configured API address.

Local reference materials are uploaded in parts via `/v1/media/uploads`. After completion, the content summary, number of bytes, type and actual duration are checked. By default, only materials from the same domain are accepted; independent material domain names must be explicitly filled in by the user in the connection settings.

Models with the same name in different services do not guarantee consistent protocols. Please select this protocol according to the service provider's interface document.

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest complete interface definition

The following JSON is consistent field by field with the actual `manifest.json` in the plug-in package, covering plug-in identity, permissions, configuration, authentication, parameters, verification, creation, Agent, query, cancellation, result download, response and Agent response mapping. The value of the `documentation` field is the current complete document; in order to avoid infinite recursion of the document within itself, only equivalent placeholder text is used to represent the main text in JSON.

```json
{
  "apiVersion": "beeftv.plugin/v2",
  "id": "full-video",
  "name": "全参视频",
  "version": "1.0.0",
  "author": "BeefTV Contributors",
  "description": "全参 2.0 / 2.5 的 JSON 请求、素材上传和原片下载。",
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
        "id": "full-video",
        "label": "全参视频",
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
            "description": "全参模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "mapping": "prompt",
            "description": "创作提示词。"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "seconds",
            "description": "整数秒数。"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "description": "画质。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "aspect_ratio",
            "description": "画幅。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "references",
            "description": "参考图片。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "mapping": "references",
            "description": "参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "mapping": "references",
            "description": "参考音频。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.model"
                },
                [
                  "sd-native-full-2.0",
                  "sd-native-full-2.5",
                  "原生不卡人脸-全参2.0",
                  "原生不卡人脸-全参2.5"
                ]
              ]
            },
            "message": "此协议支持全参 2.0 / 2.5，请选择对应模型。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "application/json",
          "headers": {
            "Idempotency-Key": {
              "$ref": "request.extra.idempotencyKey"
            }
          },
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "seconds": {
              "$ref": "request.duration"
            },
            "resolution": {
              "$ref": "request.resolution"
            },
            "aspect_ratio": {
              "$ref": "request.aspectRatio"
            },
            "references": {
              "$omitEmpty": {
                "$concatArrays": [
                  {
                    "$map": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "in": {
                        "type": "image",
                        "source": {
                          "$ref": "media.value"
                        },
                        "role": "reference"
                      }
                    }
                  },
                  {
                    "$map": {
                      "from": {
                        "$ref": "request.videos"
                      },
                      "as": "media",
                      "in": {
                        "type": "video",
                        "source": {
                          "$ref": "media.value"
                        },
                        "role": "reference",
                        "duration_seconds": {
                          "$divide": [
                            {
                              "$ref": "media.metadata.durationMs"
                            },
                            1000
                          ]
                        }
                      }
                    }
                  },
                  {
                    "$map": {
                      "from": {
                        "$ref": "request.audios"
                      },
                      "as": "media",
                      "in": {
                        "type": "audio",
                        "source": {
                          "$ref": "media.value"
                        },
                        "role": "reference",
                        "duration_seconds": {
                          "$divide": [
                            {
                              "$ref": "media.metadata.durationMs"
                            },
                            1000
                          ]
                        }
                      }
                    }
                  }
                ]
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}"
        },
        "result": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}/download",
          "headers": {
            "Accept": "video/mp4"
          }
        },
        "response": {
          "taskIdPaths": [
            "id"
          ],
          "statusPaths": [
            "status"
          ],
          "messagePaths": [
            "error.message",
            "message"
          ],
          "errorPaths": [
            "error.code"
          ],
          "resultKind": "video",
          "resultEphemeral": true
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- BEEFTV_PLUGIN_MANIFEST_END -->
