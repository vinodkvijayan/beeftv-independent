import { useCallback, useMemo, useState } from "react";
import { Button, Table } from "antd";
import { Switch } from "@/components/ui/base/switch";

import { CanvasDirectorWorkbench } from "@/components/canvas/director/canvas-director-workbench";
import { generateDirectorPanorama } from "@/lib/canvas/director/director-panorama-generation";
import { DIRECTOR_REPRO_MATRIX, createDirectorReproScene, directorReproSceneIsOffline, injectDirectorReproModel, type DirectorReproModelVariant } from "@/lib/canvas/director/director-repro-fixture";
import { readDirectorReproSnapshot, type DirectorReproSnapshot } from "@/lib/canvas/director/director-repro-runtime";
import { resetDirectorDiagnosticDedupe } from "@/lib/canvas/director/director-diagnostics-recorder";
import { getClientDiagnosticEvents } from "@/services/diagnostics/client-diagnostics";
import { StatusBadge } from "@/components/ui/base/badges";
import { useAssetStore } from "@/stores/use-asset-store";
import type { DirectorScene, DirectorSceneOutput } from "@/types/director";

type DirectorOutputSummary = { beauty: string; clayVideo: string };
const panoramaFixtureSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#e33"/><rect x="400" width="400" height="400" fill="#38f"/></svg>';
const panoramaFixtureUrl = `data:image/svg+xml;base64,${btoa(panoramaFixtureSvg)}`;

/** The repro page must never submit a paid model task; production keeps the real task service. */
const generatePanoramaFixture: typeof generateDirectorPanorama = async ({ file, sceneId, onTaskUpdate }) => {
    onTaskUpdate?.({ id: "director-repro-panorama", status: "running", progress: 50 } as never);
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    const svg = panoramaFixtureSvg;
    const url = panoramaFixtureUrl;
    const name = `AI Panorama ·${file.name}`;
    const id = useAssetStore.getState().addAsset({ kind: "image", title: name, coverUrl: url, tags: ["Panorama", "AI generated"], source: "Director's stage reproduction stage", data: { dataUrl: url, width: 800, height: 400, bytes: svg.length, mimeType: "image/svg+xml" }, metadata: { source: "director-panorama-fixture", sceneId } });
    return { id, name, url, storageKey: "", width: 800, height: 400 };
};

async function readDirectorVideoSize(blob: Blob): Promise<string> {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    try {
        video.src = url;
        return await new Promise<string>((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new Error("White film video metadata read timeout")), 4000);
            video.onloadedmetadata = () => { window.clearTimeout(timeout); resolve(`${video.videoWidth}×${video.videoHeight} · ${blob.size} B`); };
            video.onerror = () => { window.clearTimeout(timeout); reject(new Error("White film video cannot be decoded")); };
        });
    } finally {
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
    }
}

/**
 * P0 手工复现入口（仅 DEV 注册）。
 *
 * 渲染真实 CanvasDirectorWorkbench + 确定性 fixture，不是静态 mock。
 * 本页自己的 callback 都是本地确定性实现，不调用任何 API：
 * onChange 只写本页 state，onFlush 只在「强制失败」开关打开时抛错，
 * onApply 只累加本地计数。
 *
 * 范围声明：只有「初始 fixture + 本页 callback」保证不发网。
 * 真实工作台自带的新增控件（默认演员 GLB、上传模型、画布图片立牌）
 * 仍可能联网，这是刻意保留的真实行为 —— 不要据此宣称整个工作台永不发网。
 */
