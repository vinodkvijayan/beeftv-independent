import { useEffect, useState } from "react";
import { App, Button, Input, Upload, type UploadFile } from "antd";
import { Select } from "@/components/ui/base/select";
import { isReferenceHTTPSLink } from "@/services/api/reference-link-replacement";
import { AppModal } from "@/components/ui/product/app-modal";
import { FileImage, FileText, Film, Music2, UploadCloud, X } from "lucide-react";

import { isAudioFile } from "@/lib/canvas/canvas-project-generation";
import { isScriptDocumentFile } from "@/lib/canvas/script-document-import";

import { CANVAS_UPLOAD_ACCEPT, isTextUploadFile, uploadNodeType } from "@/lib/canvas/canvas-file-upload";

type CanvasUploadModalProps = {
    open: boolean;
    onClose: () => void;
    onUpload: (files: File[]) => Promise<boolean>;
    onImportUrl: (url: string,kind: "image" | "video" | "audio") => Promise<boolean>;
};

export function CanvasUploadModal({ open, onClose, onUpload, onImportUrl }: CanvasUploadModalProps) {
    const { message } = App.useApp();
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [uploading, setUploading] = useState(false);
    const [url,setUrl] = useState("");
    const [kind,setKind] = useState<"image" | "video" | "audio">("image");
    const submitUrl = async () => {
        if(!isReferenceHTTPSLink(url)) return;
        setUploading(true);
        try { if(await onImportUrl(url.trim(),kind)) { setUrl(""); onClose(); } }
        catch(error) { message.error(error instanceof Error ? error.message : "Failed to add link"); }
        finally { setUploading(false); }
    };

    useEffect(() => {
        if (!open) {
            setFileList([]);
            setUploading(false);
            setUrl("");
            setKind("image");
        }
    }, [open]);

    const submit = async () => {
        const files = fileList.flatMap((item) => item.originFileObj ? [item.originFileObj] : []);
        if (!files.length) return;
        setUploading(true);
        try {
            const pendingUpload = onUpload(files);
            onClose();
            await pendingUpload;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "File upload failed, please try again later");
        } finally {
            setUploading(false);
        }
    };

    return (
        <AppModal
            open={open}
            title={null}
            footer={null}
            width="min(720px, calc(100vw - 24px))"
            destroyOnHidden
            closable={!uploading}
            keyboard={!uploading}
            mask={{ closable: !uploading }}
            onCancel={onClose}
            flush
        >
            <div className="flex min-h-96 flex-col overflow-hidden">
                <header className="flex h-14 shrink-0 items-center justify-between border-b border-border py-0 pl-5 pr-12">
                    <div className="min-w-0">
                        <div role="heading" aria-level={2} className="text-sm font-semibold leading-5">Add material</div>
                        <div className="mt-0.5 text-[var(--fs-label)] leading-4 text-foreground/60">Import local files or online assets</div>
                    </div>
                    <span className="shrink-0 text-[var(--fs-label)] text-foreground/45">Selected{fileList.length}  item</span>
                </header>

                <section className="min-h-0 flex-1 overflow-y-auto p-4">
                    <Upload.Dragger
                        accept={CANVAS_UPLOAD_ACCEPT}
                        multiple
                        disabled={uploading}
                        fileList={fileList}
                        beforeUpload={(file) => {
                            if (isCanvasUploadFile(file)) return false;
                            message.warning(`“${file.name}” is not a supported image, video, audio, or document file (.docx / .txt / .md)`);
                            return Upload.LIST_IGNORE;
                        }}
                        onChange={({ fileList: nextFileList }) => setFileList(nextFileList)}
                        showUploadList={false}
                        styles={{
                            root: { display: "block", width: "100%" },
                            trigger: { borderColor: "var(--border)", borderRadius: "var(--r-lg)", background: "var(--workspace-surface)" },
                        }}
                    >
                        <div className="flex min-h-48 flex-col items-center justify-center px-6 py-8 text-center">
                            <span className="grid size-12 place-items-center rounded-lg bg-foreground/[.06] text-foreground/70">
                                <UploadCloud className="size-6" aria-hidden="true" />
                            </span>
                            <p className="mt-4 text-sm font-medium">Drag files here, or click to select</p>
                            <p className="mt-1 text-xs text-foreground/45">Supports selecting multiple files at the same time</p>
                            <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-[var(--fs-label)] text-foreground/45" aria-label="Supported file types">
                                <span className="inline-flex items-center gap-1"><FileImage className="size-3.5" aria-hidden="true" />pictures</span>
                                <span className="inline-flex items-center gap-1"><Film className="size-3.5" aria-hidden="true" />video</span>
                                <span className="inline-flex items-center gap-1"><Music2 className="size-3.5" aria-hidden="true" />Audio</span>
                                <span className="inline-flex items-center gap-1"><FileText className="size-3.5" aria-hidden="true" />TXT / Markdown / Word</span>
                            </div>
                        </div>
                    </Upload.Dragger>

                    {fileList.length ? (
                        <div className="thin-scrollbar mt-3 flex max-h-52 flex-wrap gap-3 overflow-y-auto" aria-label="Selected file">
                            {fileList.map((file) => (
                                <article key={file.uid} className="group w-24 min-w-0 overflow-hidden rounded-lg bg-muted">
                                    <div className="relative aspect-square overflow-hidden bg-muted">
                                        <CanvasUploadFilePreview file={file} />
                                        <button
                                            type="button"
                                            title={`Remove${file.name}`}
                                            aria-label={`Remove${file.name}`}
                                            disabled={uploading}
                                            className="absolute right-1 top-1 grid size-6 place-items-center rounded-md bg-black/60 text-white transition-opacity hover:bg-black/75 disabled:cursor-not-allowed disabled:opacity-50"
                                            onClick={() => setFileList((current) => current.filter((item) => item.uid !== file.uid))}
                                        >
                                            <X className="size-3.5" aria-hidden="true" />
                                        </button>
                                    </div>
                                    <div className="truncate px-2 py-1.5 text-[var(--fs-micro)] text-foreground/70" title={file.name}>{file.name}</div>
                                </article>
                            ))}
                        </div>
                    ) : null}
                </section>

                <section className="space-y-3 border-t border-border p-4" data-canvas-no-zoom>
                    <label className="block text-sm" htmlFor="canvas-media-url">Online material address</label>
                    <div className="flex min-w-0 flex-wrap gap-2">
                        <Select ariaLabel="Material type" value={kind} options={[{value:"image",label:"pictures"},{value:"video",label:"video"},{value:"audio",label:"Audio"}]} onChange={value=>setKind(value === "video" ? "video" : value === "audio" ? "audio" : "image")} />
                        <Input id="canvas-media-url" className="min-w-0 flex-1" value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://…" disabled={uploading} autoComplete="off"/>
                        <Button onClick={()=>void submitUrl()} disabled={!isReferenceHTTPSLink(url)} loading={uploading}>Add link</Button>
                    </div>
                    <p className="text-xs leading-5 text-foreground/60">Keep the original URL for generation, and use HTTPS material links that can be read directly by the service provider.</p>
                </section>
                <footer className="flex h-14 shrink-0 items-center justify-between border-t border-border px-4">
                    <span className="hidden text-[var(--fs-label)] text-foreground/45 sm:inline">Files will be added to the canvas in order upon confirmation</span>
                    <div className="ml-auto flex gap-2">
                        <Button disabled={uploading} onClick={onClose}>Cancel</Button>
                        <Button type="primary" icon={<UploadCloud className="size-4" />} disabled={!fileList.length} loading={uploading} onClick={() => void submit()}>
                                                        add to canvas{fileList.length ? `（${fileList.length}）` : ""}
                        </Button>
                    </div>
                </footer>
            </div>
        </AppModal>
    );
}

