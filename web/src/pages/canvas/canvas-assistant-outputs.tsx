import { Button } from "antd";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { getResourceBlob, getResourcePlaybackBlob, resourceStorageKey } from "@/services/api/resources";
import { downloadOwnedOrBrowserMedia, isWailsNativeShell } from "@/services/desktop-media-save";
import type { AssistantTurnOutput } from "@/services/api/agent-assistant";

const Player = lazy(() => import("@/components/video-player").then(module => ({ default: module.VideoPlayer })));

export function assistantOutputResource(task: GenerationTask | undefined): string | null {
    if (task?.status !== "succeeded" || !task.resultJson) return null;
    try {
        const result = JSON.parse(task.resultJson);
        return typeof result?.resourceId === "string" && result.resourceId.trim() ? result.resourceId.trim() : null;
    } catch { return null; }
}

export function CanvasAssistantOutputs({ outputs }: { outputs: AssistantTurnOutput[] }) {
    const videos = outputs.filter((output): output is Extract<AssistantTurnOutput, {kind:"video"}> => output.kind === "video");
    const projects = outputs.filter((output): output is Extract<AssistantTurnOutput, {kind:"project"}> => output.kind === "project");
    return <><CanvasAssistantVideoOutputs outputs={videos} />{projects.map(output => <AssistantProjectDownload key={output.resourceId} output={output} />)}</>;
}

function AssistantProjectDownload({output}: {output: Extract<AssistantTurnOutput,{kind:"project"}>}) {
    const [feedback,setFeedback] = useState("");
    const [loading,setLoading] = useState(false);
    async function download() {
        let url = "";
        setLoading(true);setFeedback("");
        try {
            if (!isWailsNativeShell()) {
                const blob = await getResourceBlob(resourceStorageKey(output.resourceId));
                if (!blob) throw Error("missing project"); url=URL.createObjectURL(blob);
            }
            const result = await downloadOwnedOrBrowserMedia({fileName:output.fileName,resourceId:output.resourceId,browserUrl:url || undefined});
            if(result === "saved")setFeedback("The project has been saved and can be edited after importing into BeefTV");
        } catch { setFeedback("Project download is not completed, please try again"); }
        finally { setLoading(false);if(url)setTimeout(()=>URL.revokeObjectURL(url),1000); }
    }
    return <div className="canvas-assistant-card"><strong>Editable project</strong><span>{output.fileName}</span><div className="canvas-assistant-card-actions"><Button size="small" loading={loading} onClick={()=>void download()}>Download project</Button></div>{feedback?<span role="status">{feedback}</span>:null}</div>;
}

