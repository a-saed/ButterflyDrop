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

  // Derive ring appearance from state — one ring only, inside the button
  const ringColor = isSelected
    ? "border-primary/55"
    : showFileReadyRing
      ? "border-primary/40"
      : "border-emerald-400/30";

  const ringDuration = isSelected ? "2s" : showFileReadyRing ? "1.8s" : "3s";

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
      {/* Avatar button — all rings live INSIDE here so they wrap the circle only */}
      <button
        onClick={onClick}
        disabled={!peer.isOnline}
        className="relative block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
        aria-label={`${peer.name} — ${isReady ? "connected" : "connecting"}`}
      >
        {/* Single subtle ping ring — sized to the avatar, never touches the label */}
        {isReady && (
          <span
            className={cn(
              "absolute inset-[-5px] rounded-full border pointer-events-none animate-ping",
              ringColor,
            )}
            style={{ animationDuration: ringDuration }}
            aria-hidden
          />
        )}

        <Avatar
          className={cn(
            "h-20 w-20 border-4 transition-all duration-300 shadow-lg overflow-hidden",
            peer.isOnline
              ? "hover:scale-110 hover:shadow-2xl"
              : "border-border/20",
            isSelected
              ? "border-primary scale-110 shadow-primary/25 shadow-xl"
              : showFileReadyRing
                ? "border-primary/50"
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

        {/* Connection status dot — bottom-right */}
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

        {/* Files-ready dot — top-right */}
        {showFileReadyRing && (
          <div className="absolute -top-1 -right-1" aria-hidden>
            <span className="relative flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-primary items-center justify-center">
                <Send className="h-2.5 w-2.5 text-primary-foreground" />
              </span>
            </span>
          </div>
        )}
      </button>

      {/* Name + status label — below the button, never overlapped by rings */}
      <div className="flex flex-col items-center gap-0.5 pointer-events-none">
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
              ? "Ready — tap Send below"
              : "Connected"
            : "Connecting…"}
        </span>
      </div>
    </div>
  );
}
