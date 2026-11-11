import type { ReactNode } from "react";
import { Button } from "antd";
import { useNavigate } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { useUserStore } from "@/stores/use-user-store";

type FeatureKey = "shortDramaEnabled" | "taskCenterEnabled" | "frontendModelsEnabled" | "pluginCenterEnabled";

const featureNames: Record<FeatureKey, string> = {
    shortDramaEnabled: "short play creation",
    taskCenterEnabled: "mission center",
    frontendModelsEnabled: "Frontend model",
    pluginCenterEnabled: "plug-in",
};

export function RequireFeature({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
    const navigate = useNavigate();
    const user = useUserStore((state) => state.user);
    const features = useUserStore((state) => state.features);
    if (!features[feature]) {

        return (
            <WorkspacePage>
                <WorkspaceState icon="empty" title={`${featureNames[feature]}Not available yet`} description="This module is not enabled in the current local workspace." action={<Button type="primary" onClick={() => navigate("/", { replace: true })}>Return to creation desk</Button>} />
            </WorkspacePage>
        );
    }
    return children;
}
