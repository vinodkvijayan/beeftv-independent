import { App, Button, Input } from "antd";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/base/switch";
import { listRegisteredPlugins } from "@/lib/plugins/plugin-registry";
import type { RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { isOfficialApplicationPluginId } from "@/lib/plugins/official-applications";
import { isLocalRuntimeMode } from "@/lib/runtime-mode";
import { PLUGIN_PERMISSION_LABELS, pluginOrigin } from "@/pages/plugins/plugin-documentation";
import type { BackendPlugin } from "@/services/api/plugins";
import { setPluginActivation, syncPluginsFromBackend } from "@/services/plugin-sync";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useUserStore } from "@/stores/use-user-store";

export function AccountBuiltinPlugins({ onManage }: { onManage: () => void }) {
    const { message } = App.useApp();
    const [plugins, setPlugins] = useState<BackendPlugin[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [pending, setPending] = useState<string | null>(null);
    const updating = useRef(false);
    const states = usePluginStore((state) => state.pluginStates);
    const installations = usePluginStore((state) => state.installations);
    const user = useUserStore((state) => state.user);
    const systemVisible = useUserStore((state) => state.features.systemPluginsVisibleToUsers);
    useEffect(() => {
        let current = true;
        void syncPluginsFromBackend().then((result) => { if (current) setPlugins(result.plugins); }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : "Failed to read plugin"); }).finally(() => { if (current) setLoading(false); });
        return () => { current = false; };
    }, []);
    const backendById = new Map(plugins.map((plugin) => [plugin.manifest.id, plugin]));
    const registered = new Map(listRegisteredPlugins().map((plugin) => [plugin.manifest.id, plugin]));
    for (const plugin of plugins) registered.set(plugin.manifest.id, { manifest: plugin.manifest, source: plugin.source });
    const visible = [...registered.values()].filter((plugin) => {
        const remote = backendById.get(plugin.manifest.id);
        if (pluginOrigin(plugin) !== "official") return false;
        if (remote?.management.builtInInterface) return false;
        if (user?.role !== "admin" && !systemVisible && remote?.management.kind !== "application" && !isOfficialApplicationPluginId(plugin.manifest.id)) return false;
        return `${plugin.manifest.name} ${plugin.manifest.description}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    });
    const toggle = async (plugin: RegisteredPlugin, enabled: boolean) => {
        if (updating.current) return;
        updating.current = true;
        setPending(plugin.manifest.id);
        try {
            const remote = backendById.get(plugin.manifest.id);
            if (!remote && !states[plugin.manifest.id] && isLocalRuntimeMode()) usePluginStore.getState().setEnabled(plugin.manifest.id, enabled);
            else await setPluginActivation(plugin.manifest.id, enabled, remote?.management.activationScope);
        }
        catch (reason) { message.error(reason instanceof Error ? reason.message : "Failed to update plugin status"); }
        finally { updating.current = false; setPending(null); }
    };
    return <>
        <div className="account-plugins-toolbar"><Input aria-label="Search built-in plugins" placeholder="Search plugin" prefix={<Search size={16} />} value={search} allowClear onChange={(event) => setSearch(event.target.value)} /><Button onClick={onManage}>Manage all plugins</Button></div>
        {loading ? <p role="status">Loading plugins…</p> : error ? <div role="alert"><p>{error}</p><Button onClick={onManage}>Go to the plugin page and try again</Button></div> : !visible.length ? <p className="account-empty">{search ? "No matching built-in plugin" : "No built-in plug-ins yet"}</p> : <div className="account-builtin-list">
            {visible.map((plugin) => {
                const { manifest } = plugin;
                const state = states[manifest.id];
                const remote = backendById.get(manifest.id);
                const enabled = state?.effectiveEnabled ?? installations.find((item) => item.manifest.id === manifest.id)?.enabled ?? false;
                const canToggle = state?.canToggle ?? (!remote && isLocalRuntimeMode());
                const statusLabel = !state?.platformAvailable && state?.blockedReason ? state.blockedReason : enabled ? "Enabled" : "Deactivated";
                return <section className="account-builtin-item" key={manifest.id}>
                    <div className="account-builtin-heading"><h3>{manifest.name}</h3><span>{statusLabel}</span><Switch aria-label={`${enabled ? "deactivate" : "enable"}${manifest.name}`} checked={enabled} loading={pending === manifest.id} disabled={Boolean(pending) || !canToggle} title={!canToggle ? state?.blockedReason : undefined} onChange={(value) => void toggle(plugin, value)} /></div>
                    {manifest.description ? <p>{manifest.description}</p> : null}
                    <details><summary>Plug-in information</summary><dl><div><dt>Version</dt><dd>{manifest.version}</dd></div>{manifest.author ? <div><dt>Author</dt><dd>{manifest.author}</dd></div> : null}<div><dt>Permissions</dt><dd>{manifest.permissions.map((permission) => PLUGIN_PERMISSION_LABELS[permission] || permission).join("、") || "No additional permissions"}</dd></div></dl></details>
                </section>;
            })}
        </div>}
    </>;
}