export default function DirectorReproLab() {
    const [scene, setScene] = useState<DirectorScene>(() => createDirectorReproScene());
    // workbench 是 fixed inset-0 全屏浮层，会完全遮住本页。默认关闭，
    // 让环境快照 / 事件列表 / 复现矩阵先可读，再由用户显式打开进入复现。
    const [workbenchOpen, setWorkbenchOpen] = useState(false);
    const [forceSaveFailure, setForceSaveFailure] = useState(false);
    const [appliedCount, setAppliedCount] = useState(0);
    const [lastOutput, setLastOutput] = useState<DirectorOutputSummary | null>(null);
    const [flushCount, setFlushCount] = useState(0);
    const [events, setEvents] = useState(() => readDirectorEvents());
    const snapshot = useMemo(() => readDirectorReproSnapshot(), []);

    const refreshEvents = useCallback(() => setEvents(readDirectorEvents()), []);

    /** 本地确定性保存：只写本页 state，不触碰项目 store，也不发请求。 */
    const onChange = useCallback((next: DirectorScene) => setScene(next), []);

    /** 强制失败开关用于复现「保存失败 / 关闭恢复」，抛错后由 coordinator 走真实 error 语义。 */
    const onFlush = useCallback(() => {
        setFlushCount((count) => count + 1);
        if (forceSaveFailure) throw new Error("repro forced flush failure");
    }, [forceSaveFailure]);

    const onApply = useCallback(async (output: DirectorSceneOutput) => {
        const bitmap = await createImageBitmap(output.beauty);
        const beauty = `${bitmap.width}×${bitmap.height} · ${output.beauty.size} B`;
        bitmap.close();
        const clayVideo = output.clayVideo ? await readDirectorVideoSize(output.clayVideo) : "None";
        setLastOutput({ beauty, clayVideo });
        setAppliedCount((count) => count + 1);
    }, []);

    const reset = useCallback(() => {
        resetDirectorDiagnosticDedupe();
        setScene(createDirectorReproScene());
        setForceSaveFailure(false);
        setAppliedCount(0);
        setLastOutput(null);
        setFlushCount(0);
        setWorkbenchOpen(false);
        refreshEvents();
    }, [refreshEvents]);

    /** 显式注入模型对象：固定 id，重复点击替换同一对象而不是堆叠。 */
    const injectModel = useCallback((variant: DirectorReproModelVariant) => {
        setScene((current) => injectDirectorReproModel(current, variant));
    }, []);

    return (
        <div className="min-h-dvh overflow-y-auto p-5" style={{ background: "var(--bg)", color: "var(--fg)" }}>
            <header className="mb-4 flex flex-wrap items-center gap-3">
                <h1 className="text-lg font-semibold">Director's desk P0 Replay desk</h1>
                <StatusBadge tone={directorReproSceneIsOffline(scene) ? "error" : "success"} data-testid="offline-tag" label={directorReproSceneIsOffline(scene) ? "fixture no network assets" : "Model assets injected"} />
                <span className="text-[var(--fs-tiny)] opacity-70" data-testid="object-count">
                                        Number of objects{scene.objects.length}
                </span>
                <span className="ml-auto flex flex-wrap items-center gap-2">
                    <Button size="small" data-testid="inject-local-model" onClick={() => injectModel("local")}>
                                                Inject local model
                    </Button>
                    <Button size="small" data-testid="inject-missing-model" onClick={() => injectModel("missing")}>
                                                Inject missing model
                    </Button>
                    <Button size="small" data-testid="inject-panorama" onClick={() => setScene((current) => ({ ...current, panorama: { url: panoramaFixtureUrl, name: "Local two-color panorama", rotation: current.panoramaRotation ?? 0 } }))}>
                                                Inject local panorama
                    </Button>
                    <span className="text-[var(--fs-tiny)] opacity-70">Force save failed</span>
                    <Switch checked={forceSaveFailure} onChange={setForceSaveFailure} data-testid="force-save-failure" />
                    <Button size="small" data-testid="toggle-workbench" onClick={() => setWorkbenchOpen((open) => !open)}>
                        {workbenchOpen ? "Close director's desk" : "Open the director's desk"}
                    </Button>
                    <Button size="small" data-testid="refresh-events" onClick={refreshEvents}>
                                                refresh event
                    </Button>
                    <Button size="small" data-testid="reset-lab" onClick={reset}>
                                                reset
                    </Button>
                </span>
            </header>

            <EnvironmentSnapshot snapshot={snapshot} appliedCount={appliedCount} lastOutput={lastOutput} flushCount={flushCount} sceneRevisionHint={scene.updatedAt} />
            <DiagnosticEventList events={events} />
            <ReproMatrix />

            {workbenchOpen ? (
                <CanvasDirectorWorkbench open scene={scene} imageNodes={[]} onboardingScope="director-repro-lab" onClose={() => setWorkbenchOpen(false)} onChange={onChange} onApply={onApply} onDeleteImageNode={() => undefined} onFlush={onFlush} generatePanorama={generatePanoramaFixture} />
            ) : null}
        </div>
    );
}

type DirectorEventRow = { id: string; timestamp: string; level: string; code: string; message: string };

/** 只显示导演台自己的稳定码事件，避免整条诊断流噪声淹没复现现场。 */
function readDirectorEvents(): DirectorEventRow[] {
    return getClientDiagnosticEvents()
        .filter((event) => (event.code || "").startsWith("DIRECTOR_"))
        .map((event) => ({ id: event.id, timestamp: event.timestamp, level: event.level, code: event.code || "", message: event.message }))
        .reverse();
}

