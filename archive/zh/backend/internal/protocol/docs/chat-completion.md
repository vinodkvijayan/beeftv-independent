# OpenAI Chat Completions

Chat Completions is a synchronous or streaming text protocol based on `messages`. By default, the host packages the prompt word into a `user` message; when multiple rounds of context, tool calls, or structured output are required, the complete OpenAI field is passed in through the model extension parameters.

## Interface, authentication and request mode

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/chat/completions
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

The Base URL of the official service usually ends with `/v1`; the actual configuration of the channel in the host should prevail. Synchronous requests return a single JSON; for `stream: true` the upstream returns SSE, and the host text task flow is responsible for forwarding and assembling events.

## Model and compatibility boundaries

The model name will not be whitelisted by the plug-in, and the model ID actually exposed by the channel must be filled in. New OpenAI projects recommend the Responses API; existing Chat Completions models and compatible channels can still use this plug-in. Compatible channels may only implement a subset of fields, and support for tools, visual input, or JSON Schema cannot be assumed just because the paths are the same.

## Parameter and field mapping

{{PARAMETERS}}

`messages`, `temperature`, `top_p`, `max_tokens`, `stream`, `tools` and `response_format` can be transparently transmitted through `extra`. Passing in `extra.messages` will replace the default single message instead of appending it.

## Complete request example

```bash
curl "{channel_base_url}/v1/chat/completions" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "YOUR_MODEL",
    "messages": [
      {"role":"system","content":"你是影视分镜助理。"},
      {"role":"user","content":"把这场雨夜追逐拆成 6 个镜头。"}
    ],
    "temperature": 0.7
  }'
```

```json
{
  "id": "chatcmpl_xxx",
  "choices": [{"message":{"role":"assistant","content":"1. 全景……"},"finish_reason":"stop"}],
  "usage": {"prompt_tokens":32,"completion_tokens":95,"total_tokens":127}
}
```

## Response parsing, streaming and errors

Synchronous parsing reads only `choices[0].message.content` and retains the top level `usage`. The current parser does not treat `tool_calls` as a text result; when there is only a tool call without text, the caller should enter the tool turn and cannot be treated as ordinary text. Streaming fragmentation, end markers, and resuming are handled by the text task SSE link and are not hard-coded using this synchronous JSON parser.

Common failures include model not existing, context limit exceeded, fields not supported by compatible services, quota or rate limits. The upstream HTTP status and error text should be preserved and not overwritten as success.

## Official information

- [OpenAI Chat Completions API Reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [OpenAI Text generation guide](https://developers.openai.com/api/docs/guides/text)

{{CONTRACT}}
