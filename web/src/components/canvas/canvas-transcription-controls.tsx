import { useEffect, useRef, useState } from "react";
import { Button, Select } from "antd";
import { BeefTVConnectionChangedError } from "@/services/api/beeftv-connection";
import { getTranscriptionModels } from "@/services/api/timeline-tasks";
import {
    attachLocalExecutorResult,
    beginLocalExecutorSession,
    isLocalExecutorSessionStop,
    localExecutorFrozenInputKey,
    localExecutorIntentAfterError,
    localExecutorIntentAfterSubmit,
    nextLocalExecutorClientOperationId,
    runOwnedTimelineTranscription,
    type LocalExecutorIntentState,
} from "@/lib/plugins/builtin/editor/local-executor-session";
import type { SrtEntry } from "@/types/timeline";

export function CanvasTranscriptionControls({
    projectId,
    nodeId,
    resourceId,
    disabled,
    onResult,
    onRunningChange,
}: {
    projectId: string;
    nodeId: string;
    resourceId: string | null;
    disabled: boolean;
    onResult: (entries: SrtEntry[]) => void;
    onRunningChange: (running: boolean) => void;
}) {
    const [models, setModels] = useState<Array<{ value: string; label: string }>>([]);
    const [model, setModel] = useState("");
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState("");
    const [running, setRunning] = useState(false);
    const requestRef = useRef(0);
    const controllerRef = useRef<AbortController | null>(null);
    const intentRef = useRef<LocalExecutorIntentState | null>(null);
    const busyRef = useRef(false);
    const mountedRef = useRef(true);
    const projectRef = useRef(projectId);
    projectRef.current = projectId;
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestRef.current++;
            controllerRef.current?.abort();
            onRunningChange(false);
        };
    }, [onRunningChange]);

    const refresh = async () => {
        const request = ++requestRef.current;
        setLoading(true);
        setModels([]);
        setModel("");
        setStatus("");
        try {
            const result = await getTranscriptionModels();
            if (!mountedRef.current || request !== requestRef.current) return;
            setModels(result.map((item) => ({ value: item.id, label: `${item.displayName || item.id} · BeefTV` })));
            if (!result.length) setStatus("There is no cloud transcription model available for the current connection");
        } catch (error) {
            if (mountedRef.current && request === requestRef.current && !(error instanceof BeefTVConnectionChangedError)) setStatus(error instanceof Error ? error.message : "Failed to read transcription model");
        } finally {
            if (mountedRef.current && request === requestRef.current) setLoading(false);
        }
    };

    const transcribe = async () => {
        if (!resourceId || busyRef.current) return;
        busyRef.current = true;
        setRunning(true);
        onRunningChange(true);
        setStatus("Queuing up…");
        const controller = new AbortController();
        controllerRef.current = controller;
        const session = beginLocalExecutorSession(projectId, { controller, getLiveProjectId: () => projectRef.current });
        const frozenInputKey = localExecutorFrozenInputKey([projectId, nodeId, resourceId, model]);
        const clientOperationId = nextLocalExecutorClientOperationId(intentRef.current, frozenInputKey);
        const intent = { clientOperationId, frozenInputKey };
        intentRef.current = intent;
        try {
            const { task, result } = await runOwnedTimelineTranscription({
                session,
                resourceId,
                projectId,
                model: model || undefined,
                clientOperationId,
                onCreated: (task) => {
                    intentRef.current = localExecutorIntentAfterSubmit(clientOperationId, task, intent);
                },
                onTaskUpdate: (task) => {
                    if (mountedRef.current) setStatus(task.stage || "Transcribing…");
                },
            });
            intentRef.current = localExecutorIntentAfterSubmit(clientOperationId, task, intent);
            await attachLocalExecutorResult(session, () => {
                const entries = result.segments.filter((segment) => segment.text.trim() && segment.endMs > segment.startMs).map((segment, index) => ({ ...segment, index: index + 1 }));
                if (!entries.length) {
                    setStatus("No available subtitles recognized");
                    return;
                }
                onResult(entries);
                setStatus(`Recognized${entries.length} Subtitles can be edited and saved or exported as SRT`);
            });
        } catch (error) {
            intentRef.current = localExecutorIntentAfterError(intentRef.current || intent, error);
            if (mountedRef.current && !isLocalExecutorSessionStop(error)) setStatus(error instanceof Error ? error.message : "Transcription failed");
        } finally {
            busyRef.current = false;
            if (mountedRef.current) {
                setRunning(false);
                onRunningChange(false);
            }
        }
    };

    return (
        <div className="media-editor-transcription flex flex-col gap-2" style={{ borderColor: "var(--workspace-border)" }}>
            <div className="flex flex-wrap items-center gap-2">
                <Select aria-label="Transcription model" size="small" className="min-w-[200px] flex-1" value={model} onChange={setModel} disabled={disabled || loading} options={[{ value: "", label: "local whisper.cpp" }, ...models]} />
                <Button size="small" disabled={disabled} loading={loading} onClick={() => void refresh()}>
                                        Refresh the transcription model
                </Button>
                <Button size="small" disabled={disabled || !resourceId || loading} loading={running} onClick={() => void transcribe()}>
                                        Automatically transcribe subtitles
                </Button>
            </div>
            <p className="text-xs opacity-60">{!resourceId ? "Once the material is uploaded, it can be automatically transcribed." : model ? "The audio will be uploaded to the cloud for recognition and billed according to the selected model; the transcription results will replace the current subtitle draft." : "Using local whisper.cpp recognition, the audio and video will not be exported from the device; the transcription result will replace the current subtitle draft."}</p>
            {status && (
                <p role="status" className="text-xs">
                    {status}
                </p>
            )}
            {running && <p className="text-xs opacity-60">After closing the window, the transcription task will still continue and can be viewed in the task center.</p>}
        </div>
    );
}
