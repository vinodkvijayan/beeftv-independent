import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { appTargets, workflowTargets } from "../../plugin-packages/beeftv-plugin-runninghub/lib/targets.mjs";
import * as provider from "../../plugin-packages/beeftv-plugin-runninghub/provider.mjs";

const textToImage = {
    "3": { class_type: "KSampler", inputs: { seed: 42, positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "Default forward", clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "Default reverse", clip: ["4", 1] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0] } },
    "10": { class_type: "LoadImage", inputs: { image: "a.png" } },
    "11": { class_type: "LoadImage", inputs: { image: "b.png" } },
    "12": { class_type: "KSampler", inputs: { seed: ["13", 0], positive: ["6", 0] } },
};

const appFields = [
    { nodeId: "1", fieldName: "text", fieldValue: "Default", fieldType: "STRING", description: "prompt word" },
    { nodeId: "2", fieldName: "image", fieldValue: "a.png", fieldType: "IMAGE" },
    { nodeId: "3", fieldName: "ratio", fieldValue: "1:1", fieldType: "LIST" },
];

describe("finding where to fill", () => {
    test("workflow: the prompt goes to the positive node, connected inputs stay untouched", () => {
        const targets = workflowTargets(textToImage);
        expect(targets.prompt).toEqual({ nodeId: "6", fieldName: "text" });
        expect(targets.media.image.map((slot) => slot.nodeId)).toEqual(["10", "11"]);
        expect(targets.seeds).toEqual([{ nodeId: "3", fieldName: "seed" }]);
    });

    test("workflow: something that is not a graph is refused", () => {
        expect(() => workflowTargets(null)).toThrow("Not in ComfyUI format");
        expect(() => workflowTargets({ note: "x" })).toThrow("There is no node that can be executed");
    });

    test("app: only public fields, by name first, the only text field otherwise", () => {
        const targets = appTargets(appFields);
        expect(targets.prompt).toEqual({ nodeId: "1", fieldName: "text" });
        expect(targets.media.image).toEqual([{ nodeId: "2", fieldName: "image" }]);
        expect(appTargets([{ nodeId: "1", fieldName: "value", fieldType: "STRING" }]).prompt).toEqual({ nodeId: "1", fieldName: "value" });
        expect(appTargets([{ nodeId: "1", fieldName: "a", fieldType: "STRING" }, { nodeId: "2", fieldName: "b", fieldType: "STRING" }]).prompt).toBeNull();
    });
});

describe("model ids", () => {
    test("a number is a workflow, app: and page links work too", () => {
        expect(provider.parseModel("185")).toEqual({ kind: "workflow", id: "185" });
        expect(provider.parseModel("app:193")).toEqual({ kind: "app", id: "193" });
        expect(provider.parseModel("https://www.runninghub.cn/ai-detail/193?from=x")).toEqual({ kind: "app", id: "193" });
        expect(provider.parseModel("https://www.runninghub.ai/workflow/185")).toEqual({ kind: "workflow", id: "185" });
        expect(() => provider.parseModel("gpt-image")).toThrow("Workflow number");
    });
});

test("reading models tells people what to type instead of an empty list", async () => {
    await expect(provider.models()).rejects.toThrow("Fill in the workflow number, and add app before the number for the AI application:");
});

