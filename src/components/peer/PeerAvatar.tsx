import {
  Monitor,
  Smartphone,
  Tablet,
  Laptop,
  Loader2,
  Check,
  FolderSync,
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
  onSyncClick?: () => void;
}

const deviceIcons = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
};

const deviceColors = {
  desktop: "from-blue-500 to-cyan-500",
  mobile: "from-purple-500 to-pink-500",
  tablet: "from-green-500 to-emerald-500",
  laptop: "from-orange-500 to-amber-500",
};

/**
 * Generate a deterministic hash from a string
 * Used to create consistent robohash avatar IDs
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Generate robohash avatar URL
 * Uses different sets for variety: set1 (robots), set2 (monsters), set3 (heads), set4 (kittens), set5 (humanoids)
 */
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
  onSyncClick,
}: PeerAvatarProps) {
  const Icon = deviceIcons[peer.deviceType];
  const [imageError, setImageError] = useState(false);

  // Generate robohash avatar URL - use different sets based on device type for variety
  const avatarUrl = useMemo(() => {
    const setMap: Record<
      typeof peer.deviceType,
      "set1" | "set2" | "set3" | "set4" | "set5"
    > = {
      desktop: "set1", // Robots
      laptop: "set2", // Monsters
      mobile: "set3", // Heads
      tablet: "set4", // Kittens
    };
    return getRobohashAvatar(peer.id, setMap[peer.deviceType]);
  }, [peer.id, peer.deviceType]);

  return (
    <div
      className={cn(
        "absolute group transition-all duration-300",
        peer.isOnline ? "cursor-pointer" : "cursor-not-allowed opacity-50",
      )}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: "translate(-50%, -50%)",
      }}
    >
      {/* Avatar button */}
      <button onClick={onClick} disabled={!peer.isOnline} className="block">
        {/* Ripple effect when selected or has files */}
        {(isSelected || hasFiles) && peer.isOnline && (
          <>
            <div
              className="absolute inset-0 rounded-full bg-primary/20 animate-ping"
              style={{ animationDuration: "2s" }}
            />
            <div className="absolute inset-0 rounded-full bg-primary/10 animate-pulse" />
          </>
        )}

        {/* Main Avatar */}
        <div className="relative">
          <Avatar
            className={cn(
              "h-20 w-20 border-4 transition-all duration-300 overflow-hidden",
              peer.isOnline
                ? "border-border/50 hover:border-primary/50 hover:scale-110"
                : "border-border/20",
              isSelected && "border-primary scale-110 shadow-2xl",
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
                className={cn(
                  "bg-gradient-to-br",
                  deviceColors[peer.deviceType],
                )}
              >
                <Icon className="h-10 w-10 text-white" />
              </AvatarFallback>
            )}
          </Avatar>

          {/* Device type badge - small icon overlay */}
          <div
            className={cn(
              "absolute -bottom-1 -left-1 h-6 w-6 rounded-full border-2 border-background",
              "bg-background/90 backdrop-blur-sm flex items-center justify-center",
              "shadow-sm",
            )}
          >
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          </div>

          {/* Connection status indicator */}
          {peer.isOnline && (
            <div
              className={cn(
                "absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-background flex items-center justify-center",
                isReady ? "bg-green-500" : "bg-yellow-500",
              )}
            >
              {isReady ? (
                <Check className="h-3 w-3 text-white" />
              ) : (
                <Loader2 className="h-3 w-3 text-white animate-spin" />
              )}
            </div>
          )}

          {/* Send indicator */}
          {hasFiles && peer.isOnline && (
            <div className="absolute -top-1 -right-1">
              <div className="h-4 w-4 rounded-full bg-primary animate-ping" />
              <div className="absolute top-0 right-0 h-4 w-4 rounded-full bg-primary" />
            </div>
          )}
        </div>

        {/* Device Name */}
        <div
          className={cn(
            "absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap",
            "px-3 py-1 rounded-full bg-background/80 backdrop-blur-sm border border-border/50",
            "text-xs font-medium transition-all duration-300",
            "opacity-0 group-hover:opacity-100",
            isSelected && "opacity-100",
          )}
        >
          <span>{peer.name}</span>
          {peer.isOnline && !isReady && (
            <span className="ml-1.5 text-yellow-500">• Connecting...</span>
          )}
          {isReady && <span className="ml-1.5 text-green-500">• Ready</span>}
        </div>
      </button>

      {/* Sync folder button — appears below avatar when peer is ready */}
      {isReady && onSyncClick && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSyncClick();
          }}
          className={cn(
            "absolute top-full mt-9 left-1/2 -translate-x-1/2 whitespace-nowrap",
            "flex items-center gap-1 px-2.5 py-1 rounded-full",
            "bg-background/90 backdrop-blur-sm border border-primary/30",
            "text-[11px] font-medium text-primary",
            "shadow-sm hover:shadow-md hover:bg-primary/10 hover:border-primary/60",
            "transition-all duration-200",
            "opacity-0 group-hover:opacity-100 group-hover:translate-y-0",
            "translate-y-1",
          )}
          title={`Sync a folder with ${peer.name}`}
        >
          <FolderSync className="h-3 w-3" />
          Sync folder
        </button>
      )}
    </div>
  );
}
