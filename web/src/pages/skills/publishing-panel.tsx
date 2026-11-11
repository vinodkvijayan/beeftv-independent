import { Alert, App, Button, Checkbox, Dropdown, Form, Input, Select, Skeleton } from "antd";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { CircleUserRound, RefreshCw } from "lucide-react";
import type { CollectionHeaderProps } from "@/components/layout/collection-header";
import { AppModal } from "@/components/ui/product/app-modal";
import { getDesktopAppBinding } from "@/services/desktop-runtime";
import { getSkill, listSkills, type Skill } from "@/services/api/skills";
import { disconnectMarketAuthorization, preparePublication, refreshPublication, startMarketAuthorization, submitPublication, uploadPublication, type MarketAuthorization, type MarketSubmission, type PublishPlan, type SkillMetadata, type PublicationTarget } from "@/services/api/skill-market";
import { canSubmitPublication, capabilityOptions, needsPublicationTargetCorrection, publicationStatus, requirementLabel, unsupportedRequirements } from "./market-copy";
import { SkillFileDetails } from "./skill-file-details";
import { skillFailureMessage } from "./skill-feedback";
import { loadPublicationHistory, mergePublications } from "./skill-publications";
import { PublicationDetailContent } from "./publication-detail-content";
import { SkillReleaseMarkdown } from "./market-file-preview";

type PublicationFormValues = Omit<SkillMetadata, "skillId"> & PublicationTarget & { localSkillId: string };
type PublishingPanelProps = {
    planId?: string;
    renderHeader: (controls: Pick<CollectionHeaderProps<string>, "search" | "actions" | "createItems">) => ReactNode;
};

export async function openSkillWebsite(url: string) {
    const binding = getDesktopAppBinding()?.OpenSkillMarketURL;
    if (binding) await binding(url);
    else window.open(url, "_blank", "noopener,noreferrer");
}

