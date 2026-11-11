# Volcengine Ark Seedream Images interface fields

## Protocol Identity

- Plugin ID: `volcengine-ark-seedream`.
- Provider ID: `volcengine-ark-image`.
- Abilities: `image`.
-Default Base URL: `https://ark.cn-beijing.volces.com`.
- Authentication driver: `bearer`.
- Create: `POST /images/generations`, the default path prefix is ​​`/api/v3`; the configured prefixes such as `/v1` and `/api/v3` are retained.
- Life cycle: Single images and layers return JSON, group images can return `text/event-stream`; request format, size verification and response mapping are all declared by this plug-in.

## Configuration fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `apiKey` | secret | Yes | API Key |

## Unified field mapping

| Uniform Fields | Type | Required | Upstream Mapping | Description |
| --- | --- | --- | --- | --- |
| `model` | string | Yes | `model` | Image model ID. |
| `prompt` | string | Yes | `prompt` | Picture prompt word. |
| `images` | media[] | No | `provider image/reference fields` | Reference picture or edit source picture, role is determined by the business layer. |
| `imageCount` | integer | No | Do not send `n` directly | Use `output.options.maxImages` for group pictures, and set the maximum number in a single request. |
| `aspectRatio` | string | No | `size/aspect_ratio` | Scale or size, semantics are specified by the protocol. |
| `resolution` | string | No | `resolution/imageSize` | Resolution level. |
| `quality` | string | No | `quality` | Quality level. |
| `providerOptions` | object | No | `provider-specific fields` | Vendor extension field within the plug-in namespace. |

## Image options

`output.options` is the image control value saved by the host; the plug-in calculates the pure expression variables in the provider sequentially, and uses the same set of variable checksums to construct the request. Variables are only valid in the current request and cannot reference variables declared later.

| Options | Upstream Fields | Behavior |
| --- | --- | --- |
| `mode=layers` | `layer_decomposition` | Must have source map; retain `z_index`, `bounding_box`, `name`, `description` of each layer. |
| `maxImages` | `sequential_image_generation_options.max_images` | Models that support image composition use a single SSE request; missing images will not be reissued. |
| `transparent=true` | `background=transparent` | Force PNG and verify transparent background capability by model. |
| `format` | `output_format` | Default PNG; only sent on models that support this field. |
| `optimize` | `optimize_prompt_options.mode` | User selection retained. |
| `watermark` | `watermark` | Default false. |

`size` is calculated by a combination of scale, size gear, and current model, and no longer goes through the host's Ark universal scaler. Unsupported size, mask, layer, or transparency options are rejected before issuing a POST. The complete expression is subject to the manifest generated below.

## Provider extension key

- `providerOptions.volcengine-ark-image.response_format`
- `providerOptions.volcengine-ark-image.seed`
- `providerOptions.volcengine-ark-image.sequential_image_generation`
- `providerOptions.volcengine-ark-image.sequential_image_generation_options`
- `providerOptions.volcengine-ark-image.watermark`

These extended keys continue to be compatible; the value explicitly selected by the picture control takes precedence. `response_format` defaults to `url`, old `b64_json` responses still read and correct MIME by actual image bytes.

## Response mapping field-by-field list

| Mapping location | Upstream path or transformation expression |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.images` | `{"$ref":"response.data"}` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.messagePaths[0]` | `"error.message"` |

## Responses and Errors

Images in JSON and completed images in SSE use the same result contract. SSE sorts and deduplicates by non-negative integer index; empty events, bad events, and subsequent failures do not discard valid pictures that have been received. If all fail, an error is returned. Only SSE explicitly declared in the manifest will be parsed.

The temporary image URL is marked as ephemeral, which is immediately downloaded and verified by the host and then persisted; empty content and HTML/JSON disguised as images are rejected. Transparent pixels are not re-encoded. HTTP errors, business code, and error objects maintain failure semantics.

## Compatibility boundary

