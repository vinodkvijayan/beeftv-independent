# MiniMax Hailuo Video V2 / H3 interface fields

## Entry and life cycle

- Create: `POST /v2/video_generation`.
- Query: `GET /v2/query/video_generation/{taskId}`.
- Authentication: `Authorization: Bearer <apiKey>`.
- Request: JSON; Result: Asynchronous task, download and persist temporary URL after completion.

## Request fields

| Upstream fields | Type | Required | Unified source | Description |
| --- | --- | --- | --- | --- |
| `model` | string | Yes | `request.model` | Hailuo/MiniMax video model ID. |
| `content` | block[] | Yes | prompt + inputs | The first block is text; the media blocks are output in order. |
| `content[].type` | enum | is | media.kind | `text/image_url/video_url/audio_url`. |
| `content[].text` | string | Text required | `request.prompt` | Do not send the top prompt repeatedly. |
| `content[].image_url.url` | string | Image block required | `media.value` | The public URL is guaranteed by the host. |
| `content[].video_url.url` | string | Video block required | `media.value` | Reference video. |
| `content[].audio_url.url` | string | Audio block required | `media.value` | Reference audio/sound. |
| `content[].role` | string | Media required | `media.role` | `first_frame/last_frame/reference_image/reference_video/reference_audio/reference_voice`. |
| `images` | media[] | No | image content blocks | Images are mapped by explicit role and order, without using array subscript guessing. |
| `videos` | media[] | No | video content blocks | Reference videos are mapped by role and order. |
| `audios` | media[] | No | audio content blocks | Reference audio or sounds mapped by role and order. |
| `duration` | integer | Yes | `request.duration` | 4-15 seconds. |
| `resolution` | string | No | `request.resolution` | Default `768P`; actual enumeration is based on model profile. |
| `ratio` | string | No | `request.aspectRatio` | The first and last frame modes are `adaptive`, and the rest default to `16:9`. |
| `aigc_watermark` | boolean | No | `request.watermark` | Whether to carry AIGC watermark. |
| `generate_audio` | boolean | No | `request.generateAudio` | Generate audio if model supports it. |
| `seed` | integer | No | `providerOptions.minimax-video.seed` | Random seed. |
| `prompt_optimizer` | boolean | No | `providerOptions.minimax-video.prompt_optimizer` | Prompt word optimization switch. |

## Strong verification

- Up to 9 pictures, 3 videos, and 3 audios.
- The first frame and the last frame can each have a maximum of 1 picture; the last frame cannot be separated from the first frame.
- The first and last frame modes cannot be mixed with `reference_image/subject_reference/style_reference`.

## Transit compatibility boundary

This plug-in corresponds to the MiniMax `/v2/video_generation` native line protocol. NewAPI Channel 1, Channel 2 and custom OpenAI Videos transfer must select independent plug-ins; the protocol cannot be automatically switched based only on the model name containing `H3`.

## Response mapping

- `task_id` / `data.task_id` are mapped to unified task IDs.
- `status` / `data.status` map to `pending/processing/succeeded/failed/cancelled`.
- `file_id`, `video_url` and their `data` nested forms map to unified video results.
- `message` / `base_resp.status_msg` mapped to unified error messages.
- The completed temporary media address is immediately downloaded and persisted by the host.

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest complete interface definition

The following JSON is consistent field by field with the actual `manifest.json` in the plug-in package, covering plug-in identity, permissions, configuration, authentication, parameters, verification, creation, Agent, query, cancellation, result download, response and Agent response mapping. The value of the `documentation` field is the current complete document; in order to avoid infinite recursion of the document within itself, only equivalent placeholder text is used to represent the main text in JSON.

