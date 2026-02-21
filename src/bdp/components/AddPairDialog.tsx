/**
 * BDP — Add Pair Dialog (Phase F2) — Redesigned
 *
 * Two-mode flow for establishing a new sync pair:
 *
 *   Share mode (this device shows a QR / link):
 *     1. Generate pairId + encode QR payload
 *     2. Display QR code + copyable link
 *     3. Detect when a peer joins readyPeers → advance
 *     4. User picks local folder → pair saved
 *
 *   Join mode (this device received a link / scanned a QR):
 *     1. If ?bdp= is in URL → auto-fill and skip paste step
 *     2. Decode pairId + peer info from payload
 *     3. Call joinSession(decoded.sessionId) to enter the WebRTC room
 *     4. User picks local folder → pair saved
 *
 * UI notes:
 *   - Full-screen on mobile (rounded-none), centered modal on ≥sm
 *   - Large scannable QR code — never overflows
 *   - Step dots show progress within a flow
 *   - Butterfly-themed success state
 */

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ChangeEvent,
} from "react";
import QRCode from "react-qr-code";
import { nanoid } from "nanoid";
import {
  Copy,
  Check,
  Folder,
  QrCode,
  Link2,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  Smartphone,
  Monitor,
  RefreshCw,
  Wifi,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import type { BDPDevice, PairId, SyncPair } from "@/types/bdp";
import type { CreatePairOptions } from "@/bdp/hooks/useBDP";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface QRPayload {
  pairId: string;
  publicKeyB64: string;
  sessionId: string;
  deviceName: string;
}

type DialogMode = "pick" | "share" | "join";
type ShareStep = "qr" | "peer-connected" | "pick-folder" | "done";
type JoinStep = "paste" | "connecting" | "pick-folder" | "done";

export interface AddPairDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  device: BDPDevice | null;
  readyPeers: string[];
  sessionId: string;
  /** Joins the WebRTC signaling room so the two devices can see each other */
  joinSession(sessionId: string): void;
  onCreatePair(options: CreatePairOptions): Promise<SyncPair>;
  /** Pre-decoded payload from ?bdp= URL param — triggers auto-join mode */
  autoJoinPayload?: QRPayload | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload helpers
// ─────────────────────────────────────────────────────────────────────────────

// These are exported as plain functions (not components) — kept here for
// co-location with the QRPayload type. Fast Refresh only warns on mixed files
// but these are purely used by App.tsx at import time, not rendered.
// eslint-disable-next-line react-refresh/only-export-components
export function encodeQRPayload(payload: QRPayload): string {
  return btoa(JSON.stringify(payload));
}

// eslint-disable-next-line react-refresh/only-export-components
export function decodeQRPayload(encoded: string): QRPayload | null {
  try {
    const decoded = JSON.parse(atob(encoded.trim())) as unknown;
    if (
      decoded !== null &&
      typeof decoded === "object" &&
      "pairId" in decoded &&
      "publicKeyB64" in decoded &&
      "sessionId" in decoded &&
      "deviceName" in decoded
    ) {
      return decoded as QRPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function extractBDPParam(input: string): string {
  const trimmed = input.trim();
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

// ─────────────────────────────────────────────────────────────────────────────
// Folder picker
// ─────────────────────────────────────────────────────────────────────────────

async function pickFolder(): Promise<{
  name: string;
  handle: FileSystemDirectoryHandle | null;
  useRealFS: boolean;
} | null> {
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
      if (err instanceof DOMException && err.name === "AbortError") return null;
    }
  }
  const name = prompt(
    "Enter a name for this sync folder (files will live in your browser's private storage):",
    "My Sync Folder",
  );
  if (!name) return null;
  return { name, handle: null, useRealFS: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny reusable atoms
// ─────────────────────────────────────────────────────────────────────────────

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-1">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "rounded-full transition-all duration-300",
            i < current
              ? "bg-primary w-4 h-1.5"
              : i === current
                ? "bg-primary w-4 h-1.5 opacity-100"
                : "bg-muted w-1.5 h-1.5",
          )}
        />
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium shrink-0",
        "transition-all duration-200",
        copied
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
          : "bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground",
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function PulsingDot() {
  return (
    <span className="relative flex size-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
      <span className="relative inline-flex rounded-full size-2.5 bg-amber-500" />
    </span>
  );
}

function SuccessView({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-10">
      {/* Butterfly-inspired success icon */}
      <div className="relative flex items-center justify-center">
        <div className="absolute size-20 rounded-full bg-emerald-500/10 animate-ping" />
        <div className="relative flex items-center justify-center size-16 rounded-full bg-emerald-100 dark:bg-emerald-900/40">
          <CheckCircle2 className="size-8 text-emerald-600 dark:text-emerald-400" />
        </div>
      </div>
      <div className="text-center space-y-1.5">
        <p className="font-semibold text-base">{message}</p>
        <p className="text-sm text-muted-foreground">
          Syncing will begin when both devices are online.
        </p>
      </div>
    </div>
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
  const [newPeerName, setNewPeerName] = useState<string | null>(null);

  // Stable pairId for this dialog session
  const pairIdRef = useRef<PairId>(nanoid(32) as PairId);

  const qrEncoded = useMemo(
    () =>
      encodeQRPayload({
        pairId: pairIdRef.current,
        publicKeyB64: device.publicKeyB64,
        sessionId,
        deviceName: device.deviceName,
      }),
    [device.publicKeyB64, device.deviceName, sessionId],
  );

  const shareUrl = useMemo(() => buildShareUrl(qrEncoded), [qrEncoded]);

  // Detect new peer joining
  useEffect(() => {
    if (step !== "qr") return;
    const prev = prevPeersRef.current ?? [];
    const newPeers = readyPeers.filter((id) => !prev.includes(id));
    if (newPeers.length > 0) {
      // Try to get a friendly peer name from the first new peer
      setNewPeerName(null);
      setStep("peer-connected");
    }
  }, [readyPeers, step, prevPeersRef]);

  const handlePickFolder = useCallback(async () => {
    const result = await pickFolder();
    if (!result) return;

    setCreating(true);
    setError(null);
    try {
      await onCreatePair({
        // CRITICAL: must reuse the same pairId that was encoded in the QR code.
        // Without this, the sender gets a different random pairId from the
        // receiver, causing BDP_HELLO to fail immediately ("pair not found").
        pairId: pairIdRef.current,
        folderName: result.name,
        handle: result.handle,
        useRealFS: result.useRealFS,
      });
      setStep("done");
      setTimeout(onDone, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [onCreatePair, onDone]);

  if (step === "done") {
    return <SuccessView message="Sync pair created!" />;
  }

  if (step === "peer-connected") {
    return (
      <div className="flex flex-col items-center gap-6 py-6 px-2">
        <StepDots total={3} current={1} />

        {/* Connected indicator */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="flex items-center justify-center size-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <Wifi className="size-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-500">
              <Check className="size-2.5 text-white" />
            </span>
          </div>
          <div className="text-center">
            <p className="font-semibold text-base">
              {newPeerName ? `${newPeerName} connected!` : "Device connected!"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Now choose which local folder to sync.
            </p>
          </div>
        </div>

        {error && (
          <p className="w-full text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2 text-center">
            {error}
          </p>
        )}

        <Button
          onClick={handlePickFolder}
          disabled={creating}
          size="lg"
          className="w-full gap-2 rounded-xl"
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

  // QR step
  return (
    <div className="flex flex-col gap-5">
      <StepDots total={3} current={0} />

      {/* QR Code — always square, always fits */}
      <div className="flex justify-center">
        <div className="p-3 bg-white rounded-2xl shadow-md border border-border/40 w-fit">
          <QRCode
            value={shareUrl}
            size={Math.min(240, window.innerWidth - 112)}
            level="M"
            style={{ display: "block" }}
          />
        </div>
      </div>

      {/* Share link row */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground px-0.5">
          Or share this link
        </p>
        <div className="flex items-center gap-2 rounded-xl border bg-muted/50 px-3 py-2.5">
          <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs text-muted-foreground truncate font-mono min-w-0">
            {shareUrl}
          </span>
          <CopyButton text={shareUrl} />
        </div>
      </div>

      {/* Waiting indicator */}
      <div className="flex items-center gap-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 px-4 py-3">
        <PulsingDot />
        <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
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
  joinSession(sessionId: string): void;
  readyPeers: string[];
  prevPeersRef: React.RefObject<string[]>;
  onCreatePair(options: CreatePairOptions): Promise<SyncPair>;
  onDone(): void;
  /** Pre-decoded payload from ?bdp= — skip paste step */
  autoPayload?: QRPayload | null;
}

function JoinFlow({
  joinSession,
  readyPeers,
  prevPeersRef,
  onCreatePair,
  onDone,
  autoPayload,
}: JoinFlowProps) {
  const [step, setStep] = useState<JoinStep>(
    autoPayload ? "connecting" : "paste",
  );
  const [input, setInput] = useState("");
  const [decoded, setDecoded] = useState<QRPayload | null>(autoPayload ?? null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const hasJoinedRef = useRef(false);

  // Auto-join the WebRTC session once we have a decoded payload
  useEffect(() => {
    if (!decoded || hasJoinedRef.current) return;
    hasJoinedRef.current = true;
    joinSession(decoded.sessionId);
    setStep("connecting");
  }, [decoded, joinSession]);

  // Stable key so the effect only re-runs when the actual peer set changes.
  // (readyPeers from context is a new array every render, which would otherwise
  // reset the 2s fallback every time and "Connecting" would never advance.)
  const readyPeersKey = [...readyPeers].sort().join(",");

  // Once in "connecting", watch for the sender to appear in readyPeers
  // Fall back to a timeout so the UI doesn't stall if the peer is already connected
  useEffect(() => {
    if (step !== "connecting") return;

    const prev = prevPeersRef.current ?? [];
    const newPeers = readyPeers.filter((id) => !prev.includes(id));
    if (newPeers.length > 0) {
      setStep("pick-folder");
      return;
    }

    // Fallback: proceed after 2 s even if no new peer detected yet
    // (peer may already be in readyPeers from a prior connection)
    const timer = setTimeout(() => setStep("pick-folder"), 2000);
    return () => clearTimeout(timer);
    // readyPeers omitted intentionally: we depend on readyPeersKey so the 2s timer
    // isn't reset on every parent re-render (context passes a new array ref each time).
  }, [step, readyPeersKey, prevPeersRef]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setInput(val);
      setDecodeError(null);
      setDecoded(null);

      if (!val.trim()) return;
      const raw = extractBDPParam(val);
      const payload = decodeQRPayload(raw);
      if (payload) {
        setDecoded(payload);
      } else {
        setDecodeError("Couldn't read this link — paste the full share URL");
      }
    },
    [],
  );

  const handlePickFolder = useCallback(async () => {
    if (!decoded) return;
    const result = await pickFolder();
    if (!result) return;

    setCreating(true);
    setError(null);
    try {
      // Pass the sender's pairId so both sides share the same pair identifier.
      // This is required for BDP_HELLO matching to succeed — each side sends
      // its pairId in the hello frame and the peer looks it up locally.
      // We do NOT pass peerInfo here because we don't have the sender's BDP
      // deviceId at this point (only their WebRTC session ID). The greeting
      // exchange will identify devices once the session starts.
      await onCreatePair({
        pairId: decoded.pairId as PairId,
        folderName: result.name,
        handle: result.handle,
        useRealFS: result.useRealFS,
      });
      setStep("done");
      setTimeout(onDone, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [decoded, onCreatePair, onDone]);

  if (step === "done") {
    return <SuccessView message="Joined sync pair!" />;
  }

  if (step === "connecting") {
    return (
      <div className="flex flex-col items-center gap-6 py-10">
        <StepDots total={autoPayload ? 3 : 4} current={autoPayload ? 0 : 1} />
        <div className="flex flex-col items-center gap-3">
          <div className="relative flex items-center justify-center size-16 rounded-full bg-primary/10">
            <Loader2 className="size-8 text-primary animate-spin" />
          </div>
          <div className="text-center">
            <p className="font-semibold">Connecting to device…</p>
            <p className="text-sm text-muted-foreground mt-1">
              {decoded?.deviceName
                ? `Looking for ${decoded.deviceName}`
                : "Joining the sync session"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (step === "pick-folder") {
    return (
      <div className="flex flex-col items-center gap-6 py-6 px-2">
        <StepDots total={autoPayload ? 3 : 4} current={autoPayload ? 1 : 2} />

        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center justify-center size-16 rounded-full bg-primary/10">
            <Folder className="size-7 text-primary" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-base">Choose a folder to sync</p>
            {decoded?.deviceName && (
              <p className="text-sm text-muted-foreground mt-1">
                Pairing with{" "}
                <span className="font-medium text-foreground">
                  {decoded.deviceName}
                </span>
              </p>
            )}
          </div>
        </div>

        {error && (
          <p className="w-full text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2 text-center">
            {error}
          </p>
        )}

        <Button
          onClick={handlePickFolder}
          disabled={creating}
          size="lg"
          className="w-full gap-2 rounded-xl"
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
    <div className="flex flex-col gap-5">
      <StepDots total={4} current={0} />

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Paste the share link from the other device
        </p>
        <textarea
          rows={3}
          value={input}
          onChange={handleInputChange}
          placeholder="https://butterfly-drop.vercel.app/?bdp=…"
          className={cn(
            "w-full rounded-xl border bg-muted/40 px-3.5 py-2.5 text-sm font-mono resize-none leading-relaxed",
            "placeholder:text-muted-foreground/40",
            "focus:outline-none focus:ring-2 focus:ring-ring",
            "transition-colors",
            decodeError &&
              "border-red-400 focus:ring-red-300 dark:border-red-700",
            decoded &&
              "border-emerald-400 focus:ring-emerald-300 dark:border-emerald-700",
          )}
          autoFocus
        />

        {decodeError && (
          <p className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1 px-0.5">
            {decodeError}
          </p>
        )}
        {decoded && (
          <p className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 px-0.5 font-medium">
            <Check className="size-3 shrink-0" />
            Link from{" "}
            <span className="text-emerald-800 dark:text-emerald-300">
              {decoded.deviceName}
            </span>
          </p>
        )}
      </div>

      <Button
        onClick={() => decoded && setStep("connecting")}
        disabled={!decoded}
        size="lg"
        className="w-full rounded-xl gap-2"
      >
        <Wifi className="size-4" />
        Connect & Sync
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode picker
// ─────────────────────────────────────────────────────────────────────────────

function ModePicker({ onPick }: { onPick(mode: "share" | "join"): void }) {
  return (
    <div className="flex flex-col gap-3 py-2">
      {/* Illustration row */}
      <div className="flex items-center justify-center gap-4 py-4">
        <div className="flex items-center justify-center size-12 rounded-2xl bg-muted">
          <Monitor className="size-5 text-muted-foreground" />
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="block w-1 h-1 rounded-full bg-primary/60 animate-bounce"
                style={{ animationDelay: `${i * 100}ms` }}
              />
            ))}
          </div>
          <RefreshCw className="size-4 text-primary" />
        </div>
        <div className="flex items-center justify-center size-12 rounded-2xl bg-muted">
          <Smartphone className="size-5 text-muted-foreground" />
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center -mt-2 mb-1">
        Sync folders directly between devices, peer-to-peer.
      </p>

      {/* Mode buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onPick("share")}
          className={cn(
            "flex flex-col items-center gap-3 rounded-2xl border-2 border-border p-5 text-center",
            "transition-all duration-200",
            "hover:border-primary hover:bg-primary/5 active:scale-[0.97]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary">
            <QrCode className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">Share</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              Generate a QR code for another device to scan
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onPick("join")}
          className={cn(
            "flex flex-col items-center gap-3 rounded-2xl border-2 border-border p-5 text-center",
            "transition-all duration-200",
            "hover:border-primary hover:bg-primary/5 active:scale-[0.97]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary">
            <Link2 className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">Join</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              Paste a link or code from the other device
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Full-screen-on-mobile dialog content wrapper
// ─────────────────────────────────────────────────────────────────────────────

function FullscreenDialogContent({
  children,
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          // Mobile: full screen
          "fixed inset-0 z-50 flex flex-col bg-background outline-none",
          // ≥sm: centred card
          "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
          "sm:rounded-2xl sm:border sm:shadow-2xl sm:w-full sm:max-w-md",
          // animation
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:slide-out-to-bottom sm:data-[state=closed]:slide-out-to-bottom-0",
          "data-[state=open]:slide-in-from-bottom sm:data-[state=open]:slide-in-from-bottom-0",
          "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
          "duration-300",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
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
  joinSession,
  onCreatePair,
  autoJoinPayload,
}: AddPairDialogProps) {
  const [mode, setMode] = useState<DialogMode>("pick");
  const prevPeersRef = useRef<string[]>([]);

  // When dialog opens: snapshot peers, reset mode (or auto-enter join)
  useEffect(() => {
    if (open) {
      prevPeersRef.current = [...readyPeers];
      setMode(autoJoinPayload ? "join" : "pick");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleDone = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const titles: Record<DialogMode, string> = {
    pick: "Add Sync Pair",
    share: "Scan to Connect",
    join: "Join Sync Pair",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FullscreenDialogContent>
        {/* Header — safe area top on PWA mobile so title isn't under status bar */}
        <div className="flex items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top,0px))] pb-3 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {mode !== "pick" && (
              <button
                type="button"
                onClick={() => setMode("pick")}
                className="flex items-center justify-center size-8 rounded-lg hover:bg-muted transition-colors shrink-0"
                aria-label="Back"
              >
                <ArrowLeft className="size-4" />
              </button>
            )}
            <h2 className="text-base font-semibold truncate">{titles[mode]}</h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex items-center justify-center size-8 rounded-lg hover:bg-muted transition-colors shrink-0"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {mode === "pick" && (
            <ModePicker
              onPick={(m) => {
                prevPeersRef.current = [...readyPeers];
                setMode(m);
              }}
            />
          )}

          {mode === "share" && (
            <>
              {!device ? (
                <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
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
            <JoinFlow
              joinSession={joinSession}
              readyPeers={readyPeers}
              prevPeersRef={prevPeersRef}
              onCreatePair={onCreatePair}
              onDone={handleDone}
              autoPayload={autoJoinPayload}
            />
          )}
        </div>

        {/* Safe area bottom padding on mobile */}
        <div className="shrink-0 h-[env(safe-area-inset-bottom,0px)] sm:hidden" />
      </FullscreenDialogContent>
    </Dialog>
  );
}