function CanvasUploadFilePreview({ file }: { file: UploadFile }) {
    const source = file.originFileObj;
    const [previewUrl, setPreviewUrl] = useState("");

    useEffect(() => {
        if (!source || (!source.type.startsWith("image/") && !source.type.startsWith("video/"))) return;
        const objectUrl = URL.createObjectURL(source);
        setPreviewUrl(objectUrl);
        return () => URL.revokeObjectURL(objectUrl);
    }, [source]);

    if (source?.type.startsWith("image/") && previewUrl) {
        return <img src={previewUrl} alt={`Preview:${file.name}`} className="size-full object-cover" />;
    }
    if (source?.type.startsWith("video/") && previewUrl) {
        return <video src={previewUrl} aria-label={`Preview:${file.name}`} muted playsInline preload="metadata" className="size-full object-cover" />;
    }
    return (
        <div className="grid size-full place-items-center text-foreground/45">
            {source && (isTextUploadFile(source) || isScriptDocumentFile(source)) ? <FileText className="size-7" aria-hidden="true" /> : source && (source.type.startsWith("audio/") || isAudioFile(source)) ? <Music2 className="size-7" aria-hidden="true" /> : <FileImage className="size-7" aria-hidden="true" />}
        </div>
    );
}

function isCanvasUploadFile(file: File) {
    return Boolean(uploadNodeType(file)) || isScriptDocumentFile(file);
}
