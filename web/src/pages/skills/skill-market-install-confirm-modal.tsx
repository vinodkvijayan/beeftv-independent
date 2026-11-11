import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Checkbox, Modal, Tag } from "antd";
import type { Skill } from "@/services/api/skills";

export function isOfficialBuiltinMarketSkill(
    target: { skillId?: string; author?: string },
    installed: Array<Pick<Skill, "skillId" | "sourceType">> = [],
): boolean {
    if (!target.skillId) return false;
    return installed.some((skill) => skill.sourceType === "builtin" && skill.skillId === target.skillId);
}

export type SkillMarketInstallConfirmRequest = {
    skillId: string;
    releaseId?: string;
    name: string;
    versionLabel?: string;
    author?: string;
    description?: string;
    sourceLabel?: string;
    sourceRepo?: string;
    isUpdate?: boolean;
};

type SkillMarketInstallConfirmModalProps = {
    open: boolean;
    request: SkillMarketInstallConfirmRequest | null;
    loading?: boolean;
    onCancel: () => void;
    onConfirm: (request: SkillMarketInstallConfirmRequest) => Promise<void> | void;
};

export function SkillMarketInstallConfirmModal({
    open,
    request,
    loading = false,
    onCancel,
    onConfirm,
}: SkillMarketInstallConfirmModalProps) {
    const [riskAccepted, setRiskAccepted] = useState(false);

    useEffect(() => {
        setRiskAccepted(false);
    }, [request, open]);

    const isUpdate = Boolean(request?.isUpdate);
    const canConfirm = Boolean(request && riskAccepted);
    const metaParts = [
        request?.versionLabel ? `version${request.versionLabel}` : "",
        request?.sourceRepo ? `warehouse${request.sourceRepo}` : `Author${request?.author || "Not provided"}`,
    ].filter(Boolean);

    return (
        <Modal
            className="workspace-modal workspace-modal-wide"
            title={isUpdate ? "Confirm updated skills" : "Confirm installation skills"}
            open={open && Boolean(request)}
            centered
            footer={null}
            destroyOnHidden
            onCancel={onCancel}
        >
            {request ? (
                <div className="flex flex-col gap-4 py-1" data-testid="skill-market-install-confirm-body">
                    <div className="rounded-lg border border-border/70 bg-muted/20 p-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <div className="text-base font-semibold text-foreground">{request.name}</div>
                                {metaParts.length ? (
                                    <div className="mt-0.5 text-xs text-foreground/60">
                                        {metaParts.join(" · ")}
                                    </div>
                                ) : null}
                            </div>
                            <Tag>{request.sourceLabel || "skills market"}</Tag>
                        </div>
                        {request.description ? (
                            <p className="mt-2 text-xs leading-relaxed text-foreground/75">{request.description}</p>
                        ) : null}
                    </div>

                    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                        <div className="flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="size-4 shrink-0" />
                            <span>This is a third-party skill and BeefTV has not reviewed its content</span>
                        </div>
                        <p className="m-0 leading-relaxed text-foreground/85">
                            {isUpdate ? "After update" : "After installation"}, the assistant will read the skill description and accompanying files, and call the canvas tool or configured paid model according to the instructions, and the fee will be deducted from your account. please only{isUpdate ? "update" : "Installation"}Skills you trust.
                        </p>
                    </div>

                    <div className="rounded-lg border border-border/70 bg-muted/15 px-3 py-2.5">
                        <Checkbox
                            data-testid="skill-market-install-confirm-checkbox"
                            checked={riskAccepted}
                            onChange={(e) => setRiskAccepted(e.target.checked)}
                        >
                            <span className="text-xs font-medium text-foreground">
                                                                I understand the risks, confirm{isUpdate ? "update" : "Installation"}
                            </span>
                        </Checkbox>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                        <Button onClick={onCancel} disabled={loading}>
                                                        Cancel
                        </Button>
                        <Button
                            data-testid="skill-market-install-submit"
                            type="primary"
                            icon={<CheckCircle2 className="size-4" />}
                            loading={loading}
                            disabled={!canConfirm}
                            onClick={() => {
                                void onConfirm(request);
                            }}
                        >
                            {isUpdate ? "Confirm update" : "Confirm installation"}
                        </Button>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}