function CanvasAssistantVideoOutputs({ outputs }: { outputs: Extract<AssistantTurnOutput,{kind:"video"}>[] }) {
    const signature = JSON.stringify(outputs.map(output => [output.taskId, output.kind, output.sourceRevision]));
    const identity = signature;
    const currentIdentity = useRef(identity);
    currentIdentity.current = identity;
    const [records, setRecords] = useState<{ identity: string; tasks: Record<string, GenerationTask>; unread: string[] }>({ identity: "", tasks: {}, unread: [] });
    const [playback, setPlayback] = useState<{ identity: string; taskId: string; url: string; loading?: boolean; error?: boolean } | null>(null);
    const [feedback, setFeedback] = useState<{ identity: string; text: string } | null>(null);
    const ownedURLs = useRef(new Set<string>());
    const playerURL = useRef("");
    const requestSerial = useRef(0);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const targets = JSON.parse(signature) as [string, string, number?][];
        const read = async () => {
            const entries = await Promise.all(targets.map(async ([taskId]) => {
                try { return [taskId, await queryGenerationTask(taskId, { signal: controller.signal })] as const; }
                catch { return [taskId, null] as const; }
            }));
            if (cancelled) return;
            const tasks: Record<string, GenerationTask> = {}, unread: string[] = [];
            for (const [id, task] of entries) {
                if (task && task.id === id) tasks[id] = task;
                else unread.push(id);
            }
            setRecords(previous => ({ identity, tasks: { ...(previous.identity === identity ? previous.tasks : {}), ...tasks }, unread }));
            if (entries.some(([, task]) => task?.status === "queued" || task?.status === "running")) timer = setTimeout(() => void read(), 2000);
        };
        void read();
        return () => { cancelled = true; controller.abort(); if (timer) clearTimeout(timer); };
    }, [identity, signature, retry]);
    useEffect(() => {
        const urls = ownedURLs.current;
        return () => { requestSerial.current++; for (const url of urls) URL.revokeObjectURL(url); urls.clear(); playerURL.current = ""; };
    }, [identity]);
    const tasks = records.identity === identity ? records.tasks : {};
    const shownPlayback = playback?.identity === identity ? playback : null;
    const last = outputs.at(-1);
    const lastReady = last && assistantOutputResource(tasks[last.taskId]);
    const lastTask = last ? tasks[last.taskId] : undefined;
    const lastUnread = Boolean(last && records.identity === identity && records.unread.includes(last.taskId));
    const previousNotice = lastUnread || !lastTask ? "This is a previously completed version; the results of this latter synthesis are yet to be confirmed."
        : lastTask.status === "queued" || lastTask.status === "running" ? "This is a previously completed version; the next one is being composited."
        : lastTask.status === "failed" || lastTask.status === "cancelled" ? "This is the previously completed version; the later composition was unfinished."
        : lastTask.status === "succeeded" ? "This is a previously completed version; the final production is not available yet." : "This is a previously completed version; the results of this latter synthesis are yet to be confirmed.";
    async function play(taskId: string) {
        const resourceId = assistantOutputResource(tasks[taskId]);
        if (!resourceId) return;
        const serial = ++requestSerial.current;
        setPlayback({ identity, taskId, url: "", loading: true });
        try {
            const blob = await getResourcePlaybackBlob(resourceStorageKey(resourceId));
            if (serial !== requestSerial.current || currentIdentity.current !== identity) return;
            if (!blob) throw Error("missing media");
            const url = URL.createObjectURL(blob);
            if (playerURL.current) { URL.revokeObjectURL(playerURL.current); ownedURLs.current.delete(playerURL.current); }
            playerURL.current = url; ownedURLs.current.add(url);
            setPlayback({ identity, taskId, url });
        } catch {
            if (serial === requestSerial.current && currentIdentity.current === identity) setPlayback({ identity, taskId, url: "", error: true });
        }
    }
    async function download(taskId: string, title: string) {
        const resourceId = assistantOutputResource(tasks[taskId]);
        if (!resourceId) return;
        const serial = requestSerial.current;
        let url = "";
        try {
            if (!isWailsNativeShell()) {
                const blob = await getResourceBlob(resourceStorageKey(resourceId));
                if (serial !== requestSerial.current || currentIdentity.current !== identity) return;
                if (!blob) throw Error("missing media");
                url = URL.createObjectURL(blob);
                ownedURLs.current.add(url);
            }
            const result = await downloadOwnedOrBrowserMedia({ fileName: `${title}.mp4`, resourceId, browserUrl: url || undefined });
            if (result === "saved" && currentIdentity.current === identity) setFeedback({ identity, text: "The finished film has been saved" });
        } catch {
            if (currentIdentity.current === identity) setFeedback({ identity, text: "Download not completed, please try again" });
        } finally {
            // The browser starts reading the clicked link asynchronously.
            // Scope/unmount cleanup can revoke earlier; otherwise let it start first.
            if (url) { const savedURL = url; setTimeout(() => { URL.revokeObjectURL(savedURL); ownedURLs.current.delete(savedURL); }, 1000); }
        }
    }
    return <div className="canvas-assistant-outputs" aria-label="The result of the film">{outputs.map((output, index) => {
        const task = tasks[output.taskId], ready = Boolean(assistantOutputResource(task));
        const title = `Completed film${index + 1}`;
        const unread = records.identity === identity && records.unread.includes(output.taskId);
        const status = unread ? "Unable to read status at the moment" : ready ? "Ready" : !task ? "Reading status" : task.status === "failed" || task.status === "cancelled" ? "Synthesis not completed" : task.status === "succeeded" ? "The finished film is temporarily unavailable" : task.status === "queued" || task.status === "running" ? "Synthesizing" : "Unable to confirm status at the moment";
        return <div key={output.taskId} className="canvas-assistant-card">
            <strong>{title}</strong><span role="status">{status}</span>
            {ready && output.taskId !== last?.taskId ? <span className="canvas-assistant-meta">{lastReady ? "previous version" : previousNotice}</span> : null}
            {ready ? <div className="canvas-assistant-card-actions"><Button size="small" loading={shownPlayback?.taskId === output.taskId && shownPlayback.loading} onClick={() => void play(output.taskId)}>Play the finished movie</Button><Button size="small" autoInsertSpace={false} onClick={() => void download(output.taskId, title)}>Download</Button></div> : null}
            {unread ? <Button size="small" onClick={() => setRetry(value => value + 1)}>reread status</Button> : null}
            {shownPlayback?.taskId === output.taskId && shownPlayback.url ? <Suspense fallback={<span>Loading player…</span>}><Player src={shownPlayback.url} title={title} mimeType="video/mp4" autoPlay compactControls className="w-full" /></Suspense> : null}
            {shownPlayback?.taskId === output.taskId && shownPlayback.error ? <span role="status">Unable to play temporarily, please reload the video.</span> : null}
        </div>;
    })}{feedback?.identity === identity ? <span role="status">{feedback.text}</span> : null}</div>;
}
