/**
 * useFolderSync — clean state-machine hook for folder-push sync.
 *
 * Phases:
 *   idle        — nothing selected, waiting for user to pick a folder
 *   scanning    — reading the folder contents (FSAPI or <input> fallback)
 *   preview     — manifest built, waiting for user to confirm push
 *   sending     — sendFiles() in progress (delegated to useFileTransfer)
 *   done        — transfer complete
 *   error       — something went wrong
 *
 * Design principles:
 *   • No internal useFileTransfer instance — calls the shared sendFiles()
 *     that is passed in as a prop so all file bytes flow through the single
 *     registered data-channel handler.
 *   • No IndexedDB persistence of FileSystemDirectoryHandle — handles cannot
 *     be serialised; every sync starts fresh.
 *   • Works on every browser: prefers File System Access API (Chrome/Edge),
 *     falls back to <input webkitdirectory> (Firefox, Safari, mobile).
 */

import { useCallback, useReducer } from "react";
import { createFileMetadata } from "@/lib/fileUtils";
import type { FileMetadata } from "@/types/transfer";

// ─── Public types ─────────────────────────────────────────────────────────────

export type FolderSyncPhase =
  | "idle"
  | "scanning"
  | "preview"
  | "sending"
  | "done"
  | "error";

/** A lightweight descriptor for a single file inside the selected folder. */
export interface SyncFileEntry {
  /** Relative path from the folder root, e.g. "src/index.ts" */
  path: string;
  name: string;
  size: number;
  lastModified: number;
  /** Back-reference to the original File object for actual transfer. */
  file: File;
}

export interface FolderSyncState {
  phase: FolderSyncPhase;
  /** Display name of the selected folder (e.g. "Documents") */
  folderName: string | null;
  /** Flat list of every file found inside the folder */
  entries: SyncFileEntry[];
  /** Total bytes across all entries */
  totalSize: number;
  /** Human-readable error message when phase === "error" */
  error: string | null;
}

// ─── Internal reducer ─────────────────────────────────────────────────────────

type Action =
  | { type: "SCAN_START" }
  | {
      type: "SCAN_DONE";
      folderName: string;
      entries: SyncFileEntry[];
    }
  | { type: "SEND_START" }
  | { type: "SEND_DONE" }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

const initial: FolderSyncState = {
  phase: "idle",
  folderName: null,
  entries: [],
  totalSize: 0,
  error: null,
};

