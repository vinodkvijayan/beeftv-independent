// Shared native/wasm execution for a lowered TimelineRenderPlan. Engines only
// run args; this module owns concat/SRT writes, requested-content checks,
// cancel, and cleanup. Subtitle text comes from the canonical plan, not a
// second pass over the raw timeline.
import { isSubtitleFontFailure } from "./subtitle-font-failure";
import {
    SUBTITLE_FILE,
    type TimelineRenderPlan,
    type TimelineRenderRequest,
} from "./timeline-to-ffmpeg";

export type TimelineRenderEngine = {
    writeFile(name: string, data: Uint8Array | string): Promise<void>;
    readFile(name: string): Promise<Uint8Array | string>;
    deleteFile(name: string): Promise<void>;
    exec(args: string[]): Promise<{ exitCode: number; log: string }>;
};

export type TimelineRenderProgress = {
    detail: string;
    percent: number;
};

export type TimelineRenderExecution = {
    output: Uint8Array | string;
    outputName: string;
    completedOutputs: string[];
    subtitleBurned: boolean;
    mixedAudio: boolean;
    request: TimelineRenderRequest;
};

const SUBTITLE_BURN_FAILURE = "The subtitle burning failed or the required fonts are missing, and the film without subtitles was not exported. Please use server-side rendering with Chinese subtitle fonts installed";

export function assertPlanPreservesRequestedContent(plan: TimelineRenderPlan): void {
    const { request } = plan;
    if (request.videoClipIds.length && !plan.concatEntries.length) {
        throw new Error("The export plan lost video clips and incomplete videos were not generated.");
    }
    if (request.audioClipIds.length && !plan.steps.some((step) => step.kind === "mix")) {
        throw new Error("The export plan lost the independent audio track and the incomplete film was not generated.");
    }
    if (request.burnSubtitles && !plan.steps.some((step) => step.kind === "burn")) {
        throw new Error("The export plan lost the subtitle burning, and the film without subtitles was not generated.");
    }
}

export async function executeTimelineRenderPlan(options: {
    plan: TimelineRenderPlan;
    engine: TimelineRenderEngine;
    signal?: AbortSignal;
    onProgress?: (progress: TimelineRenderProgress) => void;
    writtenFiles?: Set<string>;
}): Promise<TimelineRenderExecution> {
    const { plan, engine, signal, onProgress } = options;
    const writtenFiles = options.writtenFiles ?? new Set<string>();
    assertPlanPreservesRequestedContent(plan);
    const executableSteps = plan.steps.filter((step) => step.kind !== "subtitle");
    const completedOutputs: string[] = [];
    let stepIndex = 0;

    for (const step of plan.steps) {
        signal?.throwIfAborted();
        if (step.kind === "subtitle") {
            const srt = plan.subtitleSrt || "";
            if (!srt.trim() && plan.request.burnSubtitles) throw new Error("The subtitle content is empty and the film is not exported without subtitles.");
            if (srt) {
                await engine.writeFile(SUBTITLE_FILE, srt);
                writtenFiles.add(SUBTITLE_FILE);
            }
            continue;
        }
        if (step.args.includes("concat.txt")) {
            const content = plan.concatEntries.map((file) => "file '" + file + "'").join("\n");
            await engine.writeFile("concat.txt", content);
            writtenFiles.add("concat.txt");
        }
        onProgress?.({
            detail: step.description,
            percent: Math.round(10 + (stepIndex / Math.max(1, executableSteps.length)) * 75),
        });
        writtenFiles.add(step.output);
        const { exitCode, log } = await engine.exec(step.args);
        signal?.throwIfAborted();
        if (step.kind === "burn" && (exitCode !== 0 || isSubtitleFontFailure(log))) throw new Error(SUBTITLE_BURN_FAILURE);
        if (exitCode !== 0) throw new Error("Export failed:" + step.description);
        completedOutputs.push(step.output);
        stepIndex += 1;
    }

    const burned = completedOutputs.includes(plan.finalOutput) && plan.steps.some((step) => step.kind === "burn" && step.output === plan.finalOutput);
    const mixOutput = plan.steps.find((step) => step.kind === "mix")?.output;
    const mixedAudio = Boolean(mixOutput && completedOutputs.includes(mixOutput));
    if (plan.request.burnSubtitles && !burned) throw new Error("The subtitle burning is not completed and the film is not exported without subtitles.");
    if (plan.request.audioClipIds.length && !mixedAudio) throw new Error("The independent audio track mixing is not completed, and the missing audio is not exported into the film.");

    signal?.throwIfAborted();
    const output = await engine.readFile(plan.finalOutput);
    return {
        output,
        outputName: plan.finalOutput,
        completedOutputs,
        subtitleBurned: burned,
        mixedAudio,
        request: plan.request,
    };
}

export async function cleanupRenderFiles(engine: TimelineRenderEngine, files: Iterable<string>): Promise<void> {
    await Promise.all([...new Set(files)].map((file) => engine.deleteFile(file).catch(() => undefined)));
}
