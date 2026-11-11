export type MissingExportFile = {
    owner: string;
    reference: string;
};

/** Incomplete archives cannot safely serve as a backup. Keep every missing reference. */
export class ExportIntegrityError extends Error {
    readonly missingFiles: MissingExportFile[];

    constructor(missingFiles: MissingExportFile[]) {
        const unique = uniqueMissingExportFiles(missingFiles);
        super(`Export not completed: missing${unique.length} files, an incomplete backup was not generated. Please retrieve the following files and try again:${unique.map((item) => `${item.owner}：${item.reference}`).join("\n")}`);
        this.name = "ExportIntegrityError";
        this.missingFiles = unique;
    }
}

export function uniqueMissingExportFiles(missingFiles: MissingExportFile[]): MissingExportFile[] {
    return [...new Map(missingFiles.map((item) => [JSON.stringify([item.owner, item.reference]), item])).values()]
        .sort((a, b) => a.owner.localeCompare(b.owner) || a.reference.localeCompare(b.reference));
}

export function assertUniqueArchiveNames(names: Iterable<string>): void {
    const seen = new Set<string>();
    for (const name of names) {
        if (seen.has(name)) throw new Error(`There is a file with the same name in the export package and it is not saved:${name}`);
        seen.add(name);
    }
}

const ARCHIVE_EXTENSION_BY_MIME: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "audio/mp4": "mp4",
    "video/webm": "webm",
    "audio/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "model/gltf-binary": "glb",
    "model/gltf+json": "gltf",
};

export function archiveFileExtension(mimeType: string, fallback: "png" | "bin" | "wav" | "mp3"): string {
    const mime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    return ARCHIVE_EXTENSION_BY_MIME[mime] ?? fallback;
}
