import { describe, expect, test } from "bun:test";
import { buildApiUrl, joinChannelUrl } from "../src/lib/channel-url";

// 期望值取自 backend/internal/channelurl 的 Join(base, path, "/v1")：
// 浏览器直连渠道和后台生成任务必须拼出同一个地址。
const parityCases: Array<[base: string, path: string, expected: string]> = [
    ["https://host", "/v1/chat/completions", "https://host/v1/chat/completions"],
    ["https://host/api/v1", "/v1/chat/completions", "https://host/v1/chat/completions"],
    ["https://host/api/v3", "/api/v3/images/generations", "https://host/api/v3/images/generations"],
    ["https://api.openai.com", "/v1/chat/completions", "https://api.openai.com/v1/chat/completions"],
    ["https://api.openai.com/v1", "/v1/models", "https://api.openai.com/v1/models"],
    ["https://host/v1", "/models", "https://host/v1/models"],
    ["https://host/api/v1", "/api/v3/chat/completions", "https://host/api/v3/chat/completions"],
    ["https://host/v1beta", "/v1beta/models/x:generateContent", "https://host/v1beta/models/x:generateContent"],
    ["https://host/api/plan/v3", "/api/plan/v3/chat/completions", "https://host/api/plan/v3/chat/completions"],
    ["https://host/v1/query/foo", "/v1/query/foo", "https://host/v1/query/foo"],
    ["https://host/openai/v1", "/v1/images/generations", "https://host/openai/v1/images/generations"],
];

describe("joinChannelUrl is consistent with the backend channelurl.Join", () => {
    for (const [base, path, expected] of parityCases) {
        test(`${base} + ${path}`, () => {
            expect(joinChannelUrl(base, path, "/v1")).toBe(expected);
        });
    }
});

describe("buildApiUrl", () => {
    test("System agent channels directly create relative paths", () => {
        expect(buildApiUrl("/api/ai/system/channel-1", "/models")).toBe("/api/ai/system/channel-1/models");
    });

    test("Ordinary channels follow the same set of version prefix rules", () => {
        expect(buildApiUrl("https://host/api/v1/", "/v1/chat/completions")).toBe("https://host/v1/chat/completions");
    });
});
