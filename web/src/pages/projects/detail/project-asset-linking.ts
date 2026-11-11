export async function linkSelectedProjectAssets<T>(ids: string[], linkOne: (id: string) => Promise<T>) {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!uniqueIds.length) throw new Error("Please select the material you want to quote");

    const results = await Promise.allSettled(uniqueIds.map(linkOne));
    const linked = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (!linked.length) {
        const firstFailure = failures[0];
        throw firstFailure instanceof Error ? firstFailure : new Error("Material reference failed, please try again");
    }
    return { linked, failedCount: failures.length };
}
