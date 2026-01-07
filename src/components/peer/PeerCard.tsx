import { Monitor, Smartphone, Tablet, Laptop } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Peer {
  id: string
  name: string
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'laptop'
  isOnline: boolean
  lastSeen?: number
}

interface PeerCardProps {
  peer: Peer
  isSelected?: boolean
  onClick?: () => void
  hasFiles?: boolean
}

const deviceIcons = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
}

const deviceColors = {
  desktop: 'from-blue-500 to-cyan-500',
  mobile: 'from-purple-500 to-pink-500',
  tablet: 'from-green-500 to-emerald-500',
  laptop: 'from-orange-500 to-amber-500',
}

export function PeerCard({ peer, isSelected, onClick, hasFiles }: PeerCardProps) {
  const Icon = deviceIcons[peer.deviceType]

  return (
    <button
      onClick={onClick}
      disabled={!peer.isOnline}
      className={cn(
        'relative group w-full p-6 rounded-2xl border-2 transition-all duration-300',
        'hover:scale-105 hover:shadow-xl',
        peer.isOnline
          ? 'border-border/50 hover:border-primary/50 bg-card cursor-pointer'
          : 'border-border/20 bg-muted/30 opacity-50 cursor-not-allowed',
        isSelected && 'border-primary bg-primary/5 scale-105 shadow-xl',
        hasFiles && peer.isOnline && 'animate-pulse'
      )}
    >
      {/* Glow effect when selected */}
      {isSelected && (
        <div className="absolute inset-0 rounded-2xl bg-primary/10 blur-xl -z-10" />
      )}

      {/* Device Avatar */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <Avatar className="h-16 w-16 border-2 border-border">
            <AvatarFallback className={cn('bg-gradient-to-br', deviceColors[peer.deviceType])}>
              <Icon className="h-8 w-8 text-white" />
            </AvatarFallback>
          </Avatar>
          
          {/* Online indicator */}
          {peer.isOnline && (
            <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-green-500 border-2 border-background animate-pulse" />
          )}
        </div>

        {/* Device Name */}
        <div className="text-center">
          <p className="font-medium text-sm truncate max-w-[120px]">
            {peer.name}
          </p>
          <p className="text-xs text-muted-foreground capitalize">
            {peer.deviceType}
          </p>
        </div>

        {/* Status Badge */}
        {peer.isOnline ? (
          <Badge variant="default" className="text-xs">
            Ready
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">
            Offline
          </Badge>
        )}

        {/* Send indicator */}
        {hasFiles && peer.isOnline && (
          <div className="absolute top-2 right-2">
            <div className="h-3 w-3 rounded-full bg-primary animate-ping" />
            <div className="absolute top-0 right-0 h-3 w-3 rounded-full bg-primary" />
          </div>
        )}
      </div>
    </button>
  )
}

