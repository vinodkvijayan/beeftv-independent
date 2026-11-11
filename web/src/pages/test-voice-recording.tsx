import { useState } from "react";
import { Button, Card, message } from "antd";
import { Mic, Send } from "lucide-react";

import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

/**
 * 语音录制功能测试页面
 * 验证输入行内联波形录制和 STT 转写闭环
 */
export default function TestVoiceRecording() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [prompt, setPrompt] = useState("");
    const [sending, setSending] = useState(false);

    const handleTranscribed = (text: string) => {
        // 转写结果填入输入框，供用户确认或直接发送
        setPrompt((current) => (current.trim() ? `${current} ${text}` : text));
        message.success("Speech has been transcribed into text");
    };

    const handleSubmit = async () => {
        if (!prompt.trim()) return;
        setSending(true);
        try {
            // 原型阶段：发送到对话入口由调用方接入；此处仅输出
            console.log("Send text:", prompt);
            message.success("Sent successfully (prototype stage, console output only)");
            setPrompt("");
        } finally {
            setSending(false);
        }
    };


    return (
        <div className="min-h-screen p-8" style={{ background: theme.spatial.surface }}>
            <div className="mx-auto max-w-2xl">
                <Card
                    title={
                        <div className="flex items-center gap-2">
                            <Mic className="size-5" style={{ color: theme.accent.primary }} />
                            <span>Real-time conversation function testing (MVP)</span>
                        </div>
                    }
                    style={{ background: theme.spatial.elevated, borderColor: theme.toolbar.border }}
                >
                    <div className="space-y-4">
                        {/* 文本输入 */}
                        <div>
                            <label className="mb-2 block text-sm font-medium" style={{ color: theme.node.text }}>
                                                                Text input (speech transcription results will be filled in automatically)
                            </label>
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="Type a message, or tap the live chat button to type with your voice..."
                                className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition focus:border-current"
                                style={{
                                    background: theme.node.fill,
                                    borderColor: theme.toolbar.border,
                                    color: theme.node.text,
                                    minHeight: 80,
                                }}
                            />
                        </div>

                        {/* 音频预览 */}

                        {/* 控制栏：实时对话按钮（点击后在输入行展开波形录制条） */}
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-1 items-center gap-2">
                                <VoiceRecordingButton onTranscribed={handleTranscribed} />
                            </div>
                            <Button
                                type="primary"
                                icon={<Send className="size-4" />}
                                disabled={!prompt.trim()}
                                loading={sending}
                                onClick={handleSubmit}
                                style={{ background: theme.accent.primary, borderColor: theme.accent.primary, color: theme.accent.onPrimary }}
                            >
                                                                send
                            </Button>
                        </div>

                        {/* 说明 */}
                        <div className="rounded-lg border p-3 text-xs" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.muted }}>
                            <div className="font-semibold" style={{ color: theme.node.text }}>
                                                                Instructions for use:</div>
                            <ul className="mt-1 list-inside list-disc space-y-1">
                                <li>Click the microphone button, expand the waveform recording bar in the input line and start recording automatically</li>
                                <li>Waveform animation displays volume changes in real time</li>
                                <li>Click the stop button to complete the recording, automatically upload and transcribe</li>
                                <li>The transcription results are automatically filled in the input box and can be edited before sending.</li>
                                <li>When the transcription fails, a prompt will appear in the recording bar. You can click on the microphone to try again.</li>
                            </ul>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}