function EnvironmentSnapshot({ snapshot, appliedCount, lastOutput, flushCount, sceneRevisionHint }: { snapshot: DirectorReproSnapshot; appliedCount: number; lastOutput: DirectorOutputSummary | null; flushCount: number; sceneRevisionHint: string }) {
    const { runtime, webgl } = snapshot;
    const rows: Array<[string, string]> = [
        ["Application version", runtime.appVersion],
        ["Build commit", runtime.buildCommit],
        ["Browser", runtime.browser || "(not available)"],
        ["operating system", runtime.os || "(not available)"],
        ["time zone", runtime.timezone || "(not available)"],
        ["DPR", String(runtime.devicePixelRatio)],
        ["Local onApply times", String(appliedCount)],
        ["Recent composition PNG", lastOutput?.beauty || "None"],
        ["Recent white film video", lastOutput?.clayVideo || "None"],
        ["Local onFlush times", String(flushCount)],
        ["Scene updatedAt", sceneRevisionHint],
    ];

    if (webgl.available) {
        rows.push(
            ["WebGL version", webgl.version || "(empty)"],
            ["WebGL vendor", webgl.vendor || "(empty)"],
            ["WebGL renderer", webgl.renderer || "(empty)"],
            ["Maximum texture size", String(webgl.maxTextureSize)],
            ["max renderbuffer", String(webgl.maxRenderbufferSize)],
            ["Maximum viewport", webgl.maxViewportWidth + "×" + webgl.maxViewportHeight],
        );
    } else {
        rows.push(["WebGL", webgl.reason === "unsupported" ? "Not supported (stable downgraded)" : "Context creation failed (stable downgrade)"]);
    }

    return (
        <section className="mb-4">
            <h2 className="mb-2 text-[var(--fs-label)] font-semibold opacity-75">Environment snapshot</h2>
            <p className="mb-2 text-[var(--fs-tiny)] opacity-60">Only displayed locally, not reported; the length of the string has been limited and URL query/hash and credential fragments have been stripped.</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
                {rows.map(([label, value]) => (
                    <div key={label} className="flex min-w-0 gap-2 text-[var(--fs-tiny)]">
                        <span className="shrink-0 opacity-55">{label}</span>
                        <span className="min-w-0 flex-1 truncate font-mono" title={value}>
                            {value}
                        </span>
                    </div>
                ))}
            </div>
        </section>
    );
}

function DiagnosticEventList({ events }: { events: DirectorEventRow[] }) {
    return (
        <section className="mb-4">
            <h2 className="mb-2 text-[var(--fs-label)] font-semibold opacity-75">Structured events ({events.length}）</h2>
            <p className="mb-2 text-[var(--fs-tiny)] opacity-60">From the unified client-diagnostics buffer, only DIRECTOR_ stable codes are filtered; stack, URL and business text are not included.</p>
            {events.length ? (
                <Table
                    size="small"
                    rowKey="id"
                    dataSource={events}
                    pagination={false}
                    scroll={{ y: 220 }}
                    columns={[
                        { title: "time", dataIndex: "timestamp", width: 200, render: (value: string) => <span className="font-mono text-[var(--fs-tiny)]">{value}</span> },
                        { title: "Level", dataIndex: "level", width: 96, render: (value: string) => <StatusBadge size="sm" tone={value === "error" ? "error" : value === "warning" ? "warning" : "neutral"} label={value} /> },
                        { title: "stable code", dataIndex: "code", render: (value: string) => <span className="font-mono text-[var(--fs-tiny)]">{value}</span> },
                        { title: "news", dataIndex: "message" },
                    ]}
                />
            ) : (
                <p className="text-[var(--fs-tiny)] opacity-55">There are no direct events at the moment. Click "Refresh Event" after triggering the failure scenario in the matrix below.</p>
            )}
        </section>
    );
}

function ReproMatrix() {
    return (
        <section className="mb-4">
            <h2 className="mb-2 text-[var(--fs-label)] font-semibold opacity-75">P0 manual reproduction matrix ({DIRECTOR_REPRO_MATRIX.length}）</h2>
            <Table
                size="small"
                rowKey="id"
                dataSource={[...DIRECTOR_REPRO_MATRIX]}
                pagination={false}
                columns={[
                    { title: "Group", dataIndex: "group", width: 108 },
                    { title: "scene", dataIndex: "title", width: 190 },
                    { title: "Operation", dataIndex: "steps" },
                    { title: "expected", dataIndex: "expected" },
                ]}
            />
        </section>
    );
}
