import { AppModal } from "@/components/ui/product/app-modal";
import type { CreationConversation } from "./creation-types";

export type CreationConflictPreview = {
    title: string;
    messageCount: number;
    excerpt: string;
};

export function creationConflictPreview(conversation: { title?: string; messages?: Array<{ role?: string; content?: string }> } | undefined): CreationConflictPreview {
    const messages = conversation?.messages || [];
    const lastUser = [...messages].reverse().find((item) => item.role === "user" && String(item.content || "").trim());
    const excerpt = String(lastUser?.content || "").trim().replace(/\s+/g, " ");
    return {
        title: String(conversation?.title || "").trim() || "Unnamed conversation",
        messageCount: messages.length,
        excerpt: excerpt ? (excerpt.length > 42 ? `${excerpt.slice(0, 41)}…` : excerpt) : "No text yet",
    };
}

export function CreationConflictBanner({
    parked,
    onReview,
    onUseSaved,
    onRestoreParked,
}: {
    parked?: boolean;
    onReview: () => void;
    onUseSaved: () => void;
    onRestoreParked?: () => void;
}) {
    if (parked) {
        return (
            <div className="creation-conflict-banner" role="status">
                <p>Changed to saved version. The draft just now is still there, you can change it back again.</p>
                <div className="creation-conflict-banner-actions">
                    <button type="button" onClick={onRestoreParked}>Restore the previous draft</button>
                </div>
            </div>
        );
    }
    return (
        <div className="creation-conflict-banner" role="status">
            <p>This conversation is different from the saved version. Look at both sides before deciding which one to use.</p>
            <div className="creation-conflict-banner-actions">
                <button type="button" onClick={onReview}>look both sides</button>
                <button type="button" onClick={onUseSaved}>Use saved version</button>
            </div>
        </div>
    );
}

export function CreationConflictDialog({
    open,
    local,
    remote,
    onClose,
    onUseSaved,
    onUseLocal,
}: {
    open: boolean;
    local?: CreationConversation;
    remote?: CreationConversation;
    onClose: () => void;
    onUseSaved: () => void;
    onUseLocal: () => void;
}) {
    const localPreview = creationConflictPreview(local);
    const remotePreview = creationConflictPreview(remote);
    return (
        <AppModal
            open={open}
            title="There are two versions"
            onCancel={onClose}
            footer={null}
            centered
            width="min(560px, calc(100vw - 32px))"
            className="creation-conflict-modal"
        >
            <div className="creation-conflict-dialog">
                <p className="creation-conflict-lead">First look at the title on both sides and the most recent sentence. When working with a saved version, the draft remains and can be changed back later.</p>
                <div className="creation-conflict-cards">
                    <section className="creation-conflict-card">
                        <h3>this draft</h3>
                        <p className="creation-conflict-title">{localPreview.title}</p>
                        <p>{localPreview.messageCount}  messages</p>
                        <p className="creation-conflict-excerpt">{localPreview.excerpt}</p>
                    </section>
                    <section className="creation-conflict-card">
                        <h3>saved version</h3>
                        <p className="creation-conflict-title">{remotePreview.title}</p>
                        <p>{remotePreview.messageCount}  messages</p>
                        <p className="creation-conflict-excerpt">{remotePreview.excerpt}</p>
                    </section>
                </div>
                <div className="creation-conflict-dialog-actions">
                    <button type="button" onClick={onUseLocal}>Replace the saved version with this draft</button>
                    <button type="button" className="is-primary" onClick={onUseSaved}>Use saved version</button>
                    <button type="button" className="is-quiet" onClick={onClose}>Don't deal with it yet</button>
                </div>
            </div>
        </AppModal>
    );
}
