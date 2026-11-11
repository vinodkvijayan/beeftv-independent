# OpenAI Audio Speech

The plug-in calls the OpenAI style synchronous text-to-speech interface and maps the host prompt word to `input`. Currently only models and text are sent, sound, format, speech rate and other TTS options have not yet been incorporated into the adapter.

## Interface and authentication

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/audio/speech
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

## Models, sounds and output formats

Model, voice, format, single text length, streaming capabilities and price are subject to actual documentation from OpenAI or compatible channels. The current host metadata does not declare a parameter table, which means that only the internal mapping of `model` and `prompt` is stable. It does not mean that `voice` is not required in the upstream. If the upstream requires voice, the administrator must first expand the adapter and cannot rely on automatic transparent transmission of fields that are not whitelisted.

## Parameter and field mapping

{{PARAMETERS}}

The actual request body is fixed to:

```json
{"model":"YOUR_TTS_MODEL","input":"请在午夜前离开这座城市。"}
```

Complete upstream common request reference:

```bash
curl "{channel_base_url}/v1/audio/speech" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"YOUR_TTS_MODEL","voice":"YOUR_VOICE","input":"请在午夜前离开这座城市。","response_format":"mp3"}' \
  --output speech.mp3
```

The second example contains `voice` and `response_format` that have not yet been sent by the current adapter to illustrate the protocol fields that must be completed.

## Response to differences from current implementation

The official OpenAI Speech API usually returns the audio binary stream directly; currently `parseAudioResponse` is parsed as `url/audio_url/data` in JSON. Therefore this plugin is currently more suitable for the "return audio URL JSON" compatible channel and cannot claim to have correctly processed the official OpenAI binary response. Binary response contract, MIME/file name processing and resource saving tests must be added before directly connecting to official services.

## Official information

- [OpenAI Text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)
- [OpenAI Audio Speech reference](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)

{{CONTRACT}}
