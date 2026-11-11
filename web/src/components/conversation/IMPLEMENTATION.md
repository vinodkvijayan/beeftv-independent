# Implementation of real-time dialogue function (first phase MVP)

## Project Overview

Implementation of the first phase (MVP): **Local voice recording + browser voice recognition and transliteration**. Click the "Real-time Chat" button → Expand the waveform recording bar in the input line → Automatically convert it into text after stopping → Fill the text into the input box or send it directly.

The first stage** does not connect to the large speech model, does not rely on the backend and API Key**, and the transcription is completed by the browser's built-in Web Speech API, which is available with zero configuration.

---

## Interaction process

1. Click the "Live Chat" button (`VoiceRecordingButton`)
2. Expand the `VoiceRecordingInline` recording bar in the input line (no pop-up window) and start recording automatically.
3. Display waveform animation (AnalyserNode real-time volume) + duration
4. Click Stop → to stop recording and trigger browser speech recognition
5. Recognition is successful → "Transcription completed" is briefly displayed → callback text, the caller fills in the input box or sends it directly
6. Recognition failure (no voice/permission denied/network abnormality) → prompt in the recording bar and support retry

---

## Technical architecture

```
用户点击"实时对话"按钮
        │
        ▼
VoiceRecordingButton（输入行内展开录制条，不弹窗）
        │
        ▼
VoiceRecordingInline 内联波形录制条
        ├── useVoiceRecording：MediaRecorder 录制 + AnalyserNode 实时波形
        ├── AudioWaveform：SVG 波形动画 + 时长显示
        └── useSpeechRecognition：Web Speech API 实时转写
                │
                ▼
点击停止 → speech.stop() 返回文本 → onTranscribed(文本) → 填入输入框
```

## Front-end implementation

### Components

| Documentation | Description |
|------|------|
| `components/conversation/voice-recording-button.tsx` | Voice input button: Click to expand the recording bar in the input line (partial state, no pop-up window) |
| `components/conversation/voice-recording-inline.tsx` | Inline waveform recording strip: waveform + duration + stop/cancel, automatically transcribed after stopping |
| `components/conversation/audio-waveform.tsx` | SVG waveform visualization component |
| `components/conversation/index.ts` | Unified export of components |

### Hook

| Documentation | Description |
|------|------|
| `hooks/use-voice-recording.ts` | Voice recording logic (MediaRecorder + AnalyserNode, waveform/duration/stop/cancel) |
| `hooks/use-speech-recognition.ts` | Browser speech recognition (Web Speech API, start/stop/cancel, return text and error) |

## Access location

- Create page main input row: `web/src/pages/create/index.tsx` (`CreationComposer` of `creation-chat-controls`)
- Canvas: The old built-in Agent dock panel has been retired, and the canvas side is no longer accessible for voice input.
- Test page: `web/src/pages/test-voice-recording.tsx` (routing `/test-voice-recording`)

## Usage example

```tsx
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";

<VoiceRecordingButton
  disabled={isBusy}
  onTranscribed={(text) => setPrompt((prev) => (prev.trim() ? `${prev} ${text}` : text))}
/>
```

## Browser support

- Speech recognition uses Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`), Chrome/Edge support
- When it is not supported, the recording bar will prompt "The current browser does not support speech recognition, please use Chrome or Edge browser" and can be cancelled.
- The default recognition language is `zh-CN`, which can be adjusted through `useSpeechRecognition({ lang })`

## Deleted content

The following second phase experiment code has been removed:

### Front-end

- `components/conversation/realtime-conversation.tsx`, `realtime-conversation-button.tsx`, `voice-recording-overlay.tsx`
- `hooks/use-websocket.ts`, `stores/conversation-mode-store.ts`
- `services/api/stt.ts` (backend Whisper transcoding client)

### Backend

- `service/stt.go` (OpenAI Whisper transcription), `model/stt.go` (`stt_results` table)
- Router registration in `handler/routes.go`, `RegisterSTTRoutes`, `main.go`
- `database/schema.go` in `STTResult` model registration, `repository/repository.go` in `CreateSTTResult`

## Verification situation

- Backend `go build ./...`: Passed
- Front-end `npx tsc --noEmit`: No new type errors this time (except for upstream legacy style profile / image.ts errors)
- Browser manual test (real microphone + speech recognition) is not running and needs to be verified under Chrome/Edge

## Next step

- [x] Inline waveform recording + browser speech recognition auto-transcription (Phase 1 MVP)
- [x] Removed second phase experimental code (WebSocket/WebRTC/Realtime API)
- [ ] Voice playback function (TTS)
- [ ] Voice message sending and display
- [ ] True real-time conversation (WebSocket + WebRTC + Realtime API, subsequent stages)