import { FolderKanban, RotateCcw } from "lucide-react";

import { isTaskRegenerateBlocked } from "@/lib/task-outcome";
import type { GenerationTask } from "@/services/api/task-center";
import { isTaskFailed } from "./task-shared";

export type TaskGroup = { key: string; title: string; projectName: string; tasks: GenerationTask[] };

export function TaskGroupHeader({ group, retrying = false, onRetryFailed }: { group: TaskGroup; retrying?: boolean; onRetryFailed: () => void }) {
    const succeeded = group.tasks.filter((task) => task.status === "succeeded").length;
    const active = group.tasks.filter((task) => task.status === "queued" || task.status === "running").length;
    const failed = group.tasks.filter((task) => isTaskFailed(task) && !isTaskRegenerateBlocked(task)).length;
    const title = group.projectName ? `${group.title} · ${group.projectName}` : group.title;
    return (
        <div className="task-group-head">
            <span className="task-group-ic">
                <FolderKanban />
            </span>
            <div className="min-w-0">
                <div className="task-group-name">
                    <span>{title}</span>
                    <span className="task-group-count">
                                                total{group.tasks.length}  Item · Completed{succeeded}
                    </span>
                </div>
                <span className="task-group-sub">
                    {active ? <span>{active}  Running</span> : null}
                    {active && failed ? <span aria-hidden="true"> · </span> : null}
                    {failed ? <b className="is-bad">{failed}  failed</b> : null}
                    {(active || failed) && succeeded ? <span aria-hidden="true"> · </span> : null}
                    {succeeded ? <span>{succeeded}  Completed</span> : null}
                    {!active && !failed && !succeeded ? "No tasks in progress" : null}
                </span>
            </div>
            {failed ? (
                <button type="button" className="task-group-reset" disabled={retrying} onClick={onRetryFailed}>
                    <RotateCcw className={retrying ? "animate-spin" : undefined} />
                    {retrying ? "Trying again..." : "Retry failed task"}
                </button>
            ) : null}
        </div>
    );
}
