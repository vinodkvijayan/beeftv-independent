import { unzip, zip } from "fflate";

type ZipFile = {
    name: string;
    data: BlobPart;
};

/** Zip-bomb bounds already used by desktop update extraction. JS << is 32-bit. */
export const ARCHIVE_MAX_FILES = 50_000;
export const ARCHIVE_MAX_ENTRY_BYTES = 1024 * 1024 * 1024;
export const ARCHIVE_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

export function confinedArchivePath(name: string): string {
    if (!name || name.includes("\0") || name.includes("\\")) {
        throw new Error("The compressed package contains illegal paths");
    }
    if (name.startsWith("/") || name.startsWith("//") || /^[A-Za-z]:/.test(name)) {
        throw new Error("The compressed package contains out-of-bounds paths");
    }
    const parts = name.split("/").filter((part) => part.length > 0 && part !== ".");
    if (!parts.length || parts.some((part) => part === "..")) {
        throw new Error("The compressed package contains out-of-bounds paths");
    }
    return parts.join("/");
}

export async function createZip(files: ZipFile[]) {
    const names = new Set<string>();
    for (const file of files) {
        const path = confinedArchivePath(file.name);
        if (names.has(path)) throw new Error(`There is a file with the same name in the export package and it is not saved:${path}`);
        names.add(path);
    }
    const entries = await Promise.all(
        files.map(async (file) => {
            const data = new Uint8Array(await new Blob([file.data]).arrayBuffer());
            return [confinedArchivePath(file.name), data] as const;
        }),
    );
    const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(Object.fromEntries(entries), { level: 0 }, (error, result) => error ? reject(error) : resolve(result)));
    return new Blob([new Uint8Array(bytes)], { type: "application/zip" });
}

export async function readZip(file: Blob) {
    let total = 0;
    let count = 0;
    let entries: Record<string, Uint8Array>;
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => unzip(bytes, {
            filter(info) {
                confinedArchivePath(info.name);
                count += 1;
                if (count > ARCHIVE_MAX_FILES) throw new Error("The number of compressed files exceeds the limit");
                const size = info.originalSize || 0;
                if (size > ARCHIVE_MAX_ENTRY_BYTES) throw new Error("The compressed package file is too large");
                total += size;
                if (total > ARCHIVE_MAX_TOTAL_BYTES) throw new Error("The compressed package size exceeds the limit");
                return true;
            },
        }, (error, result) => error ? reject(error) : resolve(result)));
    } catch (error) {
        if (error instanceof Error && /非法路径|越界路径|超出限制|文件过大/.test(error.message)) throw error;
        throw new Error("Canvas backup is corrupted and cannot be imported");
    }
    const files = new Map<string, Blob>();
    for (const [name, data] of Object.entries(entries)) {
        const path = confinedArchivePath(name);
        if (files.has(path)) throw new Error(`There are files with the same name in the compressed package:${path}`);
        if (data.byteLength > ARCHIVE_MAX_ENTRY_BYTES) throw new Error("The compressed package file is too large");
        files.set(path, new Blob([new Uint8Array(data)]));
    }
    return files;
}
