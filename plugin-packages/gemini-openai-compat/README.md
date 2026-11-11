# Gemini (OpenAI compatible)

This directory is the BeefTV declarative protocol plug-in source code. The backend is loaded from the generated `gemini-openai-compat.beeftv-plugin` package and does not rely on the system's built-in `host:` adapter.

Google Gemini provides both native `generateContent` interface and OpenAI compatible interface. This plug-in only adapts to the latter: the request path is `/v1beta/openai/chat/completions`, and the authentication uses `Authorization: Bearer`. Gemini native interface uses a separate plug-in.

This plug-in is maintained by BeefTV Contributors and is used to adapt to Google Gemini related service interfaces; it does not mean that BeefTV has an affiliation, authorization or cooperative relationship with the service provider.

## How to fill in the service address?

Just fill in `https://generativelanguage.googleapis.com`. Filling in `/v1beta` or `/v1beta/openai` will also spell out the same address and will not be repeated.

If the model list cannot be read, manually fill in the model ID in the model list.

See [docs/interface.md](docs/interface.md) for the complete interface.