import { Button } from "antd";
import { useEffect, useRef, useState } from "react";
import { browserCapabilities, browserChecks, checkEnvironment, type EnvironmentCheck } from "@/services/diagnostics/environment-check";
import { probeBrowserStorage } from "@/services/diagnostics/browser-environment";

const labels: Record<EnvironmentCheck["status"], string> = { pass: "normal", warning: "Need to pay attention", error: "Need processing", repaired: "Fixed", skipped: "Optional", unknown: "Not confirmed" };

export function EnvironmentChecks() {
    const [checks, setChecks] = useState<EnvironmentCheck[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const active = useRef<AbortController | null>(null);
    async function run() {
        active.current?.abort();
        const controller = new AbortController();
        active.current = controller;
        setBusy(true);
        setError("");
        const storage = await probeBrowserStorage(controller.signal);
        if (controller.signal.aborted) return;
        const client = browserChecks({ ...browserCapabilities(), ...storage });
        try {
            const report = await checkEnvironment(true, controller.signal);
            if (controller.signal.aborted) return;
            setChecks([...report.checks, ...client]);
        } catch {
            if (controller.signal.aborted) return;
            setChecks(client);
            setError("The local service check has not been completed. The following are only the browser check results. Please confirm that the backend is running and try again.");
        } finally { if (!controller.signal.aborted) setBusy(false); }
    }
    useEffect(() => { void run(); return () => active.current?.abort(); }, []);
    return <section aria-label="Environmental self-check" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Environmental self-check</h3>
            <Button aria-label="recheck" aria-busy={busy} disabled={busy} onClick={() => void run()}>{busy ? "Under inspection" : "recheck"}</Button>
        </div>
        <p className="text-xs leading-5 text-foreground/55">Only the missing temporary directories will be rebuilt. The results are exported with the diagnostic package.</p>
        {busy ? <p role="status" className="text-xs text-foreground/55">Checking the operating environment...</p> : null}
        {error ? <p role="alert" className="text-xs leading-5 text-destructive">{error}</p> : null}
        <ul className="divide-y divide-border" aria-busy={busy}>
            {checks.map((check) => <li key={check.id} className="py-2">
                <div className="flex justify-between gap-3 text-xs"><span className="font-medium">{check.title}</span><span className={check.status === "error" ? "shrink-0 text-destructive" : "shrink-0 text-foreground/65"}>{labels[check.status]}</span></div>
                {check.status !== "pass" ? <p className="mt-1 text-xs leading-5 text-foreground/65">{check.detail}</p> : null}
            </li>)}
        </ul>
    </section>;
}
