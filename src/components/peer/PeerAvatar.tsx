import {
  Monitor,
  Smartphone,
  Tablet,
  Laptop,
  Loader2,
  Check,
  Send,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";

interface Peer {
  id: string;
  name: string;
  deviceType: "desktop" | "mobile" | "tablet" | "laptop";
  isOnline: boolean;
  lastSeen?: number;
}

interface PeerAvatarProps {
  peer: Peer;
  position: { x: number; y: number };
  isSelected?: boolean;
  onClick?: () => void;
  hasFiles?: boolean;
  isReady?: boolean;
}

const deviceIcons = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
};

const deviceColors: Record<Peer["deviceType"], string> = {
  desktop: "from-blue-500 to-cyan-500",
  mobile: "from-purple-500 to-pink-500",
  tablet: "from-green-500 to-emerald-500",
  laptop: "from-orange-500 to-amber-500",
};

const deviceRingColors: Record<Peer["deviceType"], string> = {
  desktop: "ring-cyan-400/60",
  mobile: "ring-pink-400/60",
  tablet: "ring-emerald-400/60",
  laptop: "ring-amber-400/60",
};

/**
 * Deterministic hash used to pick a robohash avatar so the same peer always
 * gets the same robot/monster face across refreshes.
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function getRobohashAvatar(
  peerId: string,
  setName: "set1" | "set2" | "set3" | "set4" | "set5" = "set1",
): string {
  const hash = hashString(peerId);
  return `https://robohash.org/${hash}?set=${setName}&size=300x300`;
}

export function PeerAvatar({
  peer,
  position,
  isSelected,
  onClick,
  hasFiles,
  isReady = false,
}: PeerAvatarProps) {
  const Icon = deviceIcons[peer.deviceType];
  const [imageError, setImageError] = useState(false);

  const avatarUrl = useMemo(() => {
    const setMap: Record<
      Peer["deviceType"],
      "set1" | "set2" | "set3" | "set4" | "set5"
    > = {
      desktop: "set1",
      laptop: "set2",
      mobile: "set3",
      tablet: "set4",
    };
    return getRobohashAvatar(peer.id, setMap[peer.deviceType]);
  }, [peer.id, peer.deviceType]);

  const showSendHint = hasFiles && isReady && isSelected;
  const showFileReadyRing = hasFiles && isReady;

  return (
    <div
      className={cn(
        "absolute flex flex-col items-center gap-2 group",
        peer.isOnline ? "cursor-pointer" : "cursor-not-allowed opacity-50",
      )}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: "translateX(-50%)",
      }}
    >
      {/* Outer glow rings when selected or has files */}
      {isSelected && peer.isOnline && (
        <>
          <div
            className="absolute inset-0 rounded-full bg-primary/15 blur-2xl scale-150 animate-pulse"
            aria-hidden
          />
          <div
            className={cn(
              "absolute rounded-full border-2 animate-ping opacity-40",
              "inset-[-8px]",
              deviceRingColors[peer.deviceType],
              "border-current",
            )}
            style={{ animationDuration: "2s" }}
            aria-hidden
          />
        </>
      )}

      {/* File-ready pulsing halo */}
      {showFileReadyRing && !isSelected && (
        <div
          className="absolute inset-[-4px] rounded-full border-2 border-primary/50 animate-ping opacity-60"
          style={{ animationDuration: "1.5s" }}
          aria-hidden
        />
      )}

      {/* Avatar button */}
      <button
        onClick={onClick}
        disabled={!peer.isOnline}
        className="relative block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
        aria-label={`${peer.name} — ${isReady ? "connected" : "connecting"}`}
      >
        <Avatar
          className={cn(
            "h-20 w-20 border-4 transition-all duration-300 shadow-lg overflow-hidden",
            peer.isOnline
              ? "hover:scale-110 hover:shadow-2xl"
              : "border-border/20",
            isSelected
              ? "border-primary scale-110 shadow-primary/30 shadow-2xl"
              : showFileReadyRing
                ? "border-primary/60"
                : "border-background/80",
          )}
        >
          {!imageError ? (
            <>
              <AvatarImage
                src={avatarUrl}
                alt={peer.name}
                onError={() => setImageError(true)}
                className="object-cover"
              />
              <AvatarFallback
                className={cn(
                  "bg-gradient-to-br",
                  deviceColors[peer.deviceType],
                )}
              >
                <Icon className="h-10 w-10 text-white" />
              </AvatarFallback>
            </>
          ) : (
            <AvatarFallback
              className={cn("bg-gradient-to-br", deviceColors[peer.deviceType])}
            >
              <Icon className="h-10 w-10 text-white" />
            </AvatarFallback>
          )}
        </Avatar>

        {/* Device-type badge — bottom-left */}
        <div
          className={cn(
            "absolute -bottom-1 -left-1 h-6 w-6 rounded-full border-2 border-background",
            "bg-background/95 backdrop-blur-sm flex items-center justify-center shadow-sm",
          )}
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>

        {/* Connection status — bottom-right */}
        {peer.isOnline && (
          <div
            className={cn(
              "absolute -bottom-1 -right-1 h-6 w-6 rounded-full border-2 border-background",
              "flex items-center justify-center shadow-sm transition-colors duration-300",
              isReady ? "bg-emerald-500" : "bg-yellow-400",
            )}
            title={isReady ? "Connected & ready" : "Establishing connection…"}
          >
            {isReady ? (
              <Check className="h-3 w-3 text-white" />
            ) : (
              <Loader2 className="h-3 w-3 text-white animate-spin" />
            )}
          </div>
        )}

        {/* Files-ready indicator — top-right, pulsing dot */}
        {showFileReadyRing && (
          <div className="absolute -top-1 -right-1" aria-hidden>
            <span className="relative flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-primary items-center justify-center">
                <Send className="h-2.5 w-2.5 text-primary-foreground" />
              </span>
            </span>
          </div>
        )}
      </button>

      {/* Always-visible name label */}
      <div
        className={cn(
          "flex flex-col items-center gap-0.5 pointer-events-none",
          "transition-all duration-200",
        )}
      >
        <span
          className={cn(
            "px-3 py-1 rounded-full text-xs font-semibold shadow-sm border whitespace-nowrap",
            "backdrop-blur-sm transition-colors duration-200",
            isSelected
              ? "bg-primary text-primary-foreground border-primary/30"
              : "bg-background/85 border-border/50 text-foreground",
          )}
        >
          {peer.name}
        </span>

        {/* Status sub-label */}
        <span
          className={cn(
            "text-[10px] font-medium transition-colors duration-200",
            isReady
              ? isSelected
                ? "text-emerald-500"
                : "text-emerald-500/80"
              : "text-yellow-500",
          )}
        >
          {isReady
            ? showSendHint
              ? "Ready — click Send below"
              : "Connected"
            : "Connecting…"}
        </span>
      </div>
    </div>
  );
}
