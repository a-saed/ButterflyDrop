import { PeerAvatar } from "./PeerAvatar";
import { Copy, QrCode, Check } from "lucide-react";
import { useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import QRCode from "react-qr-code";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Peer {
  id: string;
  name: string;
  deviceType: "desktop" | "mobile" | "tablet" | "laptop";
  isOnline: boolean;
  lastSeen?: number;
}

interface PeerNetworkProps {
  peers: Peer[];
  selectedPeerId?: string;
  onPeerSelect?: (peerId: string) => void;
  hasFiles?: boolean;
  readyPeers?: string[];
  shareableUrl?: string;
}

function generatePeerPositions(
  peers: Peer[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  const safeZones = [
    { x: 50, y: 30 },
    { x: 30, y: 28 },
    { x: 70, y: 28 },
    { x: 20, y: 35 },
    { x: 50, y: 25 },
    { x: 80, y: 35 },
    { x: 15, y: 48 },
    { x: 40, y: 42 },
    { x: 60, y: 42 },
    { x: 85, y: 48 },
  ];

  peers.forEach((peer, index) => {
    const zone = safeZones[index % safeZones.length];
    positions.set(peer.id, zone);
  });

  return positions;
}

// ── Radar empty state ──────────────────────────────────────────────────────

function RadarEmptyState({ shareableUrl }: { shareableUrl?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!shareableUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareableUrl);
      } else {
        const ta = document.createElement("textarea");
        ta.value = shareableUrl;
        ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success("Link copied!", { icon: "📋", duration: 2500 });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy link");
    }
  }, [shareableUrl]);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center select-none pb-32 sm:pb-40">
      {/* ── Center disc — no competing rings, ambient bg already pulses ── */}
      <div className="relative flex items-center justify-center mb-6">
        {/* Soft glow behind the disc */}
        <div className="absolute w-24 h-24 rounded-full bg-primary/10 blur-2xl" />

        {/* Glassy disc */}
        <div className="relative z-10 flex items-center justify-center w-16 h-16 rounded-full bg-background/80 backdrop-blur-sm border border-primary/25 shadow-xl shadow-primary/10">
          <svg
            viewBox="0 0 32 32"
            className="w-8 h-8 text-primary"
            fill="currentColor"
          >
            <path
              d="M16 16 C12 10, 4 8, 5 16 C4 24, 12 22, 16 16"
              style={{
                animation: "butterflyWingL 2.4s ease-in-out infinite",
                transformOrigin: "16px 16px",
              }}
            />
            <path
              d="M16 16 C20 10, 28 8, 27 16 C28 24, 20 22, 16 16"
              style={{
                animation: "butterflyWingR 2.4s ease-in-out infinite",
                transformOrigin: "16px 16px",
              }}
            />
            <circle cx="16" cy="16" r="1.5" />
          </svg>
        </div>
      </div>

      {/* ── Label ── */}
      <p className="text-sm font-semibold text-foreground/80 tracking-wide mb-1">
        Scanning for devices…
      </p>
      <p className="text-xs text-muted-foreground mb-6">
        Share your link to connect instantly
      </p>

      {/* ── Action buttons ── */}
      {shareableUrl && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold
                       bg-background/80 backdrop-blur-sm hover:bg-primary/10 text-primary
                       border border-primary/25 transition-all duration-150 active:scale-95"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copied ? "Copied!" : "Copy link"}
          </button>

          <Dialog>
            <DialogTrigger asChild>
              <button
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold
                           bg-background/80 backdrop-blur-sm hover:bg-muted text-muted-foreground
                           border border-border/50 transition-all duration-150 active:scale-95"
              >
                <QrCode className="w-3.5 h-3.5" />
                QR code
              </button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100%-2rem)] sm:max-w-xs mx-auto">
              <DialogHeader>
                <DialogTitle>Scan to connect</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col items-center gap-4 py-2">
                <div className="p-3 bg-white rounded-xl shadow-inner">
                  <QRCode value={shareableUrl} size={220} level="H" />
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Open this on another device to connect
                </p>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      <style>{`
        @keyframes butterflyWingL {
          0%, 100% { transform: scaleX(1); }
          50%       { transform: scaleX(0.55); }
        }
        @keyframes butterflyWingR {
          0%, 100% { transform: scaleX(1); }
          50%       { transform: scaleX(0.55); }
        }
      `}</style>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function PeerNetwork({
  peers,
  selectedPeerId,
  onPeerSelect,
  hasFiles,
  readyPeers = [],
  shareableUrl,
}: PeerNetworkProps) {
  const peerPositions = useMemo(() => generatePeerPositions(peers), [peers]);

  if (peers.length === 0) {
    return <RadarEmptyState shareableUrl={shareableUrl} />;
  }

  return (
    <div className="relative w-full h-full overflow-hidden">
      {peers.map((peer) => {
        const position = peerPositions.get(peer.id) ?? { x: 50, y: 35 };
        const isReady = readyPeers.includes(peer.id);
        return (
          <PeerAvatar
            key={peer.id}
            peer={peer}
            position={position}
            isSelected={selectedPeerId === peer.id}
            onClick={() => onPeerSelect?.(peer.id)}
            hasFiles={hasFiles && selectedPeerId === peer.id}
            isReady={isReady}
          />
        );
      })}
    </div>
  );
}
