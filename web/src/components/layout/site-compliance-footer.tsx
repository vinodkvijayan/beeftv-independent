import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppearanceStore } from "@/stores/use-appearance-store";

const MIIT_FILING_URL = "https://beian.miit.gov.cn/";

export function SiteComplianceFooter({ className, variant = "default" }: { className?: string; variant?: "default" | "auth" }) {
    const appearance = useAppearanceStore((state) => state.appearance);

    return (
        <footer className={cn("site-compliance-footer", variant === "auth" && "is-auth", className)} aria-label="Site copyright and filing information">
            <span>{appearance.footerCopyright}</span>
            {appearance.icpFilingEnabled && appearance.icpFilingNumber ? (
                <a href={MIIT_FILING_URL} target="_blank" rel="noopener noreferrer" aria-label={`${appearance.icpFilingNumber}, go to the registration management system of the Ministry of Industry and Information Technology to inquire`}>
                    {appearance.icpFilingNumber}
                    <ExternalLink aria-hidden="true" />
                </a>
            ) : null}
        </footer>
    );
}
