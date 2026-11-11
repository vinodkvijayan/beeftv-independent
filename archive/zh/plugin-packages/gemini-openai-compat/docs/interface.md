# Gemini (OpenAI compatible) interface fields

## Protocol Identity

- Plugin ID: `gemini-openai-compat`.
- Provider ID: `gemini-openai-compat`.
- Service provider default: Google Gemini (`https://generativelanguage.googleapis.com`).
- Abilities: `text`.
-Default Base URL: `https://generativelanguage.googleapis.com`.
- Authentication driver: `bearer`.
- Create: `POST /v1beta/openai/chat/completions`.
- Agent: `POST /v1beta/openai/chat/completions`.
- Life cycle: synchronous response.

## Configuration fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `apiKey` | secret | Yes | Gemini API Key |

## Unified field mapping

| Uniform Fields | Type | Required | Upstream Mapping | Description |
| --- | --- | --- | --- | --- |
| `model` | string | Yes | `model` | Upstream model ID. |
| `messages` | message[] | Yes | `provider message container` | Contains historical messages and current user input. |
| `instructions` | string | No | `system/instructions` | System command. |
| `temperature` | number | No | `temperature` | Sampling temperature. |
| `top_p` | number | No | `top_p` | Kernel sampling parameters. |
| `max_tokens` | integer | No | `max_tokens` | Maximum output token. |
| `tools` | array | No | `tools` | Tool definition. |
| `tool_choice` | object|string | No | `tool_choice` | Tool selection strategy. |
| `response_format` | object | No | `response_format` | Structured output configuration. |
| `stream` | boolean | No | `stream` | Streaming switch; background tasks are currently normalized to the final response. |

## Responses and Errors

The plug-in maps the upstream `choices`, `usage` and `error` to a unified result. HTTP errors, business code and error objects maintain failure semantics and are not packaged as success.

## Compatibility boundary

This package represents only Google Gemini's OpenAI-compatible interface. Wrapping of Gemini native interfaces, Vertex AI, and other cloud areas must use independent plug-ins and cannot be guessed based on model names.

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest complete interface definition

The following JSON is consistent field by field with the actual `manifest.json` in the plug-in package, covering plug-in identity, permissions, configuration, authentication, parameters, verification, creation, Agent, query, cancellation, result download, response and Agent response mapping. The value of the `documentation` field is the current complete document; in order to avoid infinite recursion of the document within itself, only equivalent placeholder text is used to represent the main text in JSON.

```json
{
  "apiVersion": "beeftv.plugin/v3",
  "id": "gemini-openai-compat",
  "name": "Gemini（OpenAI 兼容）",
  "version": "1.0.0",
  "author": "BeefTV Contributors",
  "description": "Google Gemini 的 OpenAI 兼容接口独立请求协议插件。",
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
        "id": "gemini-openai-compat",
        "label": "Gemini（OpenAI 兼容）",
        "presets": [
          {
            "id": "gemini",
            "label": "Google Gemini",
            "baseUrl": "https://generativelanguage.googleapis.com"
          }
        ],
        "capabilities": [
          "text"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://generativelanguage.googleapis.com",
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
            "description": "上游模型 ID。"
          },
          {
            "name": "messages",
            "type": "message[]",
            "required": true,
            "mapping": "provider message container",
            "description": "包含历史消息和当前用户输入。"
          },
          {
            "name": "instructions",
            "type": "string",
            "required": false,
            "mapping": "system/instructions",
            "description": "系统指令。"
          },
          {
            "name": "temperature",
            "type": "number",
            "required": false,
            "mapping": "temperature",
            "description": "采样温度。"
          },
          {
            "name": "top_p",
            "type": "number",
            "required": false,
            "mapping": "top_p",
            "description": "核采样参数。"
          },
          {
            "name": "max_tokens",
            "type": "integer",
            "required": false,
            "mapping": "max_tokens/max_output_tokens",
            "description": "最大输出 token。"
          },
          {
            "name": "tools",
            "type": "array",
            "required": false,
            "mapping": "tools/toolConfig",
            "description": "工具定义。"
          },
          {
            "name": "tool_choice",
            "type": "object|string",
            "required": false,
            "mapping": "tool_choice",
            "description": "工具选择策略。"
          },
          {
            "name": "response_format",
            "type": "object",
            "required": false,
            "mapping": "response_format/text",
            "description": "结构化输出配置。"
          },
          {
            "name": "stream",
            "type": "boolean",
            "required": false,
            "mapping": "stream",
            "description": "流式开关；后台任务当前以最终响应归一。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/openai/chat/completions",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "messages": {
              "$ref": "request.messages"
            },
            "temperature": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.temperature"
              }
            },
            "top_p": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.top_p"
              }
            },
            "max_tokens": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.extra.max_tokens"
                  },
                  {
                    "$ref": "request.providerOptions.gemini-openai-compat.max_tokens"
                  }
                ]
              }
            },
            "tools": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.tools"
              }
            },
            "tool_choice": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.tool_choice"
              }
            },
            "response_format": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.response_format"
              }
            },
            "stream": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.stream"
              }
            },
            "stop": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.stop"
              }
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.seed"
              }
            },
            "frequency_penalty": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.frequency_penalty"
              }
            },
            "presence_penalty": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.presence_penalty"
              }
            },
            "logprobs": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.logprobs"
              }
            },
            "top_logprobs": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.top_logprobs"
              }
            },
            "user": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.user"
              }
            },
            "provider": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.provider"
              }
            },
            "transforms": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.transforms"
              }
            },
            "extra_body": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-openai-compat.extra_body"
              }
            }
          },
          "defaultPathPrefix": "/v1beta"
        },
        "agent": {
          "method": "POST",
          "path": "/openai/chat/completions",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "$ref": "request.extra.agent.chatCompletion"
              },
              {
                "model": {
                  "$ref": "request.model"
                }
              }
            ]
          },
          "defaultPathPrefix": "/v1beta"
        },
        "response": {
          "status": "succeeded",
          "textPaths": [
            "choices.0.message.content",
            "choices.0.text"
          ],
          "reasoningPaths": [
            "choices.0.message.reasoning_content"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error.code"
          ],
          "messagePaths": [
            "error.message"
          ]
        },
        "agentResponse": {
          "textPaths": [
            "choices.0.message.content",
            "choices.0.text"
          ],
          "reasoningPaths": [
            "choices.0.message.reasoning_content"
          ],
          "toolCallsPath": "choices.0.message.tool_calls",
          "toolCallIdPaths": [
            "id"
          ],
          "toolCallNamePaths": [
            "function.name"
          ],
          "toolCallArgumentsPaths": [
            "function.arguments"
          ]
        }
      }
    ]
  }
}
```
<!-- BEEFTV_PLUGIN_MANIFEST_END -->