```json
{
  "apiVersion": "beeftv.plugin/v2",
  "id": "minimax-hailuo-video-v2",
  "name": "MiniMax Hailuo Video V2 / H3",
  "version": "2.0.0",
  "author": "BeefTV Contributors",
  "description": "MiniMax / Hailuo V2 视频生成协议，保留首帧、尾帧、参考图、视频和音频角色语义。",
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
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
        "id": "minimax-video",
        "label": "MiniMax Hailuo Video V2 / H3",
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
        "baseUrl": "https://api.minimax.io",
        "requiresPublicMediaUrls": true,
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
            "description": "MiniMax/Hailuo 视频模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "content[type=text].text",
            "description": "仅写入 text content block，避免与顶层 prompt 重复。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "content[type=image_url]",
            "description": "保留 first_frame、last_frame、reference_image 等 role。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "mapping": "content[type=video_url]",
            "description": "映射为 reference_video。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "mapping": "content[type=audio_url]",
            "description": "映射为 reference_audio/reference_voice。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "values": [
              "4",
              "5",
              "6",
              "7",
              "8",
              "9",
              "10",
              "11",
              "12",
              "13",
              "14",
              "15"
            ],
            "mapping": "duration",
            "description": "4-15 秒。"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "description": "如 768P、1080P、2K；按模型能力限制。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "ratio",
            "description": "首尾帧模式自动使用 adaptive；其他模式使用用户比例。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "mapping": "aigc_watermark",
            "description": "AIGC 水印。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "mapping": "generate_audio",
            "description": "模型支持时生成音频。"
          },
          {
            "name": "seed",
            "type": "integer",
            "mapping": "seed",
            "description": "providerOptions.minimax-video.seed。"
          },
          {
            "name": "prompt_optimizer",
            "type": "boolean",
            "mapping": "prompt_optimizer",
            "description": "providerOptions.minimax-video.prompt_optimizer。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                9
              ]
            },
            "message": "MiniMax H3 最多支持 9 张图片"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                3
              ]
            },
            "message": "MiniMax H3 最多支持 3 个参考视频"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                3
              ]
            },
            "message": "MiniMax H3 最多支持 3 个参考音频"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "image",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "image.role"
                          },
                          "first_frame"
                        ]
                      }
                    }
                  }
                },
                1
              ]
            },
            "message": "MiniMax H3 最多只能有一个首帧"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "image",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "image.role"
                          },
                          "last_frame"
                        ]
                      }
                    }
                  }
                },
                1
              ]
            },
            "message": "MiniMax H3 最多只能有一个尾帧"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "image",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "image.role"
                              },
                              "last_frame"
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "image",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "image.role"
                              },
                              "first_frame"
                            ]
                          }
                        }
                      }
                    },
                    1
                  ]
                }
              ]
            },
            "message": "MiniMax H3 使用尾帧时必须同时提供首帧"
          },
          {
            "assert": {
              "$not": {
                "$and": [
                  {
                    "$gt": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$ref": "request.images"
                            },
                            "as": "image",
                            "where": {
                              "$in": [
                                {
                                  "$ref": "image.role"
                                },
                                [
                                  "first_frame",
                                  "last_frame"
                                ]
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  },
                  {
                    "$gt": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$ref": "request.images"
                            },
                            "as": "image",
                            "where": {
                              "$in": [
                                {
                                  "$ref": "image.role"
                                },
                                [
                                  "reference_image",
                                  "subject_reference",
                                  "style_reference"
                                ]
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  }
                ]
              }
            },
            "message": "MiniMax H3 首尾帧模式不能混入普通角色或风格参考图"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/video_generation",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "content": {
              "$concatArrays": [
                [
                  {
                    "type": "text",
                    "text": {
                      "$ref": "request.prompt"
                    }
                  }
                ],
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.images"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "image_url",
                      "image_url": {
                        "url": {
                          "$ref": "media.value"
                        }
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
                },
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.videos"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "video_url",
                      "video_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": {
                        "$coalesce": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_video"
                        ]
                      }
                    }
                  }
                },
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.audios"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "audio_url",
                      "audio_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": {
                        "$coalesce": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_audio"
                        ]
                      }
                    }
                  }
                }
              ]
            },
            "duration": {
              "$ref": "request.duration"
            },
            "resolution": {
              "$coalesce": [
                {
                  "$ref": "request.resolution"
                },
                "768P"
              ]
            },
            "ratio": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "image",
                          "where": {
                            "$in": [
                              {
                                "$ref": "image.role"
                              },
                              [
                                "first_frame",
                                "last_frame"
                              ]
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                "then": "adaptive",
                "else": {
                  "$coalesce": [
                    {
                      "$ref": "request.aspectRatio"
                    },
                    "16:9"
                  ]
                }
              }
            },
            "aigc_watermark": {
              "$ref": "request.watermark"
            },
            "generate_audio": {
              "$ref": "request.generateAudio"
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.minimax-video.seed"
              }
            },
            "prompt_optimizer": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.minimax-video.prompt_optimizer"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/query/video_generation/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.task.id"
              },
              {
                "$ref": "response.task_id"
              },
              {
                "$ref": "response.data.task_id"
              },
              {
                "$ref": "response.data.id"
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
                "$ref": "response.task.status"
              },
              {
                "$ref": "response.status"
              },
              {
                "$ref": "response.data.status"
              },
              "pending"
            ]
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.task.error.message"
              },
              {
                "$ref": "response.task.message"
              },
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.data.error.message"
              },
              {
                "$ref": "response.message"
              },
              {
                "$ref": "response.base_resp.status_msg"
              }
            ]
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.task.content.url"
              },
              {
                "$ref": "response.content.url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.file.url"
              },
              {
                "$ref": "response.file.download_url"
              },
              {
                "$ref": "response.data.file.download_url"
              }
            ]
          },
          "errorPaths": [
            "task.error.code",
            "base_resp.status_code",
            "error.code"
          ],
          "resultEphemeral": true
        }
      }
    ]
  }
}
```
<!-- BEEFTV_PLUGIN_MANIFEST_END -->
