# Asynchronous audio task compatible protocol

This plugin defines a simplified OpenAI-style asynchronous audio contract: JSON creates a task, polls the task resource, and reads the media URL on success. It is not the official OpenAI Speech API, nor does it represent a fixed vendor.

## Interface and authentication

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/audio/tasks
GET  {channel_base_url}/v1/audio/tasks/{task_id}
Authorization: Bearer <CHANNEL_API_KEY>
Content-Type: application/json
```

## Models, Sounds and Billing

Model IDs, task types, sounds, languages, formats, duration limits, patch cloning permissions, and billing are entirely determined by the channel implementing this compatible interface. Plugins do not have a vendor whitelist; administrators must check with the deployment's interface documentation.

## Parameter and field mapping

{{PARAMETERS}}

The current creation body only contains:

```json
{"model":"YOUR_ASYNC_AUDIO_MODEL","prompt":"低沉克制的男声旁白：风暴即将到来。"}
```

There is no mapping of `voice`, `format`, `speed`, reference audio, lyrics or musical structure. If the model depends on these fields, the current plugin is not applicable.

## Creation, polling and results

```bash
curl "{channel_base_url}/v1/audio/tasks" \
  -H "Authorization: Bearer <CHANNEL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"YOUR_ASYNC_AUDIO_MODEL","prompt":"雨声环境音，逐渐增强"}'
```

The creation response needs to contain the task ID, which is used by the query path. The polling parser extracts `audios`, `audio_url`, `audioUrl`, `result_url` or `url` by audio type without accidentally writing the audio into the video result. If the deployment returns other deep structures, the channel fixture must be added and mapped explicitly.

## Bugs and Security

Tasks that do not exist, models that are not supported, inputs that are too long, voice authorization, or content moderation failures should be returned unchanged. Authorization must be confirmed when real-person voice cloning is involved; reference audio and generated links must not be written to public logs. The resulting URL should be dumped as soon as possible.

## Official information and boundaries

- This page uses the host's current adapter as the only field source of fact.
- The channel deployer must provide real models, sounds, error codes and billing documents; without these materials, capabilities cannot be promised to users.

{{CONTRACT}}
