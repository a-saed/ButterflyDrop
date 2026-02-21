/**
 * BDP — Vault Browser (Phase F3)
 *
 * Browsable file tree for files stored in the OPFS vault for a given sync pair.
 * Supports folder navigation, image/text previews, individual file export
 * (browser download), and a "Download All" action that loops through each file.
 *
 * Status per file:
 *   available = true  → green dot (data fully present in vault)
 *   available = false → grey dot (transfer pending / incomplete)
 *   conflicted = true → orange dot (has an unresolved conflict)
 *
 * Dependencies: shadcn/ui, lucide-react, opfsVault.ts (readFileFromVault)
 */

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  type MouseEvent,
} from "react";
import {
  Folder,
  FolderOpen,
  File,
  FileImage,
  FileText,
  FileCode,
  Download,
  DownloadCloud,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowLeft,
  Search,
  X,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import type { PairId, VaultFileInfo } from "@/types/bdp";
import { readFileFromVault } from "@/bdp/services/opfsVault";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VaultBrowserProps {
  pairId: PairId;
  files: VaultFileInfo[];
  folderName: string;
  onRefresh(): Promise<void>;
  onClose(): void;
}

interface TreeNode {
  name: string;
  /** Full relative path (e.g. "src/utils/helper.ts") */
  path: string;
  kind: "file" | "folder";
  file?: VaultFileInfo;
  children: TreeNode[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree building
// ─────────────────────────────────────────────────────────────────────────────

function buildTree(files: VaultFileInfo[]): TreeNode {
  const root: TreeNode = { name: "", path: "", kind: "folder", children: [] };

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    let node = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;
      const partialPath = segments.slice(0, i + 1).join("/");

      let child = node.children.find((c) => c.name === segment);
      if (!child) {
        child = {
          name: segment,
          path: partialPath,
          kind: isLast ? "file" : "folder",
          file: isLast ? file : undefined,
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    }
  }

  // Sort: folders first, then files, both alphabetically
  sortTreeNode(root);
  return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// Search helper (module-level — no closure over component state)
// ─────────────────────────────────────────────────────────────────────────────

function matchesSearch(node: TreeNode, query: string): boolean {
  if (!query) return true;
  if (node.name.toLowerCase().includes(query.toLowerCase())) return true;
  return node.children.some((child) => matchesSearch(child, query));
}

function sortTreeNode(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) {
    if (child.kind === "folder") sortTreeNode(child);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// File icon
// ─────────────────────────────────────────────────────────────────────="────────

function FileIcon({
  mimeType,
  className,
}: {
  mimeType: string;
  className?: string;
}) {
  const cls = cn("shrink-0", className);
  if (mimeType.startsWith("image/")) return <FileImage className={cls} />;
  if (mimeType.startsWith("text/")) return <FileText className={cls} />;
  if (
    mimeType === "application/json" ||
    mimeType === "application/javascript" ||
    mimeType === "application/typescript"
  )
    return <FileCode className={cls} />;
  return <File className={cls} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status dot
// ─────────────────────────────────────────────────────────────────────────────

function StatusDot({ file }: { file: VaultFileInfo }) {
  if (file.conflicted) {
    return (
      <span
        title="Conflict — needs resolution"
        className="inline-flex size-2 rounded-full bg-orange-400 shrink-0"
      />
    );
  }
  if (file.available) {
    return (
      <span
        title="Available"
        className="inline-flex size-2 rounded-full bg-emerald-400 shrink-0"
      />
    );
  }
  return (
    <span
      title="Pending transfer"
      className="inline-flex size-2 rounded-full bg-zinc-300 dark:bg-zinc-600 shrink-0"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree row
// ─────────────────────────────────────────────────────────────────────────────

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  onToggleFolder(path: string): void;
  onSelectFile(path: string): void;
  searchQuery: string;
}

function TreeRow({
  node,
  depth,
  expandedPaths,
  selectedPath,
  onToggleFolder,
  onSelectFile,
  searchQuery,
}: TreeRowProps) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;

  const nameMatch =
    !searchQuery || node.name.toLowerCase().includes(searchQuery.toLowerCase());

  if (searchQuery && !matchesSearch(node, searchQuery)) return null;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (node.kind === "folder") {
      onToggleFolder(node.path);
    } else {
      onSelectFile(node.path);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors",
          "hover:bg-muted/60",
          isSelected && "bg-primary/10 text-primary",
          !nameMatch && searchQuery && "opacity-50",
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {/* Folder expand chevron / file spacer */}
        {node.kind === "folder" ? (
          isExpanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="size-3.5 shrink-0" />
        )}

        {/* Icon */}
        {node.kind === "folder" ? (
          isExpanded ? (
            <FolderOpen className="size-4 shrink-0 text-amber-500" />
          ) : (
            <Folder className="size-4 shrink-0 text-amber-500" />
          )
        ) : (
          <FileIcon
            mimeType={node.file?.mimeType ?? "application/octet-stream"}
            className="size-4 text-muted-foreground"
          />
        )}

        {/* Name */}
        <span className="flex-1 truncate text-xs">{node.name}</span>

        {/* File metadata */}
        {node.kind === "file" && node.file && (
          <span className="flex items-center gap-1.5 shrink-0">
            <StatusDot file={node.file} />
            <span className="text-[10px] text-muted-foreground">
              {formatBytes(node.file.size)}
            </span>
          </span>
        )}
      </button>

      {/* Recursive children */}
      {node.kind === "folder" && isExpanded && (
        <>
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
              searchQuery={searchQuery}
            />
          ))}
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview panel
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewPanelProps {
  pairId: PairId;
  file: VaultFileInfo;
  onDownload(): Promise<void>;
  downloading: boolean;
}

function PreviewPanel({
  pairId,
  file,
  onDownload,
  downloading,
}: PreviewPanelProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Derive loading: true when the file should have a preview but we don't
  // have one yet (and no error). Avoids calling setState synchronously in effects.
  const loading =
    file.previewable &&
    file.available &&
    preview === null &&
    previewError === null;

  useEffect(() => {
    if (!file.previewable || !file.available) {
      // Nothing to load — reset async so we don't call setState synchronously
      // inside the effect body (which would trigger a lint error).
      Promise.resolve().then(() => {
        setPreview(null);
        setPreviewError(null);
      });
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;

    // Reset previous preview async before starting the new load
    Promise.resolve()
      .then(async () => {
        if (cancelled) return;

        const blob = await readFileFromVault(pairId, file.path);
        if (cancelled || !blob) return;

        if (file.mimeType.startsWith("image/")) {
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setPreview(objectUrl);
        } else if (file.mimeType.startsWith("text/")) {
          const text = await blob.text();
          if (!cancelled) setPreview(text.slice(0, 2000));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPreviewError(
            err instanceof Error ? err.message : "Preview unavailable",
          );
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      // Reset state for the next file
      setPreview(null);
      setPreviewError(null);
    };
  }, [pairId, file.path, file.mimeType, file.available, file.previewable]);

  return (
    <div className="flex flex-col gap-3">
      {/* File header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileIcon
            mimeType={file.mimeType}
            className="size-5 text-muted-foreground shrink-0"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{file.name}</p>
            <p className="text-[11px] text-muted-foreground">{file.path}</p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onDownload}
          disabled={!file.available || downloading}
          className="shrink-0 gap-1.5 text-xs h-8"
        >
          {downloading ? (
            <RefreshCw className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          {downloading ? "Saving…" : "Download"}
        </Button>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <span className="text-muted-foreground">Size</span>
        <span>{formatBytes(file.size)}</span>
        <span className="text-muted-foreground">Modified</span>
        <span>{formatDate(file.mtime)}</span>
        <span className="text-muted-foreground">Type</span>
        <span className="truncate">{file.mimeType}</span>
        <span className="text-muted-foreground">Status</span>
        <span className="flex items-center gap-1.5">
          {file.conflicted ? (
            <>
              <AlertTriangle className="size-3 text-orange-500" />
              <span className="text-orange-600 dark:text-orange-400">
                Conflict
              </span>
            </>
          ) : file.available ? (
            <>
              <CheckCircle2 className="size-3 text-emerald-500" />
              <span className="text-emerald-600 dark:text-emerald-400">
                Available
              </span>
            </>
          ) : (
            <>
              <Clock className="size-3 text-zinc-400" />
              <span className="text-zinc-500">Pending</span>
            </>
          )}
        </span>
      </div>

      {/* Preview area */}
      {file.previewable && file.available && (
        <div className="rounded-lg border bg-muted/30 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center h-32 text-muted-foreground gap-2">
              <RefreshCw className="size-4 animate-spin" />
              <span className="text-xs">Loading preview…</span>
            </div>
          )}

          {previewError && !loading && (
            <div className="flex items-center justify-center h-20 text-muted-foreground">
              <p className="text-xs">{previewError}</p>
            </div>
          )}

          {!loading && !previewError && preview && (
            <>
              {file.mimeType.startsWith("image/") ? (
                <div className="flex items-center justify-center p-2 max-h-56 overflow-hidden">
                  <img
                    src={preview}
                    alt={file.name}
                    className="max-w-full max-h-52 object-contain rounded"
                  />
                </div>
              ) : (
                <pre className="p-3 text-[11px] font-mono text-foreground/80 overflow-auto max-h-48 whitespace-pre-wrap break-all">
                  {preview}
                  {file.size > 2000 && (
                    <span className="text-muted-foreground italic">
                      {"\n"}… (preview truncated)
                    </span>
                  )}
                </pre>
              )}
            </>
          )}
        </div>
      )}

      {!file.available && (
        <div className="rounded-lg border border-dashed bg-muted/20 flex items-center justify-center h-16">
          <p className="text-xs text-muted-foreground">
            File not yet transferred — preview unavailable
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VaultBrowser
// ─────────────────────────────────────────────────────────────────────────────

export function VaultBrowser({
  pairId,
  files,
  folderName,
  onRefresh,
  onClose,
}: VaultBrowserProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  const tree = useMemo(() => buildTree(files), [files]);

  const selectedFile = useMemo(
    () => files.find((f) => f.path === selectedPath) ?? null,
    [files, selectedPath],
  );

  const stats = useMemo(() => {
    const total = files.length;
    const available = files.filter((f) => f.available).length;
    const conflicted = files.filter((f) => f.conflicted).length;
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    return { total, available, conflicted, totalBytes };
  }, [files]);

  // ── Folder toggle ──────────────────────────────────────────────────────────

  const handleToggleFolder = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // ── File selection ─────────────────────────────────────────────────────────

  const handleSelectFile = useCallback((path: string) => {
    setSelectedPath((prev) => (prev === path ? null : path));
  }, []);

  // ── Refresh ────────────────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  // ── Download single file ───────────────────────────────────────────────────

  const handleDownloadFile = useCallback(
    async (file: VaultFileInfo) => {
      if (!file.available) return;
      setDownloading(true);
      try {
        const blob = await readFileFromVault(pairId, file.path);
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn("[VaultBrowser] download failed:", err);
        }
      } finally {
        setDownloading(false);
      }
    },
    [pairId],
  );

  // ── Download all ───────────────────────────────────────────────────────────

  const handleDownloadAll = useCallback(async () => {
    const available = files.filter((f) => f.available);
    if (available.length === 0) return;

    setDownloading(true);
    setDownloadProgress(0);

    try {
      for (let i = 0; i < available.length; i++) {
        const file = available[i];
        try {
          const blob = await readFileFromVault(pairId, file.path);
          if (!blob) continue;
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          // Preserve folder structure in the filename
          a.download = file.path.replace(/\//g, "_");
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          // Small delay between downloads to avoid browser throttling
          await new Promise((r) => setTimeout(r, 150));
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn(
              `[VaultBrowser] download failed for ${file.path}:`,
              err,
            );
          }
        }
        setDownloadProgress(Math.round(((i + 1) / available.length) * 100));
      }
    } finally {
      setDownloading(false);
      setTimeout(() => setDownloadProgress(null), 1500);
    }
  }, [pairId, files]);

  // ── Expand all on search ───────────────────────────────────────────────────

  useEffect(() => {
    if (searchQuery) {
      // Auto-expand all folders when searching
      const allFolderPaths: string[] = [];
      const collectFolders = (node: TreeNode) => {
        if (node.kind === "folder" && node.path) {
          allFolderPaths.push(node.path);
        }
        for (const child of node.children) collectFolders(child);
      };
      collectFolders(tree);
      setExpandedPaths(new Set(allFolderPaths));
    }
  }, [searchQuery, tree]);

  // ──────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b">
        <div className="flex items-center gap-2 min-w-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="shrink-0"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{folderName}</h3>
            <p className="text-[11px] text-muted-foreground">
              {stats.total} file{stats.total !== 1 ? "s" : ""} ·{" "}
              {formatBytes(stats.totalBytes)}
              {stats.conflicted > 0 && (
                <span className="text-orange-500 ml-1">
                  · {stats.conflicted} conflict
                  {stats.conflicted !== 1 ? "s" : ""}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh"
          >
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadAll}
            disabled={downloading || stats.available === 0}
            className="gap-1.5 text-xs h-8"
          >
            <DownloadCloud className="size-3.5" />
            All
          </Button>
        </div>
      </div>

      {/* Download progress */}
      {downloadProgress !== null && (
        <div className="py-2">
          <Progress value={downloadProgress} className="h-1" />
          <p className="text-[10px] text-muted-foreground mt-1">
            Downloading… {downloadProgress}%
          </p>
        </div>
      )}

      {/* Search */}
      <div className="relative mt-3">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search files…"
          className={cn(
            "w-full rounded-lg border bg-muted/40 pl-8 pr-8 py-1.5 text-xs",
            "focus:outline-none focus:ring-2 focus:ring-ring",
            "placeholder:text-muted-foreground/50",
          )}
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Content: tree + preview */}
      <div className="flex gap-3 mt-3 flex-1 min-h-0 overflow-hidden">
        {/* File tree */}
        <div
          className={cn(
            "flex flex-col overflow-y-auto min-h-0",
            selectedFile ? "w-1/2" : "w-full",
          )}
        >
          {files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Folder className="size-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                No files in vault yet
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Files will appear here after the first sync
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {tree.children.map((node) => (
                <TreeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  expandedPaths={expandedPaths}
                  selectedPath={selectedPath}
                  onToggleFolder={handleToggleFolder}
                  onSelectFile={handleSelectFile}
                  searchQuery={searchQuery}
                />
              ))}
            </div>
          )}
        </div>

        {/* Preview panel */}
        {selectedFile && (
          <div className="w-1/2 overflow-y-auto min-h-0 border-l pl-3">
            <PreviewPanel
              pairId={pairId}
              file={selectedFile}
              onDownload={() => handleDownloadFile(selectedFile)}
              downloading={downloading}
            />
          </div>
        )}
      </div>
    </div>
  );
}
