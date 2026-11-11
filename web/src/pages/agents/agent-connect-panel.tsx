import { App, Button } from "antd";
import { Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { useCopyText } from "@/hooks/use-copy-text";
import { createAgentClient, type AgentClientKind, type AgentClientRegistration } from "@/services/api/agent-clients";

import { agentClientKindLabel, agentClientSetupBlock } from "./agent-client-presentation";

export function AgentConnectPanel({ kind, onClose, onConfigured, verifiedClientIds, onBusyChange }: { kind: AgentClientKind | null; onClose: () => void; onConfigured: () => void; verifiedClientIds: string[]; onBusyChange: (busy: boolean) => void }) {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [submitting, setSubmitting] = useState(false);
    const [registration, setRegistration] = useState<AgentClientRegistration | null>(null);

    useEffect(() => {
        if (!kind) return;
        setSubmitting(false);
        setRegistration(null);
    }, [kind]);

    const connect = async () => {
        if (!kind) return;
        setSubmitting(true);
        onBusyChange(true);
        try {
            const result = await createAgentClient({ kind });
            setRegistration(result);
            onConfigured();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Connection failed, please try again later");
        } finally {
            setSubmitting(false);
            onBusyChange(false);
        }
    };

    const setup = agentClientSetupBlock(registration?.setup);
    const verified = Boolean(registration && verifiedClientIds.includes(registration.client.id));

    return (
        <div className="agent-connect-panel" aria-label={`connect${agentClientKindLabel(kind || "other")}`}>
            {registration && setup ? (
                <div className="flex flex-col gap-3 py-1">
                    <p role="status" className="text-sm">{verified ? "The tool has been detected accessing BeefTV and the connection verification was successful." : "Wait for the tool to connect. Please run the command below or add configuration to enable BeefTV in the tool."}</p>
                    <p className="text-xs leading-5 text-foreground/60">{setup.instruction}</p>
                    <pre className="max-h-64 overflow-auto rounded-md bg-surface-active px-3.5 py-3 text-[12px] leading-5 font-mono whitespace-pre-wrap break-all text-foreground/85">{setup.text}</pre>
                    <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 text-xs leading-5 text-foreground/50">This content is only displayed once and needs to be reconnected after closing.</p>
                        <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => copyText(setup.text)}>Copy</Button>
                    </div>
                </div>
            ) : registration ? (
                <p className="py-2 text-xs leading-5 text-foreground/60">The access content was not obtained, please disconnect and reconnect.</p>
            ) : (
                <div className="flex flex-col gap-3 py-1">
                    <p className="text-xs leading-5 text-foreground/60">Once connected, you’ll have access to all of BeefTV’s creative tools. Each operation is approved by{agentClientKindLabel(kind || "other")}  Be responsible.</p>
                </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
                <Button disabled={submitting} onClick={onClose}>{registration ? "close" : "Cancel"}</Button>
                {!registration && <Button type="primary" loading={submitting} onClick={() => void connect()}>Generate connection configuration</Button>}
            </div>
        </div>
    );
}
