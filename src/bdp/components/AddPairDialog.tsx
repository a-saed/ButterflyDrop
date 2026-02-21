/**
 * BDP — Add Pair Dialog (Phase F2)
 *
 * Two-mode dialog for establishing a new sync pair:
 *
 *   Share mode (sender):
 *     1. Generate a pairId + encode QR payload (pairId + publicKey)
 *     2. Display QR code + copyable link
 *     3. Poll readyPeers — when the peer appears, complete setup
 *     4. Prompt user to pick a local folder
 *     5. Save the pair
 *
 *   Join mode (receiver):
 *     1. Paste the share link or scan QR
 *     2. Decode pairId + peer public key
 *     3. Join the signaling session
 *     4. Pick a local folder
 *     5. Save the pair with the peer's device info
 *
 * The QR payload is a base64-encoded JSON object:
 *   { pairId: string; publicKeyB64: string; sessionId: string; deviceName: string }
 *
 * Dependencies: useBDP hook, react-qr-code (or inline SVG QR), shadcn/ui
 */

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
} from "react";
import QRCode from "react-qr-code";
import { nanoid } from "nanoid";
import {
  Copy,
  Check,
  Folder,
  Share2,
  QrCode,
  Link,
  ChevronRight,
  Loader2,
  CheckCircle2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import type { BDPDevice, DeviceId, PairId, SyncPair } from "@/types/bdp";
import type { CreatePairOptions } from "@/bdp/hooks/useBDP";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** The payload encoded inside the QR / share link */
interface QRPayload {
  pairId: string;
  publicKeyB64: string;
  sessionId: string;
  deviceName: string;
}

type DialogMode = "pick" | "share" | "join";
type ShareStep = "qr" | "waiting" | "pick-folder" | "done";
type JoinStep = "paste" | "connecting" | "pick-folder" | "done";

export interface AddPairDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Local device — used to encode publicKey in QR payload */
  device: BDPDevice | null;
  /** From useWebRTCContext — used to detect when the peer joins */
  readyPeers: string[];
  /** Current WebRTC session ID — included in QR so receiver can join */
  sessionId: string;
  /** Called when the user finishes setup and we should create the pair */
  onCreatePair(options: CreatePairOptions): Promise<SyncPair>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function encodeQRPayload(payload: QRPayload): string {
  return btoa(JSON.stringify(payload));
}

function decodeQRPayload(encoded: string): QRPayload | null {
  try {
    const decoded = JSON.parse(atob(encoded.trim())) as unknown;
    if (
      decoded !== null &&
      typeof decoded === "object" &&
      "pairId" in decoded &&
      "publicKeyB64" in decoded &&
      "sessionId" in decoded
    ) {
      return decoded as QRPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/** Extracts the base64 payload from a full share URL or raw base64 string */
function extractPayload(input: string): string {
  const trimmed = input.trim();
  // Could be a full URL like https://example.com/?bdp=<base64>
  try {
    const url = new URL(trimmed);
    const param = url.searchParams.get("bdp");
    if (param) return param;
  } catch {
    // Not a URL — treat as raw base64
  }
  return trimmed;
}

function buildShareUrl(payload: string): string {
  const base = window.location.origin + window.location.pathname;
  return `${base}?bdp=${encodeURIComponent(payload)}`;
}

async function pickFolder(): Promise<{
  name: string;
  handle: FileSystemDirectoryHandle | null;
  useRealFS: boolean;
} | null> {
  // Tier 1: File System Access API (Chrome/Edge)
  if ("showDirectoryPicker" in window) {
    try {
      const handle = await (
        window as Window & {
          showDirectoryPicker(opts?: {
            mode?: string;
          }): Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker({ mode: "readwrite" });
      return { name: handle.name, handle, useRealFS: true };
    } catch (err) {
      // User cancelled
      if (err instanceof DOMException && err.name === "AbortError") return null;
      // Permission denied or other error — fall through to OPFS-only
    }
  }

  // Tier 0: OPFS-only — prompt for a name
  const name = prompt(
    "Enter a name for this sync folder (files will be stored in your browser's private storage):",
    "My Sync Folder",
  );
  if (!name) return null;
  return { name, handle: null, useRealFS: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — fallback
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
        copied
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
          : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Share flow
// ─────────────────────────────────────────────────────────────────────────────

interface ShareFlowProps {
  device: BDPDevice;
  sessionId: string;
  readyPeers: string[];
  prevPeersRef: React.RefObject<string[]>;
  onCreatePair(options: CreatePairOptions): Promise<SyncPair>;
  onDone(): void;
}

function ShareFlow({
  device,
  sessionId,
  readyPeers,
  prevPeersRef,
  onCreatePair,
  onDone,
}: ShareFlowProps) {
  const [step, setStep] = useState<ShareStep>("qr");

  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Generate a stable pairId for this dialog session
  const pairIdRef = useRef<PairId>(nanoid(32) as PairId);

  const qrPayload = encodeQRPayload({
    pairId: pairIdRef.current,
    publicKeyB64: device.publicKeyB64,
    sessionId,
    deviceName: device.deviceName,
  });
  const shareUrl = buildShareUrl(qrPayload);

  // Detect when a new peer joins
  useEffect(() => {
    if (step !== "qr" && step !== "waiting") return;

    const prev = prevPeersRef.current ?? [];
    const newPeers = readyPeers.filter((id) => !prev.includes(id));

    if (newPeers.length > 0) {
      setStep("pick-folder");
    }
  }, [readyPeers, step, prevPeersRef]);

  const handlePickFolder = useCallback(async () => {
    const result = await pickFolder();
    if (!result) return; // user cancelled

    setCreating(true);
    setError(null);

    try {
      await onCreatePair({
        folderName: result.name,
        handle: result.handle,
        useRealFS: result.useRealFS,
        // Note: peerInfo will be completed when the peer sends its BDP_HELLO
        // with its deviceId and publicKey — the session.ts handles that
      });
      setStep("done");
      setTimeout(onDone, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [onCreatePair, onDone]);

  if (step === "done") {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <CheckCircle2 className="size-12 text-emerald-500" />
        <p className="text-sm font-medium">Sync pair created!</p>
        <p className="text-xs text-muted-foreground">
          Your folders are now linked. Syncing will begin shortly.
        </p>
      </div>
    );
  }

  if (step === "pick-folder") {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="flex items-center justify-center size-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600">
          <CheckCircle2 className="size-7" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold">Peer connected!</p>
          <p className="text-xs text-muted-foreground mt-1">
            Now choose which local folder to sync.
          </p>
        </div>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-3 py-2 text-center">
            {error}
          </p>
        )}

        <Button
          onClick={handlePickFolder}
          disabled={creating}
          className="gap-2"
        >
          {creating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Folder className="size-4" />
          )}
          {creating ? "Setting up…" : "Choose Folder"}
        </Button>
      </div>
    );
  }

  // QR / waiting step
  return (
    <div className="flex flex-col gap-4">
      {/* QR Code */}
      <div className="flex justify-center">
        <div className="p-3 bg-white rounded-xl shadow-sm border">
          <QRCode value={shareUrl} size={200} level="M" />
        </div>
      </div>

      {/* Share link */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Or share this link
        </label>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <Link className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs text-muted-foreground truncate font-mono">
            {shareUrl}
          </span>
          <CopyButton text={shareUrl} />
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2.5">
        <Loader2 className="size-4 animate-spin text-muted-foreground shrink-0" />
        <p className="text-xs text-muted-foreground">
          Waiting for the other device to scan or open the link…
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Join flow
// ─────────────────────────────────────────────────────────────────────────────

interface JoinFlowProps {
  onCreatePair(options: CreatePairOptions): Promise<SyncPair>;
  onDone(): void;
}

function JoinFlow({ onCreatePair, onDone }: JoinFlowProps) {
  const [step, setStep] = useState<JoinStep>("paste");
  const [input, setInput] = useState("");
  const [decoded, setDecoded] = useState<QRPayload | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Also check the URL on mount (user may have opened a share link)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const bdpParam = urlParams.get("bdp");
    if (bdpParam) {
      setInput(buildShareUrl(bdpParam));
      const payload = decodeQRPayload(bdpParam);
      if (payload) {
        setDecoded(payload);
        setStep("connecting");
      }
    }
  }, []);

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setInput(val);
      setDecodeError(null);
      setDecoded(null);

      if (!val.trim()) return;

      const raw = extractPayload(val);
      const payload = decodeQRPayload(raw);
      if (payload) {
        setDecoded(payload);
      } else {
        setDecodeError("Invalid link or QR code — paste the full share URL");
      }
    },
    [],
  );

  const handleConnect = useCallback(() => {
    if (!decoded) return;
    setStep("connecting");
    // In a real flow we'd instruct the WebRTC layer to join the signaling
    // session from decoded.sessionId. For now we immediately move to folder pick
    // since the WebRTC connection happens at a higher layer.
    setTimeout(() => setStep("pick-folder"), 800);
  }, [decoded]);

  const handlePickFolder = useCallback(async () => {
    if (!decoded) return;

    const result = await pickFolder();
    if (!result) return;

    setCreating(true);
    setError(null);

    try {
      await onCreatePair({
        folderName: result.name,
        handle: result.handle,
        useRealFS: result.useRealFS,
        peerInfo: {
          deviceId: decoded.pairId as DeviceId, // will be updated on BDP_HELLO
          deviceName: decoded.deviceName,
          publicKeyB64: decoded.publicKeyB64,
        },
      });
      setStep("done");
      setTimeout(onDone, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [decoded, onCreatePair, onDone]);

  if (step === "done") {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <CheckCircle2 className="size-12 text-emerald-500" />
        <p className="text-sm font-medium">Joined sync pair!</p>
        <p className="text-xs text-muted-foreground">
          Your folders are now linked. Syncing will begin shortly.
        </p>
      </div>
    );
  }

  if (step === "connecting") {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <Loader2 className="size-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Connecting to peer…</p>
      </div>
    );
  }

  if (step === "pick-folder") {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="flex items-center justify-center size-14 rounded-2xl bg-primary/10 text-primary">
          <Folder className="size-7" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold">Choose a local folder</p>
          <p className="text-xs text-muted-foreground mt-1">
            Syncing with{" "}
            <span className="font-medium">{decoded?.deviceName ?? "peer"}</span>
          </p>
        </div>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-3 py-2 text-center">
            {error}
          </p>
        )}

        <Button
          onClick={handlePickFolder}
          disabled={creating}
          className="gap-2"
        >
          {creating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Folder className="size-4" />
          )}
          {creating ? "Setting up…" : "Choose Folder"}
        </Button>
      </div>
    );
  }

  // Paste step
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="bdp-join-input"
          className="text-xs font-medium text-muted-foreground"
        >
          Paste the share link or QR code text
        </label>
        <textarea
          id="bdp-join-input"
          rows={3}
          value={input}
          onChange={handleInputChange}
          placeholder="https://…?bdp=… or paste the raw code"
          className={cn(
            "w-full rounded-lg border bg-muted/40 px-3 py-2 text-xs font-mono resize-none",
            "placeholder:text-muted-foreground/50",
            "focus:outline-none focus:ring-2 focus:ring-ring",
            decodeError && "border-red-400 focus:ring-red-400/30",
            decoded && "border-emerald-400 focus:ring-emerald-400/30",
          )}
        />
        {decodeError && (
          <p className="text-[11px] text-red-600 dark:text-red-400">
            {decodeError}
          </p>
        )}
        {decoded && (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <Check className="size-3" />
            Valid link from{" "}
            <span className="font-medium">{decoded.deviceName}</span>
          </p>
        )}
      </div>

      <Button onClick={handleConnect} disabled={!decoded} className="gap-2">
        <ChevronRight className="size-4" />
        Continue
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode picker
// ─────────────────────────────────────────────────────────────────────────────

function ModePicker({ onPick }: { onPick(mode: "share" | "join"): void }) {
  return (
    <div className="grid grid-cols-2 gap-3 py-2">
      <button
        type="button"
        onClick={() => onPick("share")}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 p-5 text-center",
          "transition-all hover:border-primary hover:bg-primary/5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary">
          <QrCode className="size-6" />
        </div>
        <div>
          <p className="text-sm font-semibold">Share</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Show a QR code or link for another device to scan
          </p>
        </div>
      </button>

      <button
        type="button"
        onClick={() => onPick("join")}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 p-5 text-center",
          "transition-all hover:border-primary hover:bg-primary/5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary">
          <Share2 className="size-6" />
        </div>
        <div>
          <p className="text-sm font-semibold">Join</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Paste a link or scan a QR from the other device
          </p>
        </div>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddPairDialog
// ─────────────────────────────────────────────────────────────────────────────

export function AddPairDialog({
  open,
  onOpenChange,
  device,
  readyPeers,
  sessionId,
  onCreatePair,
}: AddPairDialogProps) {
  const [mode, setMode] = useState<DialogMode>("pick");

  // Snapshot of peers before the dialog opened, used to detect new joiners
  const prevPeersRef = useRef<string[]>([]);

  // Snapshot peers when the dialog opens (used to detect new joiners)
  // We intentionally do NOT reset mode via useEffect to avoid sync setState —
  // instead the dialog uses a `key` prop driven by `open` at the call site,
  // or we reset via the onOpenChange handler below.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        // Dialog opening — snapshot current peers and reset to pick mode
        prevPeersRef.current = [...readyPeers];
        setMode("pick");
      }
      onOpenChange(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onOpenChange],
  );

  const handleDone = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const title =
    mode === "pick"
      ? "Add Sync Pair"
      : mode === "share"
        ? "Share — Show QR Code"
        : "Join — Scan or Paste";

  const description =
    mode === "pick"
      ? "Sync folders directly between devices, peer-to-peer."
      : mode === "share"
        ? "Have the other device scan this QR code or open the link."
        : "Scan the QR code from the other device or paste the share link.";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="py-1">
          {mode === "pick" && <ModePicker onPick={(m) => setMode(m)} />}

          {mode === "share" && (
            <>
              {!device ? (
                <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                  <span className="text-sm">Initialising device…</span>
                </div>
              ) : (
                <ShareFlow
                  device={device}
                  sessionId={sessionId}
                  readyPeers={readyPeers}
                  prevPeersRef={prevPeersRef}
                  onCreatePair={onCreatePair}
                  onDone={handleDone}
                />
              )}
            </>
          )}

          {mode === "join" && (
            <JoinFlow onCreatePair={onCreatePair} onDone={handleDone} />
          )}
        </div>

        {mode !== "pick" && (
          <DialogFooter className="pt-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMode("pick")}
              className="gap-1.5 text-xs"
            >
              <X className="size-3.5" />
              Back
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
