# Claude Messages API

Claude Messages uses stateless `messages` requests to generate content. By default, the host creates a `user` message, sets `max_tokens: 4096`, and automatically adds `anthropic-version: 2023-06-01`. The system prompts to use the top-level `system` and cannot disguise it as `system` role message.

## Interface, authentication and version header

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/messages
x-api-key: <API_KEY>
anthropic-version: 2023-06-01
Content-Type: application/json
```

The host's general channel transfer may also be connected to a compatible gateway in Bearer mode; when directly connected to Anthropic, the channel must be configured according to the official `x-api-key` rules. Version headers are permanently added by the adapter, and the current plugin will not automatically guess when Beta capabilities require additional headers.

## Model and compatibility boundaries

The model ID must use an Anthropic model name that is actually available in the account and region. The authentication, path, and model name of the native APIs of AWS Bedrock, Google Vertex AI, and Anthropic are different. The native Messages plug-in cannot be used directly as a cloud vendor protocol unless the intermediate gateway has completed protocol conversion.

## Parameter and field mapping

{{PARAMETERS}}

`extra` can transparently transmit `max_tokens`, `system`, `messages`, `temperature`, `top_p`, `top_k`, `tools`, `tool_choice` and `stream`. `extra.messages` replaces the default message array. `max_tokens` is a required upstream field, the host sends 4096 when not covered.

## Request example

```bash
curl "{channel_base_url}/v1/messages" \
  -H "x-api-key: <API_KEY>" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "YOUR_CLAUDE_MODEL",
    "max_tokens": 1200,
    "system": "你是影视剧本顾问。",
    "messages": [{"role":"user","content":"指出这一场戏的冲突升级点。"}]
  }'
```

```json
{
  "id":"msg_xxx",
  "type":"message",
  "role":"assistant",
  "content":[{"type":"text","text":"冲突分为三个阶段……"}],
  "stop_reason":"end_turn",
  "usage":{"input_tokens":31,"output_tokens":148}
}
```

## Multiple content blocks, tools and streaming

The response parsing traverses `content[]` and only splices the blocks of `type: text`. Non-text blocks such as `tool_use`, thinking, and quotations will not be mistaken for text, but the current unified text results will not save these blocks; when tool loops or complete block semantics are required, the dedicated Agent execution layer should be used. `stream: true`'s event stream is handled by the text task link, and the synchronous parser only receives full JSON.

Common errors include missing version headers, unauthorized model IDs, illegal alternating role structures, missing `max_tokens`, or context overruns. Compatible gateways may accept Bearer but not `x-api-key`. This needs to be confirmed at the channel level and does not double-issue the key in the plug-in.

## Official information

- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages)
- [Anthropic Messages examples](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)

{{CONTRACT}}
