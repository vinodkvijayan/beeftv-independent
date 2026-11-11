import { useQuery } from "@tanstack/react-query";
import { App, Button, Popconfirm } from "antd";
import { Plug } from "lucide-react";
import { useState } from "react";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { EmptyState } from "@/components/ui/product/empty-state";
import { useCopyText } from "@/hooks/use-copy-text";
import { isNativeDesktopRuntime } from "@/lib/runtime-mode";
import { connectAgentIntegration, disconnectAgentIntegration, listAgentClients, revokeAgentClient, type AgentClientKind, type AgentIntegration, type AgentIntegrationKind } from "@/services/api/agent-clients";
import { ApiError } from "@/services/api/request";

import { agentClientDisplayLabel, agentClientKindLabel, agentClientKinds, agentClientLastUsedLabel, agentClientModeLabel, agentIntegrationAction, agentIntegrationHint, agentIntegrationStatusLabel } from "./agent-client-presentation";
import { AgentConnectPanel } from "./agent-connect-panel";

const AGENT_CLIENTS_QUERY_KEY = ["agent-clients"] as const;

export default function AgentsPage() {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [connecting, setConnecting] = useState<AgentClientKind | null>(null);
    const [managing, setManaging] = useState<AgentClientKind | null>(null);
    const [setupBusy, setSetupBusy] = useState(false);
    const [revoking, setRevoking] = useState("");
    const [integrationBusy, setIntegrationBusy] = useState<AgentIntegrationKind | null>(null);

    const clientsQuery = useQuery({
        queryKey: AGENT_CLIENTS_QUERY_KEY,
        queryFn: ({ signal }) => listAgentClients(signal),
        retry: false,
        refetchInterval: 5000,
    });

    // 后端还没带上这个能力时（404）不报错，也不留一个坏掉的页面。
    const unsupported = clientsQuery.error instanceof ApiError && clientsQuery.error.status === 404;
    const clients = clientsQuery.data?.clients || [];
    const cli = clientsQuery.data?.cli;
    // 一键接入只在本机桌面版出现；Web/服务端只保留手动配置。
    const integrations = isNativeDesktopRuntime() ? clientsQuery.data?.integrations : undefined;

    const disconnect = async (id: string) => {
        setRevoking(id);
        try {
            await revokeAgentClient(id);
            message.success("Disconnected");
            await clientsQuery.refetch();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Disconnect failed, please try again later");
        } finally {
            setRevoking("");
        }
    };

    const connectIntegration = async (integration: AgentIntegration) => {
        setIntegrationBusy(integration.kind);
        try {
            await connectAgentIntegration(integration.kind);
            message.success(`Already connected${integration.name}`);
            await clientsQuery.refetch();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Access failed, please try again later");
        } finally {
            setIntegrationBusy(null);
        }
    };

    const disconnectIntegration = async (integration: AgentIntegration) => {
        setIntegrationBusy(integration.kind);
        try {
            const result = await disconnectAgentIntegration(integration.kind);
            message.success(`Disconnected${integration.name}`);
            if (result.warning) message.info(result.warning);
            await clientsQuery.refetch();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Disconnect failed, please try again later");
        } finally {
            setIntegrationBusy(null);
        }
    };

    return (
        <WorkspacePage>
            <PageHeader title="BeefTV MCP" />

            {unsupported ? (
                <EmptyState icon={Plug} title="The current version does not support it yet" description="After updating to the new version, you will be able to connect Codex, Claude Code and Cursor here." />
            ) : (
                <div className="agents-settings mt-4 pb-6">
                    {clientsQuery.isPending ? <p className="text-xs text-foreground/55">Reading…</p> : null}
                    {clientsQuery.error ? (
                        <div role="alert" className="mb-4 text-sm">
                                                        Unable to read connection status.
                            <Button type="link" onClick={() => void clientsQuery.refetch()}>
                                                                Try again
                            </Button>
                        </div>
                    ) : null}
                    <div className="agent-tool-list">
                        {agentClientKinds.map((kind) => {
                            const registered = clients.filter((client) => client.kind === kind);
                            const integration = integrations?.find((item) => item.kind === kind);
                            // Only hide one-click credentials from the manual list when the
                            // one-click row is actually rendered and can disconnect them.
                            const manualClients = integration ? registered.filter((client) => !client.desktopIntegration) : registered;
                            const action = integration ? agentIntegrationAction(integration) : null;
                            const expanded = !integration && (connecting === kind || managing === kind);
                            const status = integration
                                ? agentIntegrationStatusLabel(integration)
                                : clientsQuery.isPending || clientsQuery.error
                                  ? "Status unknown"
                                  : registered.some((client) => client.lastUsedAt)
                                    ? "Verified connection"
                                    : registered.length
                                      ? "Waiting for connection"
                                      : "Not connected";
                            return (
                                <section key={kind} data-agent-client-kind={kind} className="agent-tool">
                                    <div className="agent-tool-row">
                                        <h2>{agentClientKindLabel(kind)}</h2>
                                        <div className="agent-tool-actions">
                                            <span className="agent-tool-status">{status}</span>
                                            {integration ? (
                                                <>
                                                    {action === "disconnect" ? (
                                                        <Popconfirm
                                                            title={`Disconnect${integration.name}？`}
                                                            description="When disconnected it can no longer read or modify the canvas, and the usage instructions are removed. Reconnect to restore."
                                                            okText="Disconnect"
                                                            cancelText="Cancel"
                                                            okButtonProps={{ danger: true }}
                                                            onConfirm={() => void disconnectIntegration(integration)}
                                                        >
                                                            <Button loading={integrationBusy === integration.kind}>Disconnect</Button>
                                                        </Popconfirm>
                                                    ) : (
                                                        <Button
                                                            disabled={action === "unavailable" || integrationBusy === integration.kind || !cli?.available}
                                                            loading={integrationBusy === integration.kind}
                                                            onClick={() => void connectIntegration(integration)}
                                                        >
                                                                                                                        Access
                                                        </Button>
                                                    )}
                                                    <Button onClick={() => setManaging(managing === kind ? null : kind)}>{managing === kind ? "close" : "Manual connection"}</Button>
                                                </>
                                            ) : (
                                                <Button
                                                    aria-expanded={expanded}
                                                    disabled={setupBusy || !cli?.available || clientsQuery.isPending || Boolean(clientsQuery.error)}
                                                    onClick={() => {
                                                        if (expanded) {
                                                            setConnecting(null);
                                                            setManaging(null);
                                                            return;
                                                        }
                                                        setConnecting(manualClients.length ? null : kind);
                                                        setManaging(manualClients.length ? kind : null);
                                                    }}
                                                >
                                                    {expanded ? "close" : manualClients.length ? "management" : "connect"}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    {integration ? <p className="agent-integration-note">{agentIntegrationHint(integration)}</p> : null}
                                    {managing === kind ? (
                                        <div className="agent-management">
                                            {manualClients.map((client) => (
                                                <div key={client.id} data-agent-client-id={client.id} className="agent-registration">
                                                    <div className="agent-registration-info">
                                                        <p className="text-sm font-medium break-words">{agentClientDisplayLabel(client)}</p>
                                                        <p className="text-xs text-foreground/55">
                                                            {agentClientModeLabel(client.mode)}  · Recently used:{agentClientLastUsedLabel(client.lastUsedAt)}
                                                        </p>
                                                    </div>
                                                    <Popconfirm
                                                        title="Disconnect this tool?"
                                                        description="After disconnecting it can no longer read or modify the canvas and needs to be reconnected."
                                                        okText="Disconnect"
                                                        cancelText="Cancel"
                                                        okButtonProps={{ danger: true }}
                                                        onConfirm={() => void disconnect(client.id)}
                                                    >
                                                        <Button loading={revoking === client.id}>Disconnect</Button>
                                                    </Popconfirm>
                                                </div>
                                            ))}
                                            <Button
                                                className="agent-add-connection mt-3"
                                                onClick={() => {
                                                    setManaging(null);
                                                    setConnecting(kind);
                                                }}
                                            >
                                                                                                New connection
                                            </Button>
                                        </div>
                                    ) : null}
                                    {connecting === kind ? (
                                        <AgentConnectPanel
                                            key={kind}
                                            kind={kind}
                                            onClose={() => setConnecting(null)}
                                            onConfigured={() => void clientsQuery.refetch()}
                                            verifiedClientIds={clients.filter((client) => client.lastUsedAt).map((client) => client.id)}
                                            onBusyChange={setSetupBusy}
                                        />
                                    ) : null}
                                </section>
                            );
                        })}
                    </div>
                    {cli && !cli.available ? (
                        <p role="alert" className="mt-4 text-sm text-foreground/60">
                                                        The installation file is incomplete and external tools cannot be connected. Please re-download and fully unzip BeefTV.
                        </p>
                    ) : null}
                    {cli?.available ? (
                        <details className="agent-cli-details">
                            <summary>Command line tools</summary>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                                <p className="text-xs text-foreground/55">Use beeftv command in terminal</p>
                                <Button size="small" onClick={() => copyText(cli.installCommand)}>
                                                                        Copy the installation command
                                </Button>
                            </div>
                        </details>
                    ) : null}
                </div>
            )}
        </WorkspacePage>
    );
}