describe("talking to RunningHub", () => {
    let server: ReturnType<typeof Bun.serve>;
    let calls: { path: string; method: string; auth: string | null; body: any; file?: string }[];
    let replies: Record<string, unknown>;
    const ctx = () => ({ config: { baseUrl: `http://127.0.0.1:${server.port}/openapi/v2/`, apiKey: "test-key" }, log: () => {} } as never);
    const pixel = { dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png" };

    beforeAll(() => {
        server = Bun.serve({
            port: 0,
            async fetch(request) {
                const url = new URL(request.url);
                const auth = request.headers.get("authorization");
                if (url.pathname === "/openapi/v2/media/upload/binary") {
                    const form = await request.formData();
                    const file = form.get("file") as File;
                    calls.push({ path: url.pathname, method: request.method, auth, body: null, file: file.name });
                    return Response.json({ code: 0, msg: "success", data: { fileName: `api/${file.name}`, download_url: "https://cdn.example/x.png" } });
                }
                const body = request.method === "POST" ? await request.json() : Object.fromEntries(url.searchParams);
                calls.push({ path: url.pathname, method: request.method, auth, body });
                const reply = replies[url.pathname];
                if (reply === "crash") return new Response("gateway", { status: 502 });
                if (reply === "unauthorized") return Response.json({ code: -1, msg: "ApiKey verification failed", data: null }, { status: 401 });
                return Response.json(reply ?? { code: 0, msg: "success", data: {} });
            },
        });
    });
    afterAll(() => server.stop(true));
    beforeEach(() => {
        calls = [];
        replies = {
            "/api/openapi/getJsonApiFormat": { code: 0, msg: "success", data: { prompt: JSON.stringify(textToImage) } },
            "/api/webapp/apiCallDemo": { code: 0, msg: "success", data: { webappName: "Demo", nodeInfoList: appFields } },
            "/task/openapi/create": { code: 0, msg: "success", data: { taskId: "1001", taskStatus: "QUEUED" } },
            "/task/openapi/ai-app/run": { code: 0, msg: "success", data: { taskId: "1002", taskStatus: "QUEUED" } },
        };
    });

    test("a workflow run uploads the reference, then sends string fields only", async () => {
        const state = await provider.submit({ model: "185", prompt: "a cat", images: [pixel], extra: { idempotencyKey: "abc" } } as never, ctx());
        expect(state).toEqual({ taskId: "1001", status: "pending" });
        expect(calls.map((call) => call.path)).toEqual(["/api/openapi/getJsonApiFormat", "/openapi/v2/media/upload/binary", "/task/openapi/create"]);
        const upload = calls[1];
        expect(upload.auth).toBe("Bearer test-key");
        expect(upload.file).toBe("abc-image-1.png");
        const created = calls[2].body;
        expect(created.apiKey).toBe("test-key");
        expect(created.workflowId).toBe("185");
        expect(created.nodeInfoList.slice(0, 2)).toEqual([
            { nodeId: "6", fieldName: "text", fieldValue: "a cat" },
            { nodeId: "10", fieldName: "image", fieldValue: "api/abc-image-1.png" },
        ]);
        const seed = created.nodeInfoList[2];
        expect(seed.nodeId).toBe("3");
        expect(typeof seed.fieldValue).toBe("string");
        expect(created.nodeInfoList.every((item: { fieldValue: unknown }) => typeof item.fieldValue === "string")).toBe(true);
    });

    test("an app run reads its fields with GET and goes through ai-app/run", async () => {
        const state = await provider.submit({ model: "app:193", prompt: "a cat", images: [pixel] } as never, ctx());
        expect(state).toEqual({ taskId: "1002", status: "pending" });
        expect(calls[0]).toMatchObject({ path: "/api/webapp/apiCallDemo", method: "GET", body: { webappId: "193", apiKey: "test-key" } });
        const run = calls[calls.length - 1];
        expect(run.path).toBe("/task/openapi/ai-app/run");
        expect(run.body.webappId).toBe("193");
        expect(run.body.workflowId).toBeUndefined();
        expect(run.body.nodeInfoList.map((item: { nodeId: string }) => item.nodeId)).toEqual(["1", "2"]);
    });

    test("too many references fail before anything is uploaded or queued", async () => {
        const state = await provider.submit({ model: "185", prompt: "x", images: [pixel, pixel, pixel] } as never, ctx());
        expect(state).toEqual({ status: "failed", message: "This model can receive up to 2 images, this time it gave 3" });
        expect(calls.map((call) => call.path)).toEqual(["/api/openapi/getJsonApiFormat"]);
    });

    test("a mis-typed model or a wrong key says why, and nothing is queued", async () => {
        expect(await provider.submit({ model: "gpt-image" } as never, ctx())).toMatchObject({ status: "failed" });
        replies["/api/openapi/getJsonApiFormat"] = { code: 301, msg: "user not exist", data: null };
        expect(await provider.submit({ model: "185" } as never, ctx())).toEqual({ status: "failed", message: "RunningHub does not recognize this API Key, please check in the model service." });
        replies["/api/openapi/getJsonApiFormat"] = { code: 301, msg: "PARAMS_INVALID", data: null };
        const unreadable = await provider.submit({ model: "185" } as never, ctx());
        expect(unreadable.message).toContain("Successfully ran once");
        expect(calls.some((call) => call.path === "/task/openapi/create")).toBe(false);
    });

    test("a refusal is a definite failure, a server error is left unknown", async () => {
        replies["/task/openapi/create"] = { code: 421, msg: "TASK_QUEUE_MAXED", data: null };
        expect(await provider.submit({ model: "185" } as never, ctx())).toEqual({ status: "failed", message: "The queued tasks of the RunningHub account are full, please wait until the previous tasks are finished." });
        replies["/task/openapi/create"] = "unauthorized";
        expect(await provider.submit({ model: "185" } as never, ctx())).toEqual({ status: "failed", message: "RunningHub does not recognize this API Key, please check in the model service." });
        replies["/task/openapi/create"] = "crash";
        await expect(provider.submit({ model: "185" } as never, ctx())).rejects.toThrow();
        replies["/task/openapi/create"] = { code: 0, msg: "success", data: {} };
        await expect(provider.submit({ model: "185" } as never, ctx())).rejects.toThrow("No task number returned");
    });

    test("a RunningHub that cannot be reached says so", async () => {
        const stopped = Bun.serve({ port: 0, fetch: () => new Response("") });
        const config = { baseUrl: `http://127.0.0.1:${stopped.port}`, apiKey: "test-key" };
        stopped.stop(true);
        expect(await provider.submit({ model: "185" } as never, { config, log: () => {} } as never)).toEqual({ status: "failed", message: "Can't connect to RunningHub. Please check network and service address" });
    });

    test("query follows the task to its outputs", async () => {
        const path = "/task/openapi/outputs";
        replies[path] = { code: 813, msg: "APIKEY_TASK_IS_QUEUED", data: null };
        expect(await provider.query("1001", {} as never, ctx())).toEqual({ taskId: "1001", status: "pending" });
        replies[path] = { code: 804, msg: "APIKEY_TASK_IS_RUNNING", data: null };
        expect(await provider.query("1001", {} as never, ctx())).toEqual({ taskId: "1001", status: "processing" });
        replies[path] = {
            code: 0,
            msg: "success",
            data: [
                { fileUrl: "https://cdn.example/out/a.png?sign=1", fileType: "png", nodeId: "9" },
                { fileUrl: "https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/b.mp4", fileType: "mp4" },
                { fileUrl: "output/c.wav", fileType: "wav" },
                { fileUrl: "https://cdn.example/note.txt", fileType: "txt" },
            ],
        };
        const done = await provider.query("1001", {} as never, ctx());
        expect(done.status).toBe("succeeded");
        expect(done.result?.images).toEqual([{ url: "https://cdn.example/out/a.png?sign=1", name: "a.png", mimeType: "image/png", kind: "image" }]);
        expect(done.result?.videos[0].url).toBe("https://rh-images.xiaoyaoyou.com/b.mp4");
        expect(done.result?.audios[0].url).toBe(`http://127.0.0.1:${server.port}/output/c.wav`);
    });

    test("query reports why a task failed", async () => {
        const path = "/task/openapi/outputs";
        replies[path] = { code: 805, msg: "APIKEY_TASK_STATUS_ERROR", data: { failedReason: { node_name: "KSampler", exception_message: "Not enough video memory" } } };
        expect(await provider.query("1001", {} as never, ctx())).toEqual({ taskId: "1001", status: "failed", message: "Node KSampler error: insufficient video memory" });
        replies[path] = { code: 805, msg: "APIKEY_TASK_STATUS_ERROR", data: null };
        expect(await provider.query("1001", {} as never, ctx())).toEqual({ taskId: "1001", status: "failed", message: "Task failed on RunningHub with no reason stated. You can check it in the task record of RunningHub" });
        replies[path] = { code: 806, msg: "APIKEY_USER_NOT_FOUND", data: null };
        expect(await provider.query("1001", {} as never, ctx())).toEqual({ taskId: "1001", status: "failed", message: "RunningHub does not recognize this API Key, please check in the model service." });
        replies[path] = { code: 0, msg: "success", data: [] };
        expect(await provider.query("1001", {} as never, ctx())).toEqual({ taskId: "1001", status: "failed", message: "The task was completed, but no pictures, videos or audio were produced." });
    });
});
