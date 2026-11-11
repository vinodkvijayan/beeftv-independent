import type { CreationConversation } from "./creation-types";

/** 固定的演示会话：只用于展示 Agent 对话流，不会写入本地会话或调用生成接口。 */
export function createDemoConversation(): CreationConversation {
    const base = "2026-09-19T10:00:00.000Z";
    return {
        id: "demo-conversation",
        title: "Simulate the video creation process",
        updatedAt: base,
        messages: [
            {
                id: "demo-user-plan",
                role: "user",
                content: "I want to make a 6-second cinematic video: the streets of Hong Kong at night, the camera slowly advances, and the neon lights are reflected in the rain.",
                createdAt: base,
                mode: "text",
                status: "done",
            },
            {
                id: "demo-assistant-plan",
                role: "assistant",
                content: "I would start by breaking down the idea into an executable shot: a street scene on a rainy night to establish the atmosphere, the camera slowly moving forward, and finally settling on a neon reflection. Next, you can directly generate the video.",
                createdAt: "2026-09-19T10:00:05.000Z",
                mode: "text",
                status: "done",
            },
            {
                id: "demo-user-generate",
                role: "user",
                content: "According to this plan, a video is generated with a frame size of 16:9 and a duration of 6 seconds.",
                createdAt: "2026-09-19T10:00:12.000Z",
                mode: "video",
                status: "done",
                settings: { ratio: "16:9", seconds: "6", quality: "auto", videoQuality: "720", count: "1" },
            },
            {
                id: "demo-assistant-generating",
                role: "assistant",
                content: "",
                createdAt: "2026-09-19T10:00:14.000Z",
                mode: "video",
                status: "pending",
                generationStage: "rendering",
                settings: { ratio: "16:9", seconds: "6", quality: "auto", videoQuality: "720", count: "1" },
            },
        ],
    };
}
