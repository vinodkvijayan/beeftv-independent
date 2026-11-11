import { useEffect, useState } from "react";
import { Link } from "react-router";
import { listPublishPlans, type PublishPlan } from "@/services/api/skill-market";

export function AssistantPublicationEntry({ canvasId, turnCount, running }: { canvasId: string; turnCount: number; running: boolean }) {
    const [plans, setPlans] = useState<PublishPlan[]>([]);
    useEffect(() => {
        let cancelled = false;
        setPlans([]);
        if (!running) void listPublishPlans().then(value => {
            if (!cancelled) setPlans(value.items.filter(plan => plan.canvasId === canvasId && ["awaiting_upload_confirmation", "uploading", "awaiting_submit_confirmation", "needs_preview"].includes(plan.status)));
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [canvasId, turnCount, running]);
    if (!plans.length) return null;
    return <div className="canvas-assistant-card" aria-label="Skill submission to be confirmed"><p>The assistant has prepared a skill draft. Please check the files and confirm uploading and publishing separately.</p>{plans.map(plan => <p key={plan.planId}><Link to={`/skills?tab=publish&planId=${encodeURIComponent(plan.planId)}`}>Check "{plan.metadata.name}"Contribute</Link></p>)}</div>;
}
