import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider, theme } from "antd";
import { StorageSettingsPane } from "../../src/pages/settings/storage-settings-pane";
import { ReferenceStoragePane } from "../../src/pages/settings/reference-storage-pane";
import { ReferenceMediaTransportFields } from "../../src/pages/settings/reference-media-transport-fields";
import type { ReferenceMediaTransport } from "../../src/stores/use-config-store";
import { CanvasUploadModal } from "../../src/components/canvas/canvas-upload-modal";
import { createReferenceLinkResolver } from "@/components/generation-reference-links";
import { getWorkspaceAntThemeConfig } from "@/lib/app-theme";
const params = new URLSearchParams(location.search);
const workspaceTheme = getWorkspaceAntThemeConfig();
document.documentElement.classList.toggle("dark",params.has("dark"));
document.getElementById("root")!.className = "app-user-workspace app-product-workspace";
document.body.style.background="var(--background)";
document.body.style.color="var(--foreground)";
const initial = { dataDir: "C:\\Users\\Creator\\AppData\\Roaming\\BeefTV", usedBytes: 1024 ** 3, freeBytes: 40 * 1024 ** 3 };
let usage = JSON.parse(localStorage.getItem("fixture-usage") || JSON.stringify(initial));
if (params.has("cleanup-error")) usage = { ...initial, dataDir: "D:\\BeefTV", previousDir: initial.dataDir, previousBytes: initial.usedBytes };
const config = { enabled: params.has("auto"), endpoint: params.has("auto") ? "https://s3.example.com" : "", bucket: params.has("auto") ? "example-media" : "", region: "auto", accessKeyId: params.has("auto") ? "example-access" : "", publicBaseURL: params.has("auto") ? "https://media.example.com" : "", hasSecret: params.has("auto") };
window.go = {
    main: {
        DesktopApp: {
            RuntimeConfig: async () => ({ baseURL: "http://127.0.0.1:9999/api", launchToken: "fixture" }),
            StorageSettings: async () => usage,
            ChooseStorageDirectory: async () => "D:\\BeefTV",
            MigrateStorage: async (path) => {
                if (params.has("migration-error")) throw new Error("The migration is not completed, the original data has been retained, but the workspace cannot be reopened. Please restart BeefTV\n\nopen C:\\private\\data: fixture failure");
                usage = { ...usage, dataDir: path, previousDir: initial.dataDir, previousBytes: initial.usedBytes };
                localStorage.setItem("fixture-usage", JSON.stringify(usage));
                return usage;
            },
            CleanupPreviousStorage: async () => {
                if (params.has("cleanup-error")) {
                    usage = { ...usage, previousBytes: 2048 };
                    throw new Error("The temporary file is still in use, please restart BeefTV and clean it again. The current storage directory is not affected\n\nfixture sharing violation");
                }
                usage = { ...usage, previousDir: undefined };
                localStorage.setItem("fixture-usage", JSON.stringify(usage));
                return usage;
            },
            ReferenceStorageSettings: async () => ({ ...config, enabled: params.has("auto") }),
            SaveReferenceStorage: async (value) => {
                const { secretAccessKey, ...publicValue } = value;
                Object.assign(config, publicValue, { hasSecret: Boolean(secretAccessKey) || config.hasSecret });
                return { ...config };
            },
            UploadReferenceMedia: async (ids) => {
                if (params.has("reject")) throw new Error("The public network address cannot be read");
                return Object.fromEntries(ids.map((id) => [id, `https://cdn.example.com/${id}`]));
            },
            TestReferenceStorage: async () => {
                if (params.has("test-error")) throw new Error("The material has been uploaded, but the public address cannot be read (HTTP 403). Please check the public read settings.");
            },
        },
    },
};
function Harness() {
    const [transport, setTransport] = useState<ReferenceMediaTransport>({});
    const [open, setOpen] = useState(false);
    const [result, setResult] = useState("");
    const { modal } = App.useApp();
    const generate = async () => {
        try {
            const resolve = createReferenceLinkResolver(modal);
            const value = await resolve([{ key: "image", label: "Reference pictures", resourceID: "owned-image" }]);
            setResult(value?.image || "cancelled");
        } catch (error) {
            setResult(String(error));
        }
    };
    return (
        <main className="settings-page space-y-8" style={{ padding: 16, maxWidth: 900, margin: "auto" }}>
            {params.has("transport") ? <ReferenceMediaTransportFields value={transport} onChange={setTransport} /> : <StorageSettingsPane />}
            <ReferenceStoragePane />
            {!params.has("transport") && <><button onClick={() => setOpen(true)}>Add test material</button><button onClick={() => void generate()}>Generate tests</button><output>{result}</output></>}
            <CanvasUploadModal
                open={open}
                onClose={() => setOpen(false)}
                onUpload={async () => true}
                onImportUrl={async (url, kind) => {
                    setResult(kind + ":" + url);
                    return true;
                }}
            />
        </main>
    );
}
createRoot(document.getElementById("root")!).render(
    <ConfigProvider theme={{ ...workspaceTheme, algorithm: params.has("dark") ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { ...workspaceTheme.token, motion: false } }}>
        <App>
            <Harness />
        </App>
    </ConfigProvider>,
);
