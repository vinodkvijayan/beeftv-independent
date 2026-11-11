import { useState } from "react";
import { ConfigProvider, Modal } from "antd";
import { CanvasImageSettingsPopover } from "../../src/components/canvas/canvas-image-settings-popover";
import { CanvasVideoSettingsPopover } from "../../src/components/canvas/canvas-video-settings-popover";
import { defaultConfig } from "../../src/stores/use-config-store";
import { getAntThemeConfig } from "../../src/lib/app-theme";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { appQueryClient } from "../../src/lib/query-client";
import { CanvasResourceMentionTextarea } from "../../src/components/canvas/canvas-resource-mention-textarea";
import { useAssetStore, type Asset } from "../../src/stores/use-asset-store";
import type { CanvasResourceReference } from "../../src/lib/canvas/canvas-resource-references";

const pixelDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=";
const audioDataUrl = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

const mockAssets: Asset[] = [
    {
        id: "asset-img-1",
        kind: "image",
        title: "IMG_5883.jpg",
        coverUrl: pixelDataUrl,
        category: "material",
        status: "confirmed",
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: { dataUrl: pixelDataUrl, width: 100, height: 100, bytes: 100, mimeType: "image/jpeg" },
    },
    {
        id: "asset-img-5",
        kind: "image",
        title: "Generate pictures",
        coverUrl: pixelDataUrl,
        category: "material",
        status: "confirmed",
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: { dataUrl: pixelDataUrl, width: 100, height: 100, bytes: 100, mimeType: "image/jpeg" },
    },
    {
        id: "asset-audio-1",
        kind: "audio",
        title: "Audio",
        coverUrl: "",
        category: "material",
        status: "confirmed",
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: { url: audioDataUrl, durationMs: 1000, bytes: 100, mimeType: "audio/wav" },
    },
    {
        id: "asset-char-1",
        kind: "entity",
        title: "Protagonist",
        coverUrl: "",
        category: "character",
        status: "confirmed",
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: { definition: {} },
    },
    {
        id: "asset-prop-1",
        kind: "image",
        title: "prop key",
        coverUrl: pixelDataUrl,
        category: "prop",
        status: "confirmed",
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: { dataUrl: pixelDataUrl, width: 100, height: 100, bytes: 100, mimeType: "image/jpeg" },
    },
];

useAssetStore.setState({ assets: mockAssets, hydrated: true });

const mockReferences: CanvasResourceReference[] = [
    {
        id: "ref-node-1",
        kind: "audio",
        label: "Audio node 1",
        title: "Audio node 1",
        nodeId: "node-1",
        active: true,
    },
    {
        id: "ref-node-2",
        kind: "text",
        label: "Prompt word node 2",
        title: "Prompt word node 2",
        nodeId: "node-2",
        active: true,
    },
    {
        id: "ref-skill-1",
        kind: "skill",
        label: "Intelligent storyboard skills",
        title: "Intelligent storyboard skills",
        active: true,
        skill: {
            skillId: "storyboard-auto",
            description: "Automatically split storyboard shots based on script text",
            version: "1.0.0",
            fileCount: 4,
        },
    },
    {
        id: "ref-node-char-1",
        kind: "character",
        label: "Tang Miaoling",
        title: "Tang Miaoling",
        nodeId: "node-char-1",
        active: true,
    },
];