function reducer(state: FolderSyncState, action: Action): FolderSyncState {
  switch (action.type) {
    case "SCAN_START":
      return { ...initial, phase: "scanning" };

    case "SCAN_DONE":
      return {
        ...state,
        phase: "preview",
        folderName: action.folderName,
        entries: action.entries,
        totalSize: action.entries.reduce((s, e) => s + e.size, 0),
        error: null,
      };

    case "SEND_START":
      return { ...state, phase: "sending", error: null };

    case "SEND_DONE":
      return { ...state, phase: "done" };

    case "ERROR":
      return { ...state, phase: "error", error: action.message };

    case "RESET":
      return { ...initial };

    default:
      return state;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively walk a FileSystemDirectoryHandle and collect every file. */
async function walkDirectory(
  dirHandle: FileSystemDirectoryHandle,
  prefix: string,
): Promise<SyncFileEntry[]> {
  const entries: SyncFileEntry[] = [];

  // FileSystemDirectoryHandle is async-iterable at runtime even though the
  // TypeScript lib types don't expose entries() — cast to access it.
  const iterable = dirHandle as FileSystemDirectoryHandle & {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  };

  for await (const [name, handle] of iterable.entries()) {
    const relativePath = prefix ? `${prefix}/${name}` : name;

    if (handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile();
      entries.push({
        path: relativePath,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        file,
      });
    } else if (handle.kind === "directory") {
      const children = await walkDirectory(
        handle as FileSystemDirectoryHandle,
        relativePath,
      );
      entries.push(...children);
    }
  }

  return entries;
}

/**
 * Open a native directory picker (File System Access API).
 * Returns null when the user cancels or the API is unavailable.
 */
async function pickWithFSAPI(): Promise<{
  name: string;
  entries: SyncFileEntry[];
} | null> {
  if (!("showDirectoryPicker" in window)) return null;

  try {
    const picker = window as Window & {
      showDirectoryPicker(opts?: {
        mode?: "read" | "readwrite";
      }): Promise<FileSystemDirectoryHandle>;
    };
    const dirHandle = await picker.showDirectoryPicker({ mode: "read" });
    const entries = await walkDirectory(dirHandle, "");
    return { name: dirHandle.name, entries };
  } catch (err) {
    if ((err as DOMException).name === "AbortError") return null; // user cancelled
    throw err;
  }
}

/**
 * Fallback: open an <input webkitdirectory> element.
 * Works on Firefox, Safari, and all mobile browsers.
 * Returns null when the user cancels.
 */
function pickWithInput(): Promise<{
  name: string;
  entries: SyncFileEntry[];
} | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.multiple = true;
    input.style.cssText = "position:fixed;opacity:0;pointer-events:none";

    input.onchange = () => {
      const files = input.files;
      if (!files || files.length === 0) {
        document.body.removeChild(input);
        resolve(null);
        return;
      }

      // Derive the folder name from the common webkitRelativePath prefix
      const firstPath = (files[0] as File & { webkitRelativePath?: string })
        .webkitRelativePath;
      const folderName = firstPath ? firstPath.split("/")[0] : "Folder";

      const entries: SyncFileEntry[] = Array.from(files).map((file) => {
        const rel = (file as File & { webkitRelativePath?: string })
          .webkitRelativePath;
        // Strip the top-level folder name so paths are relative to it
        const path = rel
          ? rel.split("/").slice(1).join("/") || file.name
          : file.name;
        return {
          path,
          name: file.name,
          size: file.size,
          lastModified: file.lastModified,
          file,
        };
      });

      document.body.removeChild(input);
      resolve({ name: folderName, entries });
    };

    // Some browsers fire "cancel" on the input; others just never fire onchange.
    // We rely on onchange for both cases (an empty FileList means cancel).
    input.oncancel = () => {
      document.body.removeChild(input);
      resolve(null);
    };

    document.body.appendChild(input);
    input.click();
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseFolderSyncOptions {
  /**
   * The shared sendFiles function from useFileTransfer.
   * Must be the SAME instance used by the rest of the app so that file bytes
   * flow through the registered onmessage handler.
   */
  sendFiles: (
    files: File[],
    dataChannel: RTCDataChannel,
    peerId: string,
    peerName: string,
    folderName?: string,
  ) => Promise<void>;
  /** From useWebRTCContext */
  getDataChannelForPeer: (peerId: string) => RTCDataChannel | null;
}

export function useFolderSync({
  sendFiles,
  getDataChannelForPeer,
}: UseFolderSyncOptions) {
  const [state, dispatch] = useReducer(reducer, initial);

  // ── pickFolder ─────────────────────────────────────────────────────────────
  /**
   * Open the OS-level folder picker, scan all files inside, and move to the
   * "preview" phase where the user sees the manifest before confirming.
   */
  const pickFolder = useCallback(async () => {
    dispatch({ type: "SCAN_START" });

    try {
      // Prefer the modern File System Access API; fall back to <input>.
      const result = (await pickWithFSAPI()) ?? (await pickWithInput());

      if (!result) {
        // User cancelled — go back to idle silently
        dispatch({ type: "RESET" });
        return;
      }

      const { name, entries } = result;

      if (entries.length === 0) {
        dispatch({
          type: "ERROR",
          message: "The selected folder appears to be empty.",
        });
        return;
      }

      dispatch({ type: "SCAN_DONE", folderName: name, entries });
    } catch (err) {
      console.error("[useFolderSync] pickFolder error:", err);
      dispatch({
        type: "ERROR",
        message:
          err instanceof Error
            ? err.message
            : "Failed to read the folder. Please try again.",
      });
    }
  }, []);

  // ── startPush ──────────────────────────────────────────────────────────────
  /**
   * Begin streaming all selected files to the given peer.
   * The actual file transfer is delegated to the shared sendFiles() so that
   * progress updates flow through the central useFileTransfer state.
   */
  const startPush = useCallback(
    async (peerId: string, peerName: string) => {
      if (state.phase !== "preview") return;

      const dataChannel = getDataChannelForPeer(peerId);
      if (!dataChannel || dataChannel.readyState !== "open") {
        dispatch({
          type: "ERROR",
          message: `No open connection to ${peerName}. Make sure they're still connected.`,
        });
        return;
      }

      dispatch({ type: "SEND_START" });

      try {
        const files: File[] = state.entries.map((e) => e.file);
        await sendFiles(
          files,
          dataChannel,
          peerId,
          peerName,
          state.folderName ?? "Folder",
        );
        dispatch({ type: "SEND_DONE" });
      } catch (err) {
        console.error("[useFolderSync] startPush error:", err);
        dispatch({
          type: "ERROR",
          message:
            err instanceof Error ? err.message : "Transfer failed. Try again.",
        });
      }
    },
    [
      state.phase,
      state.entries,
      state.folderName,
      sendFiles,
      getDataChannelForPeer,
    ],
  );

  // ── reset ──────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  // ── buildFileMetadata ──────────────────────────────────────────────────────
  /**
   * Build FileMetadata[] for display purposes (e.g. in the diff preview).
   * Does NOT include the actual File objects — those stay in state.entries.
   */
  const buildManifest = useCallback((): FileMetadata[] => {
    return state.entries.map((e) =>
      createFileMetadata(e.file, undefined, e.path),
    );
  }, [state.entries]);

  return {
    ...state,
    pickFolder,
    startPush,
    reset,
    buildManifest,
  };
}
