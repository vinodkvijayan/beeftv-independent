import { ArrowUpRight, Settings } from "lucide-react";
import { Link } from "react-router";
import { useUserStore } from "@/stores/use-user-store";
import { UserAvatar } from "./user-avatar";
import "./workspace-account-card.css";

/** 本地工作区账户卡片，只保留本地设置入口。 */
export function WorkspaceAccountCard({ onNavigate }: { onNavigate: () => void }) {
    const user = useUserStore((state) => state.user);
    if (!user) return null;
    return <section className="workspace-account-card" aria-label="my account">
        <header className="workspace-account-card-identity">
            <UserAvatar user={user} className="workspace-account-card-avatar" />
            <div><strong>{user.displayName || user.username}</strong><span>@{user.username}</span></div>
            <em>{user.role === "admin" ? "Administrator" : "Creator"}</em>
        </header>
        <nav className="workspace-account-card-actions" aria-label="Account operations">
            <Link to="/settings" onClick={onNavigate}><Settings /><span>local settings</span><ArrowUpRight /></Link>
        </nav>
    </section>;
}
