# Real-time conversation function component (first phase MVP)
This directory implements the first phase (MVP): **Local voice recording + browser voice recognition and transliteration**. Click the "Real-time Chat" button → Expand the waveform recording bar in the input line → Automatically convert it into text after stopping → Fill the text into the input box or send it directly.

## Zero configuration instructions

The first stage** does not connect to the large speech model, does not rely on the backend and API Key**: after the recording is completed, the browser's built-in Web Speech API (`SpeechRecognition`) is used for recognition, and the entire transcription process is completed on the front end.

- Supported browsers: Chrome/Edge (Chromium core)
- If it is not supported, there will be a clear prompt in the recording bar and it can be canceled.
- The default recognition language is `zh-CN`, see the `lang` parameter of `useSpeechRecognition`

---

## Component list

### 1. `VoiceRecordingButton` - Voice input button

After clicking, the waveform recording bar will expand in the input line (no pop-up window), and the recording will automatically start; after stopping, the text will be automatically transcribed and recalled. Using local state, multiple input rows can be used independently.

**Usage example:**```tsx
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";

<VoiceRecordingButton
  disabled={isBusy}
  onTranscribed={(text) => setPrompt((prev) => (prev.trim() ? `${prev} ${text}` : text))}
/>
```

### 2. `VoiceRecordingInline` - Inline waveform recording strip

The recording controls displayed in the input line: waveform animation + duration + stop/cancel button; automatically transcribed after stopping. If failed, you can try again. `VoiceRecordingButton` uses this component by default.

**Usage example:**```tsx
import { VoiceRecordingInline } from "@/components/conversation/voice-recording-inline";

<VoiceRecordingInline
  onTranscribed={(text) => setPrompt((prev) => (prev.trim() ? `${prev} ${text}` : text))}
  onCancel={() => setOpen(false)}
/>
```

### 3. `AudioWaveform` - Audio waveform visualization

SVG waveform visualization component supports real-time data updates.

---

## Hook

### `useVoiceRecording` - Voice Recording Hook

Encapsulates the MediaRecorder API and AnalyserNode, providing recording status, waveform data, and control methods (for waveform animation and duration display).

### `useSpeechRecognition` - Browser Speech Recognition Hook

Encapsulates the Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`), provides `start()` / `stop(): Promise<string>` / `cancel()`, and returns whether it is supported and recognizes errors. Transcription does not depend on the backend.

---

## Complete integration example

```tsx
import { useState } from "react";
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";

function ChatInput() {
  const [prompt, setPrompt] = useState("");

  const handleTranscribed = (text: string) => {
    // 转写结果填入输入框，用户确认后发送
    setPrompt((current) => (current.trim() ? `${current} ${text}` : text));
  };

  return (
    <div className="flex items-center gap-2">
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="输入消息..." />
      {/* 点击后输入行内展开波形录制条，停止后自动转写 */}
      <VoiceRecordingButton onTranscribed={handleTranscribed} />
      <button>发送</button>
    </div>
  );
}
```

## Access location

- Create page main input row: `web/src/pages/create/index.tsx` (`CreationComposer` of `creation-chat-controls`)
- Canvas: The old built-in Agent dock panel has been retired, and the canvas side is no longer accessible for voice input.
- Test page: `web/src/pages/test-voice-recording.tsx`

## Next step
- [x] Inline waveform recording (no pop-up window), automatically transcribed after stopping
- [x] Remove the second phase experimental code (WebSocket / Realtime API / old floating layer components)
- [x] Remove the back-end STT interface and database table (the large voice model will not be connected in the first stage)
- [ ] Voice playback function (TTS)
- [ ] Voice message sending and display
- [ ] Multimodal dialogue (pictures, videos)
- [ ] True real-time conversation (WebSocket + WebRTC + Realtime API, subsequent stages)