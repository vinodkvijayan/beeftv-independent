# BeefTV Depth Capture CLI

Convert ordinary RGB video into near white and far black, time-continuous relative depth reference video. The first version uses the Apache-2.0 licensed Video Depth Anything Small model.

## Run

```bash
cd tools/depth-capture
uv sync
PYTORCH_ENABLE_MPS_FALLBACK=1 uv run python -m depth_capture \
  "/path/to/input.mp4" \
  --output-dir ../../artifacts/depth-capture \
  --save-raw
```

The model code and weights are persisted in `tools/depth-capture/.cache/runtime` in the project directory by default and will not be lost due to `/tmp` cleanup. Other persistence directories can also be specified via `BEEFTV_DEPTH_RUNTIME`. The download will first be written into a temporary file and verified, and unfinished files will not be used as models. Apple Silicon recommends `--input-size 280 --max-resolution 960` by default; CUDA environments can increase this to `--input-size 518 --max-resolution 1280`.

## Output

- `*_depth_preview.mp4`: 8-bit H.264 grayscale preview, default 1920×1080.
- `*_depth_raw.npz`: Optional float32 raw relative depth.