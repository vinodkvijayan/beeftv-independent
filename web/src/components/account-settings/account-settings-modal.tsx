import { Button, Segmented } from "antd";
import { Database, Plug, Settings2, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { AppChangelogButton, APP_VERSION, formatAppVersionLabel } from "@/components/layout/app-changelog-modal";
import { useBeefTVConnection } from "@/components/layout/beeftv-connection-provider";
import { AppModal } from "@/components/ui/product/app-modal";
import { useDesktopUpdate } from "@/hooks/use-desktop-update";
import { ModelDefaultGrid } from "@/pages/settings/model-default-grid";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { AccountBuiltinPlugins } from "./account-builtin-plugins";
import { AccountBalancePane } from "./account-balance-pane";
import "./account-settings.css";

const sections = [
    { id: "account", label: "Account and balance", icon: UserRound },
    { id: "general", label: "General settings", icon: Settings2 },
    { id: "models", label: "model", icon: Database },
    { id: "plugins", label: "Built-in plug-ins", icon: Plug },
] as const;
type Section = typeof sections[number]["id"];

export function AccountSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [active, setActive] = useState<Section>("account");
    const contentRef = useRef<HTMLElement>(null);
    const navigate = useNavigate();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const theme = useThemeStore((state) => state.preference);
    const setTheme = useThemeStore((state) => state.setTheme);
    const { state: updateState } = useDesktopUpdate();
    const installedVersion = formatAppVersionLabel(updateState.currentVersion || APP_VERSION);
    const { connection, syncing, catalogSyncFailed, retryCatalog, busy } = useBeefTVConnection();
    useEffect(() => { if (open) setActive("account"); }, [open]);
    useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [active]);
    const goTo = (path: string) => { onClose(); navigate(path); };
    return <AppModal flush open={open} aria-label="Account settings" width="min(960px, calc(100vw - 32px))" className="account-settings-modal" footer={null} onCancel={onClose}>
        <div className="account-settings-layout">
            <nav className="account-settings-nav" aria-label="Account settings classification">
                {sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={active === id ? "page" : undefined} onClick={() => setActive(id)}>
                    <Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>
                </button>)}
            </nav>
            <section ref={contentRef} className="account-settings-content" aria-label={sections.find((section) => section.id === active)?.label} tabIndex={0}>
                <h2>{sections.find((section) => section.id === active)?.label}</h2>
                {active === "account" ? <AccountBalancePane /> : null}
                {active === "general" ? <>
                    <div className="account-setting-row"><h3>Appearance</h3><Segmented className="account-appearance-control" aria-label="appearance mode" value={theme} options={[{ label: "light color", value: "light" }, { label: "Dark", value: "dark" }, { label: "Follow the system", value: "system" }]} onChange={(value) => setTheme(value)} /></div>
                    <div className="account-setting-row"><div><h3>Save settings</h3><p>Manage assets, caches and local storage locations</p></div><Button onClick={() => goTo("/settings?section=storage")}>Open</Button></div>
                    <div className="account-setting-row"><div><h3>Connection diagnostics</h3><p>Check model channels and request records</p></div><Button onClick={() => goTo("/settings?section=diagnostics")}>Open</Button></div>
                    <div className="account-setting-row"><div><h3>Version and update log</h3><p>{installedVersion ? `Current version${installedVersion}, view version records and third-party licenses` : "View version history and third-party licenses"}</p></div><AppChangelogButton appearance="button" version={installedVersion} label="View" /></div>
                </> : null}
                {active === "models" ? <>
                    <div className="account-setting-row account-model-connection"><div><h3>BeefTV official channel</h3><p role="status">{syncing ? "Synchronizing models..." : catalogSyncFailed ? "Model synchronization failed" : connection?.state === "connected" ? "Connected, model has been synchronized to local" : "Automatically connect to official models after logging in"}</p></div>
                        {catalogSyncFailed ? <Button loading={busy} onClick={() => void retryCatalog()}>Retry sync</Button> : <Button onClick={() => goTo("/settings?section=channels")}>Management channels</Button>}
                    </div>
                    <ModelDefaultGrid config={config} onChange={(key, value) => updateConfig(key, value)} onOpenChannels={() => goTo("/settings?section=channels")} />
                </> : null}
                {active === "plugins" ? <AccountBuiltinPlugins onManage={() => goTo("/plugins")} /> : null}
            </section>
        </div>
    </AppModal>;
}
