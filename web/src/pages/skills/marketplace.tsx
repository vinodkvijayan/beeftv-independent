import { App, Alert, Button, Dropdown, Select, Skeleton, Tooltip } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { CollectionHeader } from "@/components/layout/collection-header";
import { AppModal } from "@/components/ui/product/app-modal";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { addSkill, deleteSkill, getSkill, installGitHubSkill, likeSkill, listSkills, removeSkill, syncSkill, unlikeSkill, type Skill } from "@/services/api/skills";
import { getAssistantSettings, isAssistantSettingsUnavailableError, updateAssistantSettings } from "@/services/api/assistant-settings";
import { forkSkill, getInstalledVersions, getMarketRelease, getPublicSkillsAbout, installMarketRelease, rollbackSkill, searchPublicSkillMarket, searchSkillMarket, type InstalledVersion, type MarketItem, type MarketRelease, type PublicMarketSkill } from "@/services/api/skill-market";
import { SkillEditorDrawer } from "./skill-editor-drawer";
import { SkillInstallModal } from "./skill-install-modal";
import { SkillDetailModal } from "./skill-detail-drawer";
import { SkillMarketInstallConfirmModal, isOfficialBuiltinMarketSkill, type SkillMarketInstallConfirmRequest } from "./skill-market-install-confirm-modal";
import { SkillPublishingPanel } from "./publishing-panel";
import { MarketFilePreview } from "./market-file-preview";
import { SkillFileDetails } from "./skill-file-details";
import { skillFailureMessage } from "./skill-feedback";
import { canInstallMarketRelease, isPublicMarketSkillInstalled, marketInstallationState, releaseUnsupportedReasons, requirementLabel } from "./market-copy";
import { ExternalLink, MoreHorizontal, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/base/switch";
import { fallbackSkillCategories, formatSkillCount, skillOrigin } from "./skill-catalog";
import "./marketplace.css";

const SKILL_PAGE_SIZE = 20;

export default function SkillMarketplace() {
    const { message, modal } = App.useApp();
    const [params, setParams] = useSearchParams();
    const tab = ["market", "mine", "publish"].includes(params.get("tab") || "") ? params.get("tab")! : "market";
    const [items, setItems] = useState<MarketItem[]>([]);
    const [publicItems, setPublicItems] = useState<PublicMarketSkill[]>([]);
    const [publicNotice, setPublicNotice] = useState("");
    const [marketSource, setMarketSource] = useState<"all" | "beeftv" | "public">("all");
    const [publicDetail, setPublicDetail] = useState<PublicMarketSkill | null>(null);
    const [installed, setInstalled] = useState<Skill[]>([]);
    const [installedLoading, setInstalledLoading] = useState(true);
    const [installedError, setInstalledError] = useState("");
    const [installingRelease, setInstallingRelease] = useState("");
    const installing = useRef(false);
    const [local, setLocal] = useState<Skill[]>([]);
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    const [busy, setBusy] = useState(false);
    const [release, setRelease] = useState<MarketRelease | null>(null);
    const [detail, setDetail] = useState<Skill | null>(null);
    const [edit, setEdit] = useState<Skill | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [installOpen, setInstallOpen] = useState(false);
    const [pendingInstall, setPendingInstall] = useState<{ request: SkillMarketInstallConfirmRequest; onRun: () => void } | null>(null);
    const [versions, setVersions] = useState<{ skill: Skill; items: InstalledVersion[] } | null>(null);
    const [versionId, setVersionId] = useState("");
    const [scriptAutoRun, setScriptAutoRun] = useState(false);
    const [scriptLoadState, setScriptLoadState] = useState<"loading" | "ready" | "error" | "unavailable">("loading");
    const [scriptLoadError, setScriptLoadError] = useState("");
    const [scriptReloadKey, setScriptReloadKey] = useState(0);
    const [scriptSaving, setScriptSaving] = useState(false);
    const reload = useCallback(() => setRevision(n => n + 1), []);
    const changeTab = (next: string) => { setParams({ tab: next }); setPage(1); setQuery(""); };
    useEffect(() => {
        let cancelled = false;
        setScriptLoadState("loading");
        setScriptLoadError("");
        getAssistantSettings()
            .then((settings) => {
                if (cancelled) return;
                setScriptAutoRun(settings.skillScriptAutoRun);
                setScriptLoadState("ready");
            })
            .catch((err) => {
                if (cancelled) return;
                if (isAssistantSettingsUnavailableError(err)) { setScriptLoadState("unavailable"); return; }
                // 读取失败时不能沿用默认 OFF，否则会把实际已开启的设置显示成需要确认。
                setScriptLoadState("error");
                setScriptLoadError(err instanceof Error ? err.message : "Failed to read skill script settings");
            });
        return () => { cancelled = true; };
    }, [scriptReloadKey]);
    const toggleScriptAutoRun = async (checked: boolean) => {
        setScriptSaving(true);
        try {
            const settings = await updateAssistantSettings({ skillScriptAutoRun: checked });
            setScriptAutoRun(settings.skillScriptAutoRun);
            message.success(settings.skillScriptAutoRun ? "Automatically running skill scripts has been turned on" : "Automatically running skill scripts is turned off");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "Failed to save skill script settings");
        } finally {
            setScriptSaving(false);
        }
    };
    useEffect(() => {
        if (tab === "publish") return;
        let stale = false;
        setLoading(true); setError("");
        const timer = setTimeout(() => {
            const clampPage = (nextTotal: number) => {
                setTotal(nextTotal);
                const maxPage = Math.max(1, Math.ceil(nextTotal / SKILL_PAGE_SIZE));
                if (page > maxPage) { setPage(maxPage); return false; }
                return true;
            };
            const work = tab === "market"
                ? Promise.allSettled([searchSkillMarket(query, page), searchPublicSkillMarket(query)]).then(([hubRes, pubRes]) => {
                    if (stale) return;
                    const hubItems = hubRes.status === "fulfilled" ? (hubRes.value.items || []) : [];
                    const hubTotal = hubRes.status === "fulfilled" ? hubRes.value.total : 0;
                    const pubItems = pubRes.status === "fulfilled" ? (pubRes.value.items || []) : [];
                    const notice = pubRes.status === "fulfilled" ? (pubRes.value.notice || "") : "";
                    if (hubRes.status === "rejected" && pubRes.status === "rejected") {
                        setError(hubRes.reason?.message || "Temporarily unable to read skills");
                        return;
                    }
                    setPublicItems(pubItems);
                    setPublicNotice(notice || (hubRes.status === "rejected" ? "The skill market service is temporarily unavailable, and a snapshot of the public skill catalog is currently displayed." : ""));
                    if (clampPage(hubTotal)) setItems(hubItems);
                })
                : listSkills({ scope: "mine", page, pageSize: SKILL_PAGE_SIZE, search: query }).then(value => { if (!stale && clampPage(value.totalCount)) setLocal(value.skills); });
            void work.catch(e => { if (!stale) setError(e.message || "Temporarily unable to read skills"); }).finally(() => { if (!stale) setLoading(false); });
        }, 200);
        return () => { stale = true; clearTimeout(timer); };
    }, [tab, page, query, revision]);
    useEffect(() => {
        if (tab !== "market") return;
        let stale = false;
        setInstalledLoading(true);
        setInstalledError("");
        void (async () => {
            const skills: Skill[] = [];
            for (let page = 1; ; page++) {
                const result = await listSkills({ scope: "mine", page, pageSize: 100 });
                if (stale) return;
                skills.push(...result.skills);
                if (!result.hasMore) break;
            }
            if (!stale) setInstalled(skills);
        })().catch(error => { if (!stale) setInstalledError(skillFailureMessage(error, "Unable to read installation status", "Please refresh the skill market and try again.")); })
            .finally(() => { if (!stale) setInstalledLoading(false); });
        return () => { stale = true; };
    }, [tab, revision]);
    useEffect(() => {
        const skillId = params.get("skillId"), releaseId = params.get("releaseId");
        if (!skillId || !releaseId) return;
        let stale = false;
        setBusy(true); setRelease(null);
        void getMarketRelease(skillId, releaseId).then(value => { if (!stale) setRelease(value); })
            .catch(e => { if (!stale) message.error(skillFailureMessage(e, "Unable to open skill version", "Please refresh the skill market and reopen it.")); })
            .finally(() => { if (!stale) setBusy(false); });
        return () => { stale = true; };
    }, [params, message]);
    const action = async (work: () => Promise<unknown>, done?: string, failure = "Operation not completed", nextStep = "Please keep the current content and try again later.") => {
        setBusy(true);
        try { await work(); if (done) { message.success(done); reload(); } } catch (e) { message.error(skillFailureMessage(e, failure, nextStep)); } finally { setBusy(false); }
    };
    const openLocal = async (skill: Skill) => action(async () => { setDetail((await getSkill(skill.skillId)).skill); }, undefined, "Unable to open skill details", "Please refresh \"My Skills\" and reopen it.");
    const openEditor = (skill?: Skill) => { setDetail(null); setEdit(skill || null); setEditorOpen(true); };
    const openRelease = (skillId: string, releaseId: string) => setParams({ tab: "market", skillId, releaseId });
    const deleteLocal = (skill: Skill) => modal.confirm({ title: `Delete the local "${skill.skillName}”？`, content: "Native skill files and historical versions will be deleted. The version in the open market will not change.", okText: "Delete local skills", cancelText: "Cancel", okButtonProps: { danger: true }, onOk: async () => { await deleteSkill(skill.skillId); setDetail(null); reload(); } });
    const showVersions = async (skill: Skill) => action(async () => { const value = await getInstalledVersions(skill.skillId); setVersions({ skill, items: value.versions }); setVersionId(skill.versionId); }, undefined, "Unable to read historical version", "Please close the version window and try again.");
    const install = (target: Pick<MarketRelease, "skillId" | "releaseId">, showMine: boolean) => {
        if (installing.current) return;
        installing.current = true;
        setInstallingRelease(target.releaseId);
        void action(async () => {
            const { skill } = await installMarketRelease(target.skillId, target.releaseId);
            setInstalled(previous => [skill, ...previous.filter(item => item.skillId !== skill.skillId)]);
            if (showMine) { setRelease(null); changeTab("mine"); }
        }, "Already installed and available for use in Canvas Assistant", "Installation not completed", "Please check the reason for the failure and try again, or open the skill details to check the usage conditions.")
            .finally(() => { installing.current = false; setInstallingRelease(""); });
    };
    const requestInstall = (target: Pick<MarketItem, "skillId" | "releaseId" | "name" | "versionLabel" | "author" | "description">, showMine: boolean) => {
        if (isOfficialBuiltinMarketSkill(target, installed)) {
            install(target, showMine);
            return;
        }
        setPendingInstall({
            onRun: () => install(target, showMine),
            request: {
                skillId: target.skillId,
                releaseId: target.releaseId,
                name: target.name,
                versionLabel: target.versionLabel,
                author: target.author,
                description: target.description,
                isUpdate: marketInstallationState(target, installed) === "update",
            },
        });
    };
    const installPublic = (item: PublicMarketSkill, showMine: boolean) => {
        if (installing.current) return;
        installing.current = true;
        setInstallingRelease(item.id);
        void action(async () => {
            const { skill } = await installGitHubSkill({
                url: item.sourceUrl || `https://github.com/${item.source}`,
                subdir: item.skillId,
                tag: "others",
                isPrivate: true,
                autoUpdate: true,
            });
            setInstalled(previous => [skill, ...previous.filter(existing => existing.skillId !== skill.skillId)]);
            if (showMine) { setPublicDetail(null); changeTab("mine"); }
        }, "The skill is installed from GitHub and can be selected for use in the Canvas Assistant", "GitHub skills installation is not completed", "Please check the network connection or warehouse address and try again.")
            .finally(() => { installing.current = false; setInstallingRelease(""); });
    };
    const requestPublicInstall = (item: PublicMarketSkill, showMine: boolean) => {
        setPendingInstall({
            onRun: () => installPublic(item, showMine),
            request: {
                skillId: item.skillId,
                name: item.name,
                sourceRepo: item.source,
                sourceLabel: "Public skills directory",
                description: item.description || `From GitHub repository${item.source}（${formatSkillCount(item.installs)} installation)`,
            },
        });
    };
    const openPublicSkill = (item: PublicMarketSkill) => {
        setPublicDetail(item);
        if (!item.description) {
            void getPublicSkillsAbout([item.id]).then((res) => {
                const desc = res.about?.[item.id];
                if (!desc) return;
                setPublicItems((prev) => prev.map((entry) => (entry.id === item.id ? { ...entry, description: desc } : entry)));
                setPublicDetail((prev) => (prev && prev.id === item.id ? { ...prev, description: desc } : prev));
            }).catch(() => {});
        }
    };
    const releaseInstallation = release ? marketInstallationState(release, installed) : "install";
    const releaseItem = release ? items.find(item => item.skillId === release.skillId && item.releaseId === release.releaseId) : undefined;
    const releaseUnsupported = release ? releaseUnsupportedReasons(release, releaseItem?.compatibility) : [];
    const publicDetailInstalled = publicDetail ? isPublicMarketSkillInstalled(publicDetail, installed) : false;
    const visibleMarketItems = marketSource === "public" ? [] : items;
    const visiblePublicItems = marketSource === "beeftv" ? [] : publicItems;
    const scriptAutoRunControl = scriptLoadState === "unavailable" ? undefined : (
        <div className="skill-script-autorun" role="group" aria-label="Skill script settings">
            {scriptLoadState === "error" ? (
                <Tooltip title={scriptLoadError || "Failed to read skill script settings and cannot be modified temporarily."} placement="bottomRight">
                    <span id="skill-script-autorun-error" role="status" className="skill-script-autorun-error">
                                                Read failed
                        <button type="button" className="skill-script-autorun-retry" onClick={() => setScriptReloadKey((key) => key + 1)}>Try again</button>
                    </span>
                </Tooltip>
            ) : null}
            <Tooltip title="After opening, the assistant will no longer ask before running the script in the skill. The script runs in the skill copy and cannot get your API Key." placement="bottomRight">
                <label className="skill-script-autorun-toggle">
                    <span>Automatically run skill scripts</span>
                    <Switch
                        size="sm"
                        checked={scriptAutoRun}
                        loading={scriptLoadState === "loading" || scriptSaving}
                        disabled={scriptLoadState !== "ready" || scriptSaving}
                        aria-label="Automatically run skill scripts"
                        aria-describedby={scriptLoadState === "error" ? "skill-script-autorun-error" : undefined}
                        onChange={(checked) => void toggleScriptAutoRun(checked)}
                    />
                </label>
            </Tooltip>
        </div>
    );
    const headerProps = {
        title: "Skills",
        navigationLabel: "Skill classification",
        tabs: [{ value: "market", label: "skills market" }, { value: "mine", label: "my skills" }, { value: "publish", label: "my contribution" }],
        value: tab,
        onChange: changeTab,
        trailing: scriptAutoRunControl,
    };
    return <WorkspacePage className="skill-market-page collection-page" scroll={false}>
        {tab === "publish" ? <SkillPublishingPanel planId={params.get("planId") || undefined} renderHeader={controls => <CollectionHeader {...headerProps} {...controls} />} /> : <>
            <CollectionHeader
                {...headerProps}
                search={{ value: query, placeholder: "Search skills", onChange: (value) => { setQuery(value); setPage(1); } }}
                actions={<button type="button" className="assets-header-compact-button" aria-label="Refresh skills" title="Refresh skills" disabled={loading} aria-busy={loading} onClick={reload}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></button>}
                createItems={[
                    { key: "create", label: "Create skills", onClick: () => openEditor() },
                    { key: "import", label: "Import file", onClick: () => setInstallOpen(true) },
                ]}
            />
            <div className="skill-market-content">
            {tab === "market" ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <SegmentedControl size="sm" value={marketSource} onChange={(v) => setMarketSource(v as "all" | "beeftv" | "public")} options={[{ value: "all", label: "All sources" }, { value: "beeftv", label: "BeefTV Market" }, { value: "public", label: "Public skills directory" }]} />
            </div> : null}
            {tab === "market" && publicNotice && marketSource !== "beeftv" ? <Alert type="info" showIcon title={publicNotice} className="mb-3" /> : null}
            {error ? <Alert type="error" showIcon title={error} action={<Button size="small" onClick={reload}>Try again</Button>} /> : loading ? <Skeleton active paragraph={{ rows: 6 }} /> : <>
                {tab === "market" && installedError ? <Alert type="warning" showIcon title={installedError} className="mb-4" action={<Button size="small" onClick={reload}>Try again</Button>} /> : null}
                {tab === "market" ? <>
                    {visibleMarketItems.map(item => {
                        const installation = marketInstallationState(item, installed);
                        const installLabel = installation === "installed" ? "Installed" : installation === "update" ? "update" : "Installation";
                        const itemUnsupported = releaseUnsupportedReasons(item, item.compatibility);
                        const isOfficial = isOfficialBuiltinMarketSkill(item, installed);
                        return <article className="workspace-list-row" key={`${item.skillId}/${item.releaseId}`}>
                            <div className="workspace-list-copy">
                                <h2><button type="button" className="workspace-item-title" onClick={() => openRelease(item.skillId, item.releaseId)}>{item.name}</button></h2>
                            </div>
                            <div className="workspace-list-controls">
                                <Tooltip title={isOfficial ? "BeefTV official built-in skills" : `Author:${item.author || "Not provided"}`}><span className="skill-origin-label">{isOfficial ? "official" : "market"}</span></Tooltip>
                                <Button size="small" onClick={() => openRelease(item.skillId, item.releaseId)} disabled={busy}>View details</Button>
                                <Button type="primary" size="small" className="min-w-16" aria-label={`${installLabel}${item.name}`} loading={installingRelease === item.releaseId} disabled={!canInstallMarketRelease({ busy, installedLoading, installedError, installation, unsupportedReasons: itemUnsupported })} onClick={() => requestInstall(item, false)}>{installLabel}</Button>
                            </div>
                        </article>;
                    })}
                    {visiblePublicItems.map(item => {
                        const isInstalled = isPublicMarketSkillInstalled(item, installed);
                        const installLabel = isInstalled ? "Installed" : "Installation";
                        return <article className="workspace-list-row" key={`public:${item.id}`}>
                            <div className="workspace-list-copy">
                                <h2><button type="button" className="workspace-item-title" onClick={() => openPublicSkill(item)}>{item.name}</button></h2>
                            </div>
                            <div className="workspace-list-controls">
                                <Tooltip title={`Source warehouse:${item.source} · ${formatSkillCount(item.installs)} times installed`}><span className="skill-origin-label">market</span></Tooltip>
                                <Button size="small" onClick={() => openPublicSkill(item)} disabled={busy}>View details</Button>
                                <Button type="primary" size="small" className="min-w-16" aria-label={`${installLabel}${item.name}`} loading={installingRelease === item.id} disabled={busy || installedLoading || isInstalled} onClick={() => requestPublicInstall(item, false)}>{installLabel}</Button>
                            </div>
                        </article>;
                    })}
                </> : local.map(skill => {
                    const origin = skillOrigin(skill);
                    return <article className="workspace-list-row" key={skill.skillId}>
                    <div className="workspace-list-copy">
                        <h2><button type="button" className="workspace-item-title" onClick={() => void openLocal(skill)}>{skill.skillName}</button></h2>
                    </div>
                    <div className="workspace-list-controls">
                        <Tooltip title={origin.hint}><span className="skill-origin-label">{origin.label}</span></Tooltip>
                        <Button size="small" onClick={() => void openLocal(skill)} disabled={busy}>View details</Button>
                        <label className="skill-market-toggle"><span>{skill.isAdded ? "Enabled" : "Deactivated"}</span><Switch size="sm" aria-label={`enable${skill.skillName}`} checked={skill.isAdded} disabled={busy} onChange={() => void action(() => skill.isAdded ? removeSkill(skill.skillId) : addSkill(skill.skillId), skill.isAdded ? "Disabled and no longer available for assistant selection" : "Enabled")} /></label>
                        <Dropdown trigger={["click"]} menu={{ items: [
                            ...(skill.sourceType === "market" ? [
                                { key: "updates", label: "Check for updates", onClick: () => { changeTab("market"); setQuery(skill.skillName); } },
                                { key: "versions", label: "Historical version", onClick: () => void showVersions(skill) },
                                { key: "fork", label: "Create a private copy", onClick: () => void action(async () => openEditor((await forkSkill(skill.skillId)).skill), "Private copy created") },
                            ] : skill.sourceType === "builtin" && !skill.isOwner ? [
                                { key: "fork", label: "Create a private copy", onClick: () => void action(async () => openEditor((await forkSkill(skill.skillId)).skill), "Private copy created") },
                            ] : [
                                { key: "edit", label: "Editing skills", onClick: () => void action(async () => openEditor((await getSkill(skill.skillId)).skill), undefined, "Unable to open skill editor", "Please refresh \"My Skills\" and reopen it.") },
                                { key: "publish", label: "Share contribution", onClick: () => setParams({ tab: "publish", skillId: skill.skillId }) },
                            ]),
                            ...(skill.isOwner ? [{ type: "divider" as const }, { key: "delete", label: "Delete skills", danger: true, onClick: () => deleteLocal(skill) }] : []),
                        ] }}><Button type="text" size="small" aria-label={`management${skill.skillName}`} disabled={busy} icon={<MoreHorizontal className="size-4" />} /></Dropdown>
                    </div>
                </article>; })}
                {(tab === "mine" ? total === 0 : visibleMarketItems.length === 0 && visiblePublicItems.length === 0) ? <p className="skill-market-empty">{tab === "mine" ? "No skills yet. You can install it from the market, or import your own SKILL.md." : "No matching skills found."}</p> : null}
            </>}
            </div>
            {!loading && !error && (total > SKILL_PAGE_SIZE || page > 1) ? <nav className="skill-market-pagination" aria-label="Skill pagination"><Button disabled={page <= 1} onClick={() => setPage(n => n - 1)}>Previous page</Button><span>No.{page} / {Math.max(1, Math.ceil(total / SKILL_PAGE_SIZE))}  Pages · Total{total}  item</span><Button disabled={page * SKILL_PAGE_SIZE >= total} onClick={() => setPage(n => n + 1)}>Next page</Button></nav> : null}
        </>}
        <AppModal flush scrollBody className="skill-release-dialog" wrapClassName="skill-release-wrap" open={Boolean(release)} title={release?.name || "Skill details"} onCancel={() => { setRelease(null); setParams({ tab: "market" }); }} footer={<Button type="primary" loading={busy} disabled={!canInstallMarketRelease({ busy, installedLoading, installedError, installation: releaseInstallation, unsupportedReasons: releaseUnsupported })} onClick={() => { if (release) requestInstall(release, true); }}>{releaseInstallation === "installed" ? "Installed" : releaseInstallation === "update" ? "Update this version" : "Install this version"}</Button>} width="min(760px, calc(100vw - 32px))">
            {release ? <div className="skill-market-preview" tabIndex={0} role="region" aria-label="Skill details">
                <div className="skill-release-overview">
                    <dl className="skill-release-metadata">
                        <div><dt>Version</dt><dd>{release.versionLabel}</dd></div>
                        <div><dt>Author</dt><dd>{release.author || "Not provided"}</dd></div>
                        <div><dt>permission</dt><dd>{release.license}</dd></div>
                    </dl>
                    <p className="skill-release-description">{release.description}</p>
                </div>
                <div className="skill-release-sections">
                    <section className="skill-release-section" aria-label="Conditions of use">
                        <details open={releaseUnsupported.length > 0}><summary>Conditions of use</summary>
                            <p>{release.requirements.length ? release.requirements.map(requirementLabel).join("、") : "No additional tools required"}</p>
                            {release.requirementNotes ? <p>{release.requirementNotes}</p> : null}
                            {releaseUnsupported.length ? <p className="skill-market-warning">The current environment does not meet:{releaseUnsupported.join("、")}</p> : null}
                            {release.requirements.some(value => value.startsWith("model.")) ? <Alert type="info" title="Before use, you need to select a model that supports the required understanding capabilities in the model configuration. Installation does not imply that these conditions have been met." /> : null}
                        </details>
                    </section>
                    <section className="skill-release-section">
                        <details className="skill-release-notes"><summary>Installation and operation instructions</summary>
                            <p>Please confirm the model and cost according to the skill description. The installation only saves the file, and you choose the model when using it.</p><p>It will not run automatically after installation, nor will it switch models for you. Subsequent updates require confirmation again.</p>
                        </details>
                    </section>
                    <MarketFilePreview key={release.releaseId} skillId={release.skillId} releaseId={release.releaseId} />
                    <section className="skill-release-section" aria-label="Skill files and advanced information">
                        <SkillFileDetails files={release.files} info={[{ label: "content hash", value: release.contentHash }, { label: "Compressed package SHA-256", value: release.archiveSha256 }, { label: "Compressed package size (bytes)", value: release.archiveBytes }, { label: "Skill number", value: release.skillId }, { label: "version number", value: release.releaseId }]} />
                    </section>
                </div>
            </div> : null}
        </AppModal>
        <AppModal flush scrollBody className="skill-release-dialog" wrapClassName="skill-release-wrap" open={Boolean(publicDetail)} title={publicDetail?.name || "Skill details"} onCancel={() => setPublicDetail(null)} footer={<Button type="primary" loading={busy || Boolean(publicDetail && installingRelease === publicDetail.id)} disabled={installedLoading || publicDetailInstalled} onClick={() => { if (publicDetail) requestPublicInstall(publicDetail, true); }}>{publicDetailInstalled ? "Installed" : "Install this skill"}</Button>} width="min(760px, calc(100vw - 32px))">
            {publicDetail ? <div className="skill-market-preview" tabIndex={0} role="region" aria-label="Public skill details">
                <div className="skill-release-overview">
                    <dl className="skill-release-metadata">
                        <div><dt>Source warehouse</dt><dd><a href={publicDetail.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">{publicDetail.source}<ExternalLink className="size-3.5" /></a></dd></div>
                        <div><dt>Skill ID</dt><dd>{publicDetail.skillId}</dd></div>
                        <div><dt>Installation volume</dt><dd>{formatSkillCount(publicDetail.installs)}</dd></div>
                    </dl>
                    <p className="skill-release-description">{publicDetail.description || `From GitHub repository${publicDetail.source} public skills. After installation, SKILL.md and accompanying reference files will be read from this repository.`}</p>
                </div>
                <div className="skill-release-sections">
                    <section className="skill-release-section">
                        <details className="skill-release-notes" open><summary>Installation and operation instructions</summary>
                            <p>Install from GitHub repository{publicDetail.source}  Download skill files.</p>
                            <p>After installation, only the skill file is saved. You can view the complete file in "My Skills", manually synchronize the latest submission, or enable it to the canvas assistant.</p>
                        </details>
                    </section>
                </div>
            </div> : null}
        </AppModal>
        <AppModal scrollBody open={Boolean(versions)} title="Restore historical version of the machine" onCancel={() => setVersions(null)} onOk={() => { if (versions) void action(async () => { await rollbackSkill(versions.skill.skillId, versionId); setVersions(null); }, "The specified version has been restored"); }} okText="Restore this version" okButtonProps={{ disabled: !versions || versionId === versions.skill.versionId, loading: busy }}>
            <p>New conversations after restoration can select this version. Existing conversations retain the originally selected version.</p><Select className="w-full" value={versionId} onChange={setVersionId} options={versions?.items.map(v => ({ value: v.id, label: `${v.versionLabel} · ${v.createdAt.slice(0, 10)}${v.id === versions.skill.versionId ? "(current)" : ""}` }))} />
        </AppModal>
        <SkillDetailModal
            skill={detail}
            loading={false}
            mutating={busy}
            categories={fallbackSkillCategories}
            onClose={() => setDetail(null)}
            onEdit={openEditor}
            onAdd={(skill) => void action(async () => {
                const res = skill.isAdded ? await removeSkill(skill.skillId) : await addSkill(skill.skillId);
                setDetail(res.skill);
            }, skill.isAdded ? "Disabled and no longer available for assistant selection" : "Enabled")}
            onLike={(skill) => void action(async () => {
                const res = skill.isLike ? await unlikeSkill(skill.skillId) : await likeSkill(skill.skillId);
                setDetail(res.skill);
            })}
            onSync={(skill) => void action(async () => {
                const res = await syncSkill(skill.skillId);
                setDetail(res.skill);
            }, "Latest GitHub commits synced", "GitHub skill sync failed")}
        />
        <SkillEditorDrawer open={editorOpen} skill={edit} onClose={() => setEditorOpen(false)} onSaved={() => { setEditorOpen(false); changeTab("mine"); reload(); }} />
        <SkillInstallModal open={installOpen} onClose={() => setInstallOpen(false)} onManualCreate={() => { setInstallOpen(false); openEditor(); }} onInstalled={() => { setInstallOpen(false); changeTab("mine"); reload(); }} />
        <SkillMarketInstallConfirmModal
            open={Boolean(pendingInstall)}
            request={pendingInstall?.request ?? null}
            loading={busy || Boolean(installingRelease)}
            onCancel={() => setPendingInstall(null)}
            onConfirm={() => {
                if (!pendingInstall) return;
                const { onRun } = pendingInstall;
                setPendingInstall(null);
                onRun();
            }}
        />
    </WorkspacePage>;
}