Official Ark inference access: The Base URL uses /api/v3, and the API Key comes from the Ark inference access console and cannot be mixed with the Agent Plan exclusive Key.

The manifest version of 2.1.0 is `beeftv.plugin/v3`, which relies on a host that supports providers `variables`, `defaultPathPrefix`, images `response.stream` and `detectImageMime` at the same time; the old host rejects the manifest when loading, and cannot continue the request after ignoring the new fields. New hosts continue to read v1/v2 plugins, but new fields must declare v3. Agent Plan uses its own independent plug-in and address. When the plug-in is not installed or disabled, the host rejects the request before POST and does not return the handwritten requester.

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest complete interface definition

The following JSON is consistent field by field with the actual `manifest.json` in the plug-in package, covering plug-in identity, permissions, configuration, authentication, parameters, verification, creation, Agent, query, cancellation, result download, response and Agent response mapping. The value of the `documentation` field is the current complete document; in order to avoid infinite recursion of the document within itself, only equivalent placeholder text is used to represent the main text in JSON.

```json
{
  "apiVersion": "beeftv.plugin/v3",
  "id": "volcengine-ark-seedream",
  "name": "Volcengine Ark Seedream Images",
  "version": "2.1.0",
  "author": "BeefTV Contributors",
  "description": "Volcengine Ark Seedream Images 独立请求协议插件。",
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
        "id": "volcengine-ark-image",
        "label": "Volcengine Ark Seedream Images",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://ark.cn-beijing.volces.com",
        "requiresPublicMediaUrls": false,
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
            "description": "图片模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "图片提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "provider image/reference fields",
            "description": "参考图或编辑源图，role 由业务层确定。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n/sample_count",
            "description": "输出数量。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "size/aspect_ratio",
            "description": "比例或尺寸，语义按协议说明。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution/imageSize",
            "description": "分辨率档位。"
          },
          {
            "name": "quality",
            "type": "string",
            "required": false,
            "mapping": "quality",
            "description": "质量档位。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "插件命名空间内的厂商扩展字段。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/images/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$if": {
                "condition": {
                  "$ref": "request.instructions"
                },
                "then": {
                  "$concat": [
                    {
                      "$ref": "request.instructions"
                    },
                    "\n\n",
                    {
                      "$ref": "request.prompt"
                    }
                  ]
                },
                "else": {
                  "$ref": "request.prompt"
                }
              }
            },
            "size": {
              "$omitEmpty": {
                "$ref": "vars.size"
              }
            },
            "image": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$ref": "request.images"
                        }
                      },
                      1
                    ]
                  },
                  "then": {
                    "$first": {
                      "$map": {
                        "from": {
                          "$ref": "request.images"
                        },
                        "as": "media",
                        "in": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  },
                  "else": {
                    "$if": {
                      "condition": {
                        "$gt": [
                          {
                            "$len": {
                              "$ref": "request.images"
                            }
                          },
                          1
                        ]
                      },
                      "then": {
                        "$map": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "in": {
                            "$ref": "media.value"
                          }
                        }
                      },
                      "else": null
                    }
                  }
                }
              }
            },
            "sequential_image_generation": {
              "$if": {
                "condition": {
                  "$ref": "vars.group"
                },
                "then": "auto",
                "else": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.volcengine-ark-image.sequential_image_generation"
                  }
                }
              }
            },
            "sequential_image_generation_options": {
              "$if": {
                "condition": {
                  "$ref": "vars.group"
                },
                "then": {
                  "max_images": {
                    "$ref": "vars.maxImages"
                  }
                },
                "else": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.volcengine-ark-image.sequential_image_generation_options"
                  }
                }
              }
            },
            "watermark": {
              "$coalesce": [
                {
                  "$if": {
                    "condition": {
                      "$ref": "request.output.options.watermark"
                    },
                    "then": {
                      "$eq": [
                        {
                          "$ref": "request.output.options.watermark"
                        },
                        "true"
                      ]
                    },
                    "else": null
                  }
                },
                {
                  "$ref": "request.providerOptions.volcengine-ark-image.watermark"
                },
                {
                  "$ref": "request.watermark"
                },
                false
              ]
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-image.seed"
              }
            },
            "response_format": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.volcengine-ark-image.response_format"
                },
                {
                  "$if": {
                    "condition": {
                      "$ref": "vars.recognized"
                    },
                    "then": "url",
                    "else": "b64_json"
                  }
                }
              ]
            },
            "layer_decomposition": {
              "$if": {
                "condition": {
                  "$ref": "vars.layers"
                },
                "then": true,
                "else": null
              }
            },
            "background": {
              "$if": {
                "condition": {
                  "$ref": "vars.transparent"
                },
                "then": "transparent",
                "else": null
              }
            },
            "output_format": {
              "$if": {
                "condition": {
                  "$ref": "vars.supportsFormat"
                },
                "then": {
                  "$if": {
                    "condition": {
                      "$ref": "vars.transparent"
                    },
                    "then": "png",
                    "else": {
                      "$ref": "vars.format"
                    }
                  }
                },
                "else": null
              }
            },
            "optimize_prompt_options": {
              "$if": {
                "condition": {
                  "$or": [
                    {
                      "$ref": "request.output.options.optimize"
                    },
                    {
                      "$ref": "request.providerOptions.volcengine-ark-image.optimize_prompt_options.mode"
                    }
                  ]
                },
                "then": {
                  "mode": {
                    "$coalesce": [
                      {
                        "$omitEmpty": {
                          "$ref": "request.output.options.optimize"
                        }
                      },
                      {
                        "$ref": "request.providerOptions.volcengine-ark-image.optimize_prompt_options.mode"
                      }
                    ]
                  }
                },
                "else": null
              }
            },
            "stream": {
              "$if": {
                "condition": {
                  "$ref": "vars.group"
                },
                "then": true,
                "else": null
              }
            }
          },
          "defaultPathPrefix": "/api/v3"
        },
        "response": {
          "status": "succeeded",
          "images": {
            "$map": {
              "from": {
                "$ref": "response.data"
              },
              "as": "image",
              "in": {
                "url": {
                  "$ref": "image.url"
                },
                "dataUrl": {
                  "$ref": "image.b64_json"
                },
                "output_format": {
                  "$ref": "image.output_format"
                },
                "metadata": {
                  "layer": {
                    "$if": {
                      "condition": {
                        "$or": [
                          {
                            "$ne": [
                              {
                                "$ref": "image.z_index"
                              },
                              null
                            ]
                          },
                          {
                            "$ne": [
                              {
                                "$ref": "image.bounding_box"
                              },
                              null
                            ]
                          }
                        ]
                      },
                      "then": {
                        "z_index": {
                          "$ref": "image.z_index"
                        },
                        "bounding_box": {
                          "$ref": "image.bounding_box"
                        },
                        "name": {
                          "$ref": "image.name"
                        },
                        "description": {
                          "$ref": "image.description"
                        },
                        "size": {
                          "$ref": "image.size"
                        },
                        "output_format": {
                          "$ref": "image.output_format"
                        }
                      },
                      "else": null
                    }
                  }
                }
              }
            }
          },
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error.code"
          ],
          "messagePaths": [
            "error.message"
          ],
          "resultEphemeral": true,
          "detectImageMime": true,
          "stream": {
            "typePath": "type",
            "itemEvents": [
              "image_generation.partial_succeeded"
            ],
            "errorEvents": [
              "image_generation.partial_failed",
              "error"
            ],
            "indexPath": "image_index",
            "images": [
              {
                "url": {
                  "$ref": "response.url"
                },
                "dataUrl": {
                  "$ref": "response.b64_json"
                },
                "output_format": {
                  "$ref": "response.output_format"
                },
                "metadata": {
                  "layer": {
                    "$if": {
                      "condition": {
                        "$or": [
                          {
                            "$ne": [
                              {
                                "$ref": "response.z_index"
                              },
                              null
                            ]
                          },
                          {
                            "$ne": [
                              {
                                "$ref": "response.bounding_box"
                              },
                              null
                            ]
                          }
                        ]
                      },
                      "then": {
                        "z_index": {
                          "$ref": "response.z_index"
                        },
                        "bounding_box": {
                          "$ref": "response.bounding_box"
                        },
                        "name": {
                          "$ref": "response.name"
                        },
                        "description": {
                          "$ref": "response.description"
                        },
                        "size": {
                          "$ref": "response.size"
                        },
                        "output_format": {
                          "$ref": "response.output_format"
                        }
                      },
                      "else": null
                    }
                  }
                }
              }
            ],
            "usage": {
              "$ref": "response.usage"
            },
            "messagePaths": [
              "error.message"
            ]
          }
        },
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "media.role"
                          },
                          "mask"
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "Seedream 不支持蒙版编辑"
          },
          {
            "assert": {
              "$and": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    0
                  ]
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.audios"
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "Seedream 只支持图片参考"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                {
                  "$if": {
                    "condition": {
                      "$ref": "vars.modern"
                    },
                    "then": 10,
                    "else": 14
                  }
                }
              ]
            },
            "message": "参考图数量超出当前 Seedream 型号的限制"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$ref": "vars.layers"
                  }
                },
                {
                  "$and": [
                    {
                      "$ref": "vars.modern"
                    },
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        },
                        1
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "图层拆分需要 Pro 或 Flash 型号和一张参考图"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$ref": "vars.transparent"
                  }
                },
                {
                  "$and": [
                    {
                      "$ref": "vars.modern"
                    },
                    {
                      "$not": {
                        "$ref": "vars.layers"
                      }
                    },
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        },
                        1
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "透明背景需要 Pro 或 Flash 型号和一张参考图，不能与图层拆分同时使用"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$ref": "vars.group"
                  }
                },
                {
                  "$lte": [
                    {
                      "$add": [
                        {
                          "$ref": "vars.maxImages"
                        },
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        }
                      ]
                    },
                    15
                  ]
                }
              ]
            },
            "message": "参考图和生成图片合计不能超过 15 张"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$ref": "vars.supportsFormat"
                  }
                },
                {
                  "$in": [
                    {
                      "$ref": "vars.format"
                    },
                    [
                      "png",
                      "jpeg"
                    ]
                  ]
                }
              ]
            },
            "message": "图片格式只支持 png 或 jpeg"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$ref": "vars.recognized"
                  }
                },
                {
                  "$or": [
                    {
                      "$not": {
                        "$and": [
                          {
                            "$in": [
                              "seedream",
                              {
                                "$ref": "vars.modelTokens"
                              }
                            ]
                          },
                          {
                            "$or": [
                              {
                                "$in": [
                                  "4",
                                  {
                                    "$ref": "vars.modelTokens"
                                  }
                                ]
                              },
                              {
                                "$in": [
                                  "5",
                                  {
                                    "$ref": "vars.modelTokens"
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    },
                    {
                      "$in": [
                        {
                          "$ref": "vars.size"
                        },
                        {
                          "$switch": {
                            "cases": [
                              {
                                "when": {
                                  "$ref": "vars.modern"
                                },
                                "then": [
                                  "1K",
                                  "1.5K",
                                  "2K"
                                ]
                              },
                              {
                                "when": {
                                  "$ref": "vars.legacy4"
                                },
                                "then": [
                                  "1K",
                                  "2K",
                                  "4K"
                                ]
                              },
                              {
                                "when": {
                                  "$in": [
                                    "4",
                                    {
                                      "$ref": "vars.modelTokens"
                                    }
                                  ]
                                },
                                "then": [
                                  "2K",
                                  "4K"
                                ]
                              }
                            ],
                            "default": [
                              "2K",
                              "3K",
                              "4K"
                            ]
                          }
                        }
                      ]
                    },
                    {
                      "$and": [
                        {
                          "$ref": "vars.layers"
                        },
                        {
                          "$eq": [
                            {
                              "$ref": "vars.size"
                            },
                            "auto"
                          ]
                        }
                      ]
                    },
                    {
                      "$and": [
                        {
                          "$not": {
                            "$ref": "vars.layers"
                          }
                        },
                        {
                          "$and": [
                            {
                              "$eq": [
                                {
                                  "$len": {
                                    "$split": [
                                      {
                                        "$ref": "vars.size"
                                      },
                                      "x"
                                    ]
                                  }
                                },
                                2
                              ]
                            },
                            {
                              "$gt": [
                                {
                                  "$ref": "vars.width"
                                },
                                0
                              ]
                            },
                            {
                              "$gt": [
                                {
                                  "$ref": "vars.height"
                                },
                                0
                              ]
                            },
                            {
                              "$lte": [
                                {
                                  "$ref": "vars.width"
                                },
                                {
                                  "$multiply": [
                                    {
                                      "$ref": "vars.height"
                                    },
                                    16
                                  ]
                                }
                              ]
                            },
                            {
                              "$lte": [
                                {
                                  "$ref": "vars.height"
                                },
                                {
                                  "$multiply": [
                                    {
                                      "$ref": "vars.width"
                                    },
                                    16
                                  ]
                                }
                              ]
                            },
                            {
                              "$gte": [
                                {
                                  "$ref": "vars.pixels"
                                },
                                {
                                  "$if": {
                                    "condition": {
                                      "$or": [
                                        {
                                          "$ref": "vars.modern"
                                        },
                                        {
                                          "$ref": "vars.legacy4"
                                        }
                                      ]
                                    },
                                    "then": 921600,
                                    "else": 3686400
                                  }
                                }
                              ]
                            },
                            {
                              "$lte": [
                                {
                                  "$ref": "vars.pixels"
                                },
                                {
                                  "$if": {
                                    "condition": {
                                      "$ref": "vars.modern"
                                    },
                                    "then": 4624220,
                                    "else": 16777216
                                  }
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "当前 Seedream 型号或图层模式不支持这个尺寸，请调整尺寸后重试"
          }
        ],
        "variables": [
          {
            "name": "modelTokens",
            "value": {
              "$split": [
                {
                  "$lower": {
                    "$ref": "request.model"
                  }
                },
                "-"
              ]
            }
          },
          {
            "name": "rawSize",
            "value": {
              "$lower": {
                "$trim": {
                  "$coalesce": [
                    {
                      "$ref": "request.aspectRatio"
                    },
                    ""
                  ]
                }
              }
            }
          },
          {
            "name": "modern",
            "value": {
              "$and": [
                {
                  "$in": [
                    "seedream",
                    {
                      "$ref": "vars.modelTokens"
                    }
                  ]
                },
                {
                  "$in": [
                    "5",
                    {
                      "$ref": "vars.modelTokens"
                    }
                  ]
                },
                {
                  "$or": [
                    {
                      "$in": [
                        "pro",
                        {
                          "$ref": "vars.modelTokens"
                        }
                      ]
                    },
                    {
                      "$in": [
                        "flash",
                        {
                          "$ref": "vars.modelTokens"
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          },
          {
            "name": "legacy4",
            "value": {
              "$and": [
                {
                  "$in": [
                    "seedream",
                    {
                      "$ref": "vars.modelTokens"
                    }
                  ]
                },
                {
                  "$and": [
                    {
                      "$in": [
                        "4",
                        {
                          "$ref": "vars.modelTokens"
                        }
                      ]
                    },
                    {
                      "$in": [
                        "0",
                        {
                          "$ref": "vars.modelTokens"
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          },
          {
            "name": "family45",
            "value": {
              "$and": [
                {
                  "$in": [
                    "seedream",
                    {
                      "$ref": "vars.modelTokens"
                    }
                  ]
                },
                {
                  "$in": [
                    "4",
                    {
                      "$ref": "vars.modelTokens"
                    }
                  ]
                },
                {
                  "$in": [
                    "5",
                    {
                      "$ref": "vars.modelTokens"
                    }
                  ]
                }
              ]
            }
          },
          {
            "name": "recognized",
            "value": {
              "$or": [
                {
                  "$ref": "vars.modern"
                },
                {
                  "$ref": "vars.legacy4"
                },
                {
                  "$ref": "vars.family45"
                },
                {
                  "$and": [
                    {
                      "$in": [
                        "seedream",
                        {
                          "$ref": "vars.modelTokens"
                        }
                      ]
                    },
                    {
                      "$in": [
                        "5",
                        {
                          "$ref": "vars.modelTokens"
                        }
                      ]
                    },
                    {
                      "$not": {
                        "$in": [
                          "4",
                          {
                            "$ref": "vars.modelTokens"
                          }
                        ]
                      }
                    }
                  ]
                }
              ]
            }
          },
          {
            "name": "layers",
            "value": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.output.options.mode"
                    },
                    "layers"
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.volcengine-ark-image.layer_decomposition"
                    },
                    true
                  ]
                }
              ]
            }
          },
          {
            "name": "transparent",
            "value": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.output.options.transparent"
                    },
                    "true"
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.volcengine-ark-image.background"
                    },
                    "transparent"
                  ]
                }
              ]
            }
          },
          {
            "name": "maxImages",
            "value": {
              "$max": [
                1,
                {
                  "$toInt": {
                    "$coalesce": [
                      {
                        "$omitEmpty": {
                          "$ref": "request.output.options.maxImages"
                        }
                      },
                      {
                        "$ref": "request.providerOptions.volcengine-ark-image.sequential_image_generation_options.max_images"
                      },
                      1
                    ]
                  }
                }
              ]
            }
          },
          {
            "name": "group",
            "value": {
              "$and": [
                {
                  "$ref": "vars.recognized"
                },
                {
                  "$not": {
                    "$ref": "vars.modern"
                  }
                },
                {
                  "$gt": [
                    {
                      "$ref": "vars.maxImages"
                    },
                    1
                  ]
                }
              ]
            }
          },
          {
            "name": "supportsFormat",
            "value": {
              "$or": [
                {
                  "$ref": "vars.modern"
                },
                {
                  "$and": [
                    {
                      "$in": [
                        "seedream",
                        {
                          "$ref": "vars.modelTokens"
                        }
                      ]
                    },
                    {
                      "$in": [
                        "5",
                        {
                          "$ref": "vars.modelTokens"
                        }
                      ]
                    },
                    {
                      "$not": {
                        "$in": [
                          "4",
                          {
                            "$ref": "vars.modelTokens"
                          }
                        ]
                      }
                    }
                  ]
                }
              ]
            }
          },
          {
            "name": "format",
            "value": {
              "$coalesce": [
                {
                  "$omitEmpty": {
                    "$ref": "request.output.options.format"
                  }
                },
                {
                  "$ref": "request.providerOptions.volcengine-ark-image.output_format"
                },
                "png"
              ]
            }
          },
          {
            "name": "size",
            "value": {
              "$switch": {
                "cases": [
                  {
                    "when": {
                      "$in": [
                        {
                          "$ref": "vars.rawSize"
                        },
                        [
                          "",
                          "1:1"
                        ]
                      ]
                    },
                    "then": {
                      "$if": {
                        "condition": {
                          "$ref": "vars.recognized"
                        },
                        "then": "2K",
                        "else": {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "vars.rawSize"
                                },
                                ""
                              ]
                            },
                            "then": null,
                            "else": "2048x2048"
                          }
                        }
                      }
                    }
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "vars.rawSize"
                        },
                        "auto"
                      ]
                    },
                    "then": {
                      "$if": {
                        "condition": {
                          "$ref": "vars.recognized"
                        },
                        "then": {
                          "$if": {
                            "condition": {
                              "$ref": "vars.layers"
                            },
                            "then": "auto",
                            "else": "2K"
                          }
                        },
                        "else": "2k"
                      }
                    }
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "vars.rawSize"
                        },
                        "4:3"
                      ]
                    },
                    "then": {
                      "$if": {
                        "condition": {
                          "$ref": "vars.layers"
                        },
                        "then": "2K",
                        "else": "2304x1728"
                      }
                    }
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "vars.rawSize"
                        },
                        "3:4"
                      ]
                    },
                    "then": {
                      "$if": {
                        "condition": {
                          "$ref": "vars.layers"
                        },
                        "then": "2K",
                        "else": "1728x2304"
                      }
                    }
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "vars.rawSize"
                        },
                        "16:9"
                      ]
                    },
                    "then": {
                      "$if": {
                        "condition": {
                          "$ref": "vars.layers"
                        },
                        "then": "2K",
                        "else": "2560x1440"
                      }
                    }
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "vars.rawSize"
                        },
                        "9:16"
                      ]
                    },
                    "then": {
                      "$if": {
                        "condition": {
                          "$ref": "vars.layers"
                        },
                        "then": "2K",
                        "else": "1440x2560"
                      }
                    }
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "vars.rawSize"
                        },
                        "3:2"
                      ]
                    },
                    "then": {
                      "$if": {
                        "condition": {
                          "$ref": "vars.layers"
                        },
                        "then": "2K",
                        "else": "2496x1664"
                      }
                    }
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "vars.rawSize"
                        },
                        "2:3"
                      ]
                    },
                    "then": {
                      "$if": {
                        "condition": {
                          "$ref": "vars.layers"
                        },
                        "then": "2K",
                        "else": "1664x2496"
                      }
                    }
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "vars.rawSize"
                        },
                        "21:9"
                      ]
                    },
                    "then": {
                      "$if": {
                        "condition": {
                          "$ref": "vars.layers"
                        },
                        "then": "2K",
                        "else": "3024x1296"
                      }
                    }
                  },
                  {
                    "when": {
                      "$in": [
                        {
                          "$ref": "vars.rawSize"
                        },
                        [
                          "1k",
                          "1.5k",
                          "2k",
                          "3k",
                          "4k"
                        ]
                      ]
                    },
                    "then": {
                      "$if": {
                        "condition": {
                          "$ref": "vars.recognized"
                        },
                        "then": {
                          "$upper": {
                            "$ref": "vars.rawSize"
                          }
                        },
                        "else": {
                          "$ref": "request.aspectRatio"
                        }
                      }
                    }
                  }
                ],
                "default": {
                  "$if": {
                    "condition": {
                      "$ref": "vars.recognized"
                    },
                    "then": {
                      "$ref": "vars.rawSize"
                    },
                    "else": {
                      "$ref": "request.aspectRatio"
                    }
                  }
                }
              }
            }
          },
          {
            "name": "width",
            "value": {
              "$toInt": {
                "$at": [
                  {
                    "$split": [
                      {
                        "$ref": "vars.size"
                      },
                      "x"
                    ]
                  },
                  0
                ]
              }
            }
          },
          {
            "name": "height",
            "value": {
              "$toInt": {
                "$at": [
                  {
                    "$split": [
                      {
                        "$ref": "vars.size"
                      },
                      "x"
                    ]
                  },
                  1
                ]
              }
            }
          },
          {
            "name": "pixels",
            "value": {
              "$multiply": [
                {
                  "$ref": "vars.width"
                },
                {
                  "$ref": "vars.height"
                }
              ]
            }
          }
        ]
      }
    ]
  }
}
```
<!-- BEEFTV_PLUGIN_MANIFEST_END -->