function TestApp() {
    const [expanded, setExpanded] = useState(false);
    const [modalLayer, setModalLayer] = useState(1200);
    const [expandedPrompt, setExpandedPrompt] = useState("");
    const [imageConfig, setImageConfig] = useState({ ...defaultConfig, model: "gpt-image-1" });
    const [videoConfig, setVideoConfig] = useState({ ...defaultConfig, model: "seedance-2.0" });
    const [parameterUpdate, setParameterUpdate] = useState("");
    const [richPrompt, setRichPrompt] = useState("");
    const [plainPrompt, setPlainPrompt] = useState("");
    const [autoLinkPrompt, setAutoLinkPrompt] = useState("");
    const [underlyingClicks, setUnderlyingClicks] = useState(0);

    return (
        <div style={{ padding: "40px", maxWidth: "680px", margin: "0 auto", background: "#18181b", minHeight: "100vh", color: "#fff" }}>
            <button id="open-expanded" onClick={() => setExpanded(true)}>EnlargeEdit</button>
            <select id="modal-layer" value={modalLayer} onChange={(event) => setModalLayer(Number(event.target.value))}><option value={1200}>1200</option><option value={2400}>2400</option></select>
            <output id="expanded-prompt">{expandedPrompt}</output>
            <output id="parameter-update">{parameterUpdate}</output>
            <ConfigProvider theme={getAntThemeConfig(true)}>
                <Modal title="Enlarge prompt word" open={expanded} zIndex={modalLayer} footer={null} onCancel={() => setExpanded(false)}>
                    <CanvasResourceMentionTextarea aria-label="expanded-editor" value={expandedPrompt} references={mockReferences} includeAssetLibrary onChange={setExpandedPrompt} onSelectReference={(ref) => ref} style={{ height: 140 }} />
                    <div data-testid="image-settings">
                        <CanvasImageSettingsPopover config={imageConfig} onConfigChange={(key, value) => { setImageConfig((config) => ({ ...config, [key]: value })); setParameterUpdate(`image:${key}:${value}`); }} />
                    </div>
                    <div data-testid="video-settings">
                        <CanvasVideoSettingsPopover config={videoConfig} onConfigChange={(key, value) => { setVideoConfig((config) => ({ ...config, [key]: value })); setParameterUpdate(`video:${key}:${value}`); }} />
                    </div>
                </Modal>
            </ConfigProvider>
            <div style={{ marginBottom: "16px", display: "flex", gap: "16px", alignItems: "center" }}>
                <span id="rich-prompt-display">RichPrompt: {richPrompt}</span>
                <span id="underlying-click-count">UnderlyingClicks: {underlyingClicks}</span>
            </div>

            {/* Rich Editor Section */}
            <div style={{ background: "#27272a", borderRadius: "8px", padding: "12px", minHeight: "100px", position: "relative" }}>
                <CanvasResourceMentionTextarea
                    id="rich-mention-input"
                    aria-label="rich-editor"
                    value={richPrompt}
                    references={mockReferences}
                    includeAssetLibrary
                    onChange={setRichPrompt}
                    onSelectReference={(ref) => ref}
                    placeholder="Rich text input box, can be referenced by @"
                    style={{ width: "100%", height: "80px", color: "#fff", background: "transparent", border: "none", resize: "none" }}
                />
            </div>

            {/* Underlying target behind/near the menu to test ghost click */}
            <div style={{ margin: "16px 0" }}>
                <button
                    id="underlying-button"
                    type="button"
                    onClick={() => setUnderlyingClicks((prev) => prev + 1)}
                    style={{ padding: "8px 16px", background: "#3f3f46", border: "none", borderRadius: "4px", color: "#fff" }}
                >
                                        Bottom test button
                </button>
            </div>

            {/* Plain Textarea Section */}
            <div style={{ marginTop: "24px" }}>
                <div style={{ marginBottom: "8px" }}>
                    <span id="plain-prompt-display">PlainPrompt: {plainPrompt}</span>
                </div>
                <div style={{ background: "#27272a", borderRadius: "8px", padding: "12px", minHeight: "100px" }}>
                    <CanvasResourceMentionTextarea
                        id="plain-mention-input"
                    aria-label="secondary-editor"
                        value={plainPrompt}
                        references={mockReferences}
                        includeAssetLibrary
                        highlightLabels={false}
                        onChange={setPlainPrompt}
                        onSelectReference={(ref) => ref}
                        placeholder="Pure native textarea input box"
                        style={{ width: "100%", height: "80px", color: "#fff", background: "transparent", border: "none", resize: "none" }}
                    />
                </div>
            </div>

            {/* Auto Link Section */}
            <div style={{ marginTop: "24px" }}>
                <div style={{ marginBottom: "8px" }}>
                    <span id="autolink-prompt-display">AutoLinkPrompt: {autoLinkPrompt}</span>
                </div>
                <div style={{ background: "#27272a", borderRadius: "8px", padding: "12px", minHeight: "100px" }}>
                    <CanvasResourceMentionTextarea
                        id="autolink-mention-input"
                        aria-label="autolink-editor"
                        value={autoLinkPrompt}
                        references={mockReferences}
                        autoLinkEnabled
                        onChange={setAutoLinkPrompt}
                        onSelectReference={(ref) => ref}
                        placeholder="After entering the character name, press Tab to automatically complete the reference."
                        style={{ width: "100%", height: "80px", color: "#fff", background: "transparent", border: "none", resize: "none" }}
                    />
                </div>
            </div>
        </div>
    );
}

const rootElement = document.getElementById("root");
if (rootElement) {
    createRoot(rootElement).render(<QueryClientProvider client={appQueryClient}><TestApp /></QueryClientProvider>);
}