export function SkillPublishingPanel({ planId, renderHeader }: PublishingPanelProps) {
    const { message } = App.useApp();
    const [params, setParams] = useSearchParams();
    const [plans, setPlans] = useState<PublishPlan[]>([]);
    const [submissions, setSubmissions] = useState<MarketSubmission[]>([]);
    const [revision, setRevision] = useState(0);
    const [remoteError, setRemoteError] = useState("");
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState("");
    const [skills, setSkills] = useState<Skill[]>([]);
    const [auth, setAuth] = useState<MarketAuthorization>({});
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [authorizationRequired, setAuthorizationRequired] = useState(false);
    const [creating, setCreating] = useState(false);
    const [preparingFrom, setPreparingFrom] = useState<PublishPlan | null>(null);
    const [form] = Form.useForm<PublicationFormValues>();
    const formRequirements = Form.useWatch("requirements", form) || [];
    const publicationTarget = Form.useWatch("publicationTarget", form);
    const publications = mergePublications(plans, submissions);
    const selectedPlan = plans.find(item => item.planId === selected);
    const currentRow = publications.find(item => item.key === selected || item.plan?.planId === selected || (selectedPlan?.submissionId && item.submission?.submissionId === selectedPlan.submissionId));
    const current = currentRow?.plan;
    const currentSubmission = current ? undefined : currentRow?.submission;
    const keyword = query.trim().toLocaleLowerCase();
    const visiblePublications = publications.filter(item => `${item.metadata.name} ${item.metadata.description} ${publicationStatus(item.status)}`.toLocaleLowerCase().includes(keyword));
    const website = auth.websiteUrl || "https://beeftv.app/skills";
    const replace = (next: PublishPlan) => { setPlans(items => [next, ...items.filter(item => item.planId !== next.planId)]); setSelected(next.planId); setConfirmed(false); setParams({ tab: "publish", planId: next.planId }); };
    const reload = useCallback(() => setRevision(value => value + 1), []);
    useEffect(() => {
        let stale = false;
        setLoading(true); setError("");
        void Promise.allSettled([loadPublicationHistory(), listSkills({ scope: "created", pageSize: 100 })]).then(([history, installed]) => {
            if (stale) return;
            if (history.status === "fulfilled") {
                const value = history.value;
                if (!value.localError) setPlans(value.plans);
                else setError(skillFailureMessage(value.localError, "Native draft read failed", "Please refresh and try again."));
                if (value.authorization) {
                    const authorization = value.authorization;
                    setAuth(previous => ({ ...authorization, ...(authorization.pending ? { userCode: previous.userCode, verificationUrl: previous.verificationUrl } : {}) }));
                }
                if (!value.remoteError || value.authorization?.connected === false) setSubmissions(value.submissions);
                setRemoteError(value.remoteError ? skillFailureMessage(value.remoteError, "Historical submission synchronization failed", "Please check the account connection, refresh and try again.") : "");
            } else setError(skillFailureMessage(history.reason, "Failed to read submission record", "Please refresh and try again."));
            if (installed.status === "fulfilled") setSkills(installed.value.skills);
            else setError(skillFailureMessage(installed.reason, "Native skill reading failed", "Please refresh and try again before creating a new submission."));
            setLoading(false);
        });
        return () => { stale = true; };
    }, [revision]);
    useEffect(() => { setSelected(planId || ""); }, [planId]);
    useEffect(() => {
        if (creating) return;
        window.addEventListener("focus", reload);
        return () => window.removeEventListener("focus", reload);
    }, [creating, reload]);
    useEffect(() => {
        const localSkillId = params.get("skillId");
        if (localSkillId) {
            const skill = skills.find(item => item.skillId === localSkillId);
            form.setFieldsValue({ localSkillId, name: skill?.skillName, description: skill?.description, versionLabel: skill?.version || "1.0.0", publicationTarget: skill?.marketRelease || skill?.originalSkillId ? undefined : "new" });
            setCreating(true);
        }
    }, [params, form, skills]);
    useEffect(() => { setConfirmed(false); setAuthorizationRequired(false); }, [selected, current?.preview?.previewDigest]);
    const run = async (work: () => Promise<unknown>) => {
        setBusy(true); setError("");
        try { await work(); } catch (e) { setError(skillFailureMessage(e, "Submission operation not completed", "Please keep it as a draft, check the usage conditions in the connection or prompt and try again.")); } finally { setBusy(false); }
    };
    const makePlan = async (values: PublicationFormValues) => {
        const skill = skills.find(item => item.skillId === values.localSkillId);
        if (!skill) return;
        if (preparingFrom && skill.skillId === preparingFrom.skillId && skill.versionId !== preparingFrom.versionId) {
            setError("Native skills have been updated, but the original remains. Please check the current file from \"My Skills\" and prepare your submission again.");
            return;
        }
        await run(async () => {
            const { localSkillId, publicationTarget, marketSkillId, ...fields } = values;
            const metadata = { ...preparingFrom?.metadata, ...fields, name: fields.name || skill.skillName, description: fields.description || skill.description, requirements: fields.requirements || [], showcase: preparingFrom?.metadata.showcase || [] };
            // The selected publication target owns the cloud ID; never reuse a
            // legacy metadata ID as an implicit update destination.
            delete metadata.skillId;
            replace(await preparePublication(localSkillId, metadata, { publicationTarget, marketSkillId: publicationTarget === "existing" ? marketSkillId : undefined }, preparingFrom?.planId));
            setPreparingFrom(null);
            setCreating(false); message.success("A local draft has been prepared. Please check the file and confirm uploading.");
        });
    };
    const selectSkill = (id: string) => {
        const skill = skills.find(item => item.skillId === id);
        if (skill) form.setFieldsValue({ name: skill.skillName, description: skill.description, versionLabel: skill.version || "1.0.0", publicationTarget: skill.marketRelease || skill.originalSkillId ? undefined : "new", marketSkillId: undefined });
    };
    const reprepare = (plan: PublishPlan) => run(async () => {
        const { skill } = await getSkill(plan.skillId);
        if (skill.versionId !== plan.versionId) throw new Error("Native skills have been updated, but the original remains. Please check the current file from \"My Skills\" and prepare your submission again.");
        setSkills(items => [skill, ...items.filter(item => item.skillId !== skill.skillId)]);
        form.resetFields();
        form.setFieldsValue({ ...plan.metadata, requirements: [...plan.metadata.requirements], localSkillId: plan.skillId, publicationTarget: undefined, marketSkillId: plan.marketSkillId || plan.metadata.skillId });
        setPreparingFrom(plan); setConfirmed(false); setCreating(true);
    });
    const newDraft = () => { setPreparingFrom(null); setSelected(""); setError(""); setParams({ tab: "publish" }); setCreating(true); form.resetFields(); };
    const closeForm = () => { setCreating(false); if (params.has("skillId")) setParams({ tab: "publish" }); };
    const connectAuthorization = () => run(async () => {
        const value = await startMarketAuthorization(); setAuth(value);
        if (value.verificationUrl) await openSkillWebsite(value.verificationUrl);
    });
    return <>
        {renderHeader({
            search: { value: query, onChange: setQuery, placeholder: "Search for contributions" },
            createItems: [{ key: "publish", label: "New submission", onClick: newDraft }],
            actions: <>
                <button type="button" className="assets-header-compact-button" aria-label="Refresh submission" title="Refresh submission" disabled={loading || busy} aria-busy={loading} onClick={() => void reload()}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></button>
                <Dropdown trigger={["click"]} menu={{ items: [
                    { key: "status", label: auth.connected ? "Account is connected" : "Account not connected", disabled: true },
                    { key: "authorization", label: "Check connection status", onClick: reload },
                    { key: "website", label: "View submissions on the official website", onClick: () => void run(() => openSkillWebsite(`${website}/mine`)) },
                    ...(auth.connected ? [{ type: "divider" as const }, { key: "disconnect", label: "Disconnect account", onClick: () => void run(async () => { await disconnectMarketAuthorization(); setAuth({ connected: false }); setSubmissions([]); }) }] : []),
                ] }}><button type="button" className="assets-header-compact-button" aria-label="Contribution account and more operations" title="Contribution account and more operations" disabled={busy}><CircleUserRound className="size-4" /></button></Dropdown>
            </>,
        })}
        <section className="skill-market-content" aria-label="Skills submission">
        {!loading && remoteError ? <Alert type="warning" showIcon title={remoteError} className="my-4" action={<Button size="small" onClick={reload}>Try again</Button>} /> : null}
        {!loading && auth.connected === false && !auth.userCode && !remoteError ? <Alert type="info" showIcon title="Synchronize historical submissions after connecting to your submission account" className="my-4" action={<Button size="small" loading={busy} onClick={() => void connectAuthorization()}>Connect account</Button>} /> : null}
        {auth.userCode && !auth.connected ? <div className="skill-publish-authorization"><span>Check the confirmation code on the official website<strong>{auth.userCode}</strong>, return after authorization.</span><Button size="small" disabled={busy || loading} onClick={reload}>I have authorized</Button></div> : null}
        {error && !creating && !current && !currentSubmission ? <Alert type="error" showIcon title={error} className="mb-4" /> : null}
        {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
        <AppModal scrollBody open={creating} title={preparingFrom ? "Modify submission" : "New submission"} onCancel={closeForm} footer={null} width={720}>
        {error ? <Alert type="error" showIcon title={error} className="mb-4" /> : null}
        <p className="skill-publish-intro">Prepare a local draft first, and then confirm the upload and public release after checking the files.</p>
        <Form form={form} layout="vertical" className="skill-publish-form workspace-form" onFinish={makePlan} scrollToFirstError={{ focus: true, block: "center" }} initialValues={{ versionLabel: "1.0.0", requirements: [], sourceUrl: "", publicationTarget: "new" }}>
            {preparingFrom ? <Alert type="info" title="Keep the file and version from the original. After modification, a new local draft will be generated, and the original draft will be retained; please recheck and confirm the upload." className="mb-4" /> : null}
            <Form.Item name="localSkillId" label="Select native skills" rules={[{ required: true, message: "Please select a skill" }]}><Select disabled={Boolean(preparingFrom)} onChange={selectSkill} options={skills.filter(skill => skill.sourceType !== "market").map(skill => ({ value: skill.skillId, label: skill.skillName }))} /></Form.Item>
            <Form.Item name="publicationTarget" label="Submission goal" rules={[{ required: true, message: "Please clearly select the goal of this submission" }]} extra="To rewrite other people's skills, please select a new skill and fill in the source link."><Select options={[{ value: "new", label: "Publish new skills" }, { value: "existing", label: "New releases for my market skills" }]} /></Form.Item>
            {publicationTarget === "existing" ? <Form.Item name="marketSkillId" label="Already have a market skill number" extra="Open your published skill on the official website and copy the skill number from the page link. Please do not fill in the local skill number." rules={[{ required: true, message: "Please fill in your published market skill number" }, { validator: (_, value) => value === form.getFieldValue("localSkillId") ? Promise.reject(new Error("This is the local skill number; please choose to publish a new skill when submitting for the first time.")) : Promise.resolve() }]}><Input /></Form.Item> : null}
            <Form.Item name="name" label="public name" rules={[{ required: true, message: "Please fill in the public name" }]}><Input maxLength={80} /></Form.Item>
            <Form.Item name="description" label="Skill introduction" rules={[{ required: true, message: "Please describe the input, output and usage scenarios" }]}><Input.TextArea rows={3} maxLength={1024} /></Form.Item>
            <div className="grid gap-x-4 sm:grid-cols-2"><Form.Item name="versionLabel" label="Version" rules={[{ required: true, message: "Please fill in the version" }]}><Input maxLength={64} /></Form.Item><Form.Item name="license" label="license" rules={[{ required: true, message: "Please select the license you are entitled to adopt" }]}><Select options={["MIT", "Apache-2.0", "CC-BY-4.0", "CC-BY-SA-4.0", "CC0-1.0"].map(value => ({ value, label: value }))} /></Form.Item></div>
            <Form.Item name="sourceUrl" label="Source link (please fill in when rewriting other people's content)" rules={[{ type: "url", message: "Please fill in the complete link" }]}><Input /></Form.Item>
            <Form.Item name="requirements" label="Necessary tools and understanding" extra="Leave blank for text-only skills. Please remove any unconfirmed options; specific conditions of use are written below." rules={[{ validator: (_, value: string[] = []) => unsupportedRequirements(value).length ? Promise.reject(new Error("Please remove unconfirmed abilities; just leave text-only skills blank.")) : Promise.resolve() }]}><Select mode="multiple" allowClear options={[...capabilityOptions, ...unsupportedRequirements(formRequirements).map(value => ({ value, label: requirementLabel(value) }))]} /></Form.Item>
            <Form.Item name="requirementNotes" label="Model, material and cost description"><Input.TextArea rows={3} maxLength={1000} placeholder="For example: Use the image understanding model to check the reference image, and when generating the video, you will be billed based on the selected model." /></Form.Item>
            <p className="skill-publish-note">Please confirm that the content has been trialled and does not contain keys, private materials, or content that you are not authorized to share.</p><div className="skill-market-actions"><Button type="primary" loading={busy} onClick={() => form.submit()}>Prepare file preview</Button><Button onClick={closeForm}>Cancel</Button></div>
        </Form>
        </AppModal>
        {!loading ? visiblePublications.length ? <div className="skill-publish-drafts">
            {visiblePublications.map(item => <article className="workspace-list-row" key={item.key}>
                <div className="workspace-list-copy"><h2><button type="button" className="workspace-item-title" onClick={() => setSelected(item.plan?.planId || item.key)}>{item.metadata.name}</button></h2></div>
                <div className="workspace-list-controls"><span className="skill-market-state">{publicationStatus(item.status)}</span><Button size="small" onClick={() => setSelected(item.plan?.planId || item.key)}>View details</Button></div>
            </article>)}
        </div> : !error && !remoteError ? <p className="skill-market-empty">{keyword ? "No matching contributions" : auth.connected ? "If you haven't submitted a post yet, you can create a new one from the upper right corner." : "There are currently no draft submissions for this machine."}</p> : null : null}
        <AppModal flush scrollBody className="skill-release-dialog" wrapClassName="skill-release-wrap" open={Boolean(currentSubmission) && !creating} title={currentSubmission?.metadata.name || "Submission details"} onCancel={() => { setSelected(""); setParams({ tab: "publish" }); }} footer={currentSubmission ? <div className="skill-publish-footer">{error ? <Alert type="error" showIcon title={error} /> : null}<Button onClick={() => void run(() => openSkillWebsite(`${website}/submissions/${encodeURIComponent(currentSubmission.submissionId)}`))}>View manuscripts on the official website</Button></div> : null} width="min(760px, calc(100vw - 32px))">
            {currentSubmission ? <PublicationDetailContent key={currentSubmission.submissionId} metadata={currentSubmission.metadata} status={currentSubmission.status} notices={currentSubmission.reviewReason ? <Alert type="info" title="Historical Notes" description={currentSubmission.reviewReason} /> : null}>
                <section className="skill-release-section"><SkillFileDetails files={currentSubmission.files || []} info={[{ label: "Submission number", value: currentSubmission.submissionId }]} /></section>
            </PublicationDetailContent> : null}
        </AppModal>
        <AppModal flush scrollBody className="skill-release-dialog" wrapClassName="skill-release-wrap" open={Boolean(current) && !creating} title={current?.metadata.name || "Submission details"} onCancel={() => { setSelected(""); setParams({ tab: "publish" }); }} width="min(760px, calc(100vw - 32px))" footer={current ? <div className="skill-publish-footer">
                {authorizationRequired && !auth.connected ? <Alert type="warning" showIcon title="Please close the details first and connect to your submission account." /> : null}
                {current.status === "awaiting_upload_confirmation" || current.status === "uploading" ? <Checkbox checked={confirmed} onChange={e => setConfirmed(e.target.checked)}>I have checked the file and sharing permissions to confirm that the upload is a private draft.</Checkbox> : null}
                {current.status === "awaiting_submit_confirmation" ? <Checkbox checked={confirmed} onChange={e => setConfirmed(e.target.checked)}>I have checked the above content and confirmed the public release of this skill.</Checkbox> : null}
                <div className="skill-market-actions">
                    {!current.submissionId && current.status === "awaiting_upload_confirmation" ? <Button disabled={busy} onClick={() => void reprepare(current)}>Modify information and prepare again</Button> : null}
                    {current.submissionId ? <><Button loading={busy} onClick={() => void run(async () => replace(await refreshPublication(current.planId)))}>Refresh preview and publishing status</Button><Button onClick={() => void run(() => openSkillWebsite(`${website}/submissions/${encodeURIComponent(current.submissionId!)}`))}>Modify the manuscript on the official website</Button></> : null}
                    {current.status === "awaiting_upload_confirmation" || current.status === "uploading" ? <Button type="primary" disabled={!confirmed || !auth.connected || needsPublicationTargetCorrection(current) || unsupportedRequirements(current.metadata.requirements).length > 0} loading={busy} onClick={() => void run(async () => { replace(await uploadPublication(current)); message.success("The private draft has been uploaded, please check the preview and confirm publishing."); })}>Confirm upload of private draft</Button> : null}
                    {current.status === "awaiting_submit_confirmation" ? <Button type="primary" disabled={!canSubmitPublication(current, confirmed)} loading={busy} onClick={() => {
                        if (!auth.connected) { setAuthorizationRequired(true); return; }
                        void run(async () => { replace(await submitPublication(current)); message.success("Published to skills market"); });
                    }}>Confirm release</Button> : null}
                </div>
            </div> : null}>
            {current ? <PublicationDetailContent key={current.planId} metadata={current.metadata} status={current.status} author={current.preview?.author} notices={<>
                {error ? <Alert type="error" showIcon title={error} /> : null}
                {needsPublicationTargetCorrection(current) ? <Alert type="warning" title="Please modify the information and clearly select the submission target, and then prepare again. Originals and documents will continue to be retained." /> : null}
                {unsupportedRequirements(current.metadata.requirements).length ? <Alert type="warning" title="This draft contains unconfirmed conditions of use, please revise the information and prepare again. Pure text skills require no additional comprehension skills." /> : null}
                {current.preview?.warnings?.map(value => <Alert key={value} type="warning" title={value} />)}
                {current.reviewReason ? <Alert type="info" title="Historical Notes" description={current.reviewReason} /> : null}
            </>}>
                <section className="skill-release-section"><details><summary>Submission information</summary>
                    <p>The submission target is{current.publicationTarget === "existing" ? "New version of existing market skills" : needsPublicationTargetCorrection(current) ? "Need confirmation" : "Publish new skills"}</p>
                    {current.metadata.sourceUrl ? <p>Source link{current.metadata.sourceUrl}</p> : null}
                </details></section>
                {current.instruction ? <section className="skill-release-section"><details className="skill-release-instructions"><summary>Instructions for use</summary><SkillReleaseMarkdown content={current.instruction} /></details></section> : null}
                <section className="skill-release-section"><SkillFileDetails files={current.files} info={[{ label: "Compressed package SHA-256", value: current.archiveSha256 }, { label: "Native draft number", value: current.planId }, { label: "Native skill number", value: current.skillId }, { label: "Native version number", value: current.versionId }, { label: "Market Skills Number", value: current.marketSkillId }, { label: "Submission number", value: current.submissionId }, { label: "Preview summary", value: current.preview?.previewDigest }]} /></section>
            </PublicationDetailContent> : null}
        </AppModal>
        </section>
    </>;
}
