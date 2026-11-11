# MiniMax Hailuo Video V2 / H3 protocol plug-in

This package contributes a declarative provider compatible with the old channel ID `minimax-video`. Canvas, creation page, and skit production only submit unified `GenerationRequest`; the plug-in converts images, videos, and audio to MiniMax `content[]` according to explicit roles.

This plug-in is maintained by BeefTV Contributors and is used to adapt to MiniMax-related service interfaces; it does not mean that BeefTV has an affiliation, authorization or cooperative relationship with the service provider.

Key fixes:

- `resolution` directly from unified resolution, no more missing.
- Scale writes `ratio` actually used by upstream; first and last frame mode forces `adaptive`.
- `watermark` maps to `aigc_watermark`.
- `generateAudio` maps to `generate_audio`.
- The prompt is only placed in the text block, and the top-level prompt is no longer sent at the same time.
- The first frame, last frame and reference image are converted according to role, not guessed according to `0/1`.

See [docs/interface.md](docs/interface.md) for the complete fields.