# OpenAI Responses API

Responses API is OpenAI's current unified text and tool calling interface. The input uses `input`, which can carry simple strings, structured messages and tool rounds at the same time. The host sends the string prompt word by default and extracts the text from the `output_text` or `output[]` of the synchronous response.

## Interface, authentication and request mode

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/responses
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

## Model and capability discovery

The plugin does not hardcode model tables. Please use a model ID from Channel Model Management that has been verified to support the Responses API. Even if a compatible service implements `/v1/responses`, it may not support built-in tools, state continuation, structured output, or multimodal input. Capabilities must be based on the service documentation and actual detection.

## Parameter and field mapping

{{PARAMETERS}}

`extra` can transparently transmit `input`, `instructions`, `temperature`, `top_p`, `max_output_tokens`, `stream`, `tools` and `text`. `extra.input` will replace the default string; complex input must use the item structure specified by the upstream, and `messages` of Chat Completions should not be inserted as it is.

## Request example

```bash
curl "{channel_base_url}/v1/responses" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "YOUR_MODEL",
    "instructions": "输出可直接拍摄的镜头清单。",
    "input": "一名女孩在停电的商场里寻找出口。",
    "max_output_tokens": 1200
  }'
```

```json
{
  "id": "resp_xxx",
  "status": "completed",
  "output_text": "镜头 1……",
  "usage": {"input_tokens":28,"output_tokens":174,"total_tokens":202}
}
```

## Structured input example

```json
{
  "model": "YOUR_MODEL",
  "input": [{
    "role": "user",
    "content": [{"type":"input_text","text":"分析这段剧情的节奏问题"}]
  }]
}
```

## Response parsing and restrictions

The parser reads the top-level `output_text` first; if it is missing, it traverses `output`, tries to read the `text` or `content` of the item, and retains `usage`. The current implementation does not fully execute function call, computer use, file search and other output items, nor does it automatically continue the status through `previous_response_id`. When these capabilities are needed, they must be explicitly implemented in the Agent call chain and cannot just rely on documentation claims to support them.

Streaming responses are handled by text event links. Upstream rejection, model unsupported, input structure error, output token exceeding the limit and tool parameter verification failure should all be returned as failures.

## Official information

- [OpenAI Responses API Reference](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [OpenAI Responses migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses)

{{CONTRACT}}
