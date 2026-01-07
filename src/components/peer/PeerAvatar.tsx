import { Monitor, Smartphone, Tablet, Laptop } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

interface Peer {
  id: string
  name: string
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'laptop'
  isOnline: boolean
  lastSeen?: number
}

interface PeerAvatarProps {
  peer: Peer
  position: { x: number; y: number }
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

export function PeerAvatar({ peer, position, isSelected, onClick, hasFiles }: PeerAvatarProps) {
  const Icon = deviceIcons[peer.deviceType]

  return (
    <button
      onClick={onClick}
      disabled={!peer.isOnline}
      className={cn(
        'absolute group transition-all duration-300',
        peer.isOnline ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
      )}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      {/* Ripple effect when selected or has files */}
      {(isSelected || hasFiles) && peer.isOnline && (
        <>
          <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" style={{ animationDuration: '2s' }} />
          <div className="absolute inset-0 rounded-full bg-primary/10 animate-pulse" />
        </>
      )}

      {/* Main Avatar */}
      <div className="relative">
        <Avatar
          className={cn(
            'h-20 w-20 border-4 transition-all duration-300',
            peer.isOnline
              ? 'border-border/50 hover:border-primary/50 hover:scale-110'
              : 'border-border/20',
            isSelected && 'border-primary scale-110 shadow-2xl'
          )}
        >
          <AvatarFallback className={cn('bg-gradient-to-br', deviceColors[peer.deviceType])}>
            <Icon className="h-10 w-10 text-white" />
          </AvatarFallback>
        </Avatar>

        {/* Online indicator */}
        {peer.isOnline && (
          <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-green-500 border-2 border-background animate-pulse" />
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
          'absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap',
          'px-3 py-1 rounded-full bg-background/80 backdrop-blur-sm border border-border/50',
          'text-xs font-medium transition-all duration-300',
          'opacity-0 group-hover:opacity-100',
          isSelected && 'opacity-100'
        )}
      >
        {peer.name}
      </div>
    </button>
  )
}

