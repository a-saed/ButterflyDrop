import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Wifi, WifiOff, Loader2 } from 'lucide-react'
import type { ConnectionState } from '@/types/webrtc'

interface ConnectionStatusProps {
  connectionState: ConnectionState
  peerName: string | null
}

export function ConnectionStatus({ connectionState, peerName }: ConnectionStatusProps) {
  const getStatusConfig = () => {
    switch (connectionState) {
      case 'connected':
        return {
          icon: Wifi,
          label: 'Connected',
          variant: 'default' as const,
          color: 'text-green-500',
        }
      case 'connecting':
        return {
          icon: Loader2,
          label: 'Connecting...',
          variant: 'secondary' as const,
          color: 'text-yellow-500',
        }
      case 'failed':
        return {
          icon: WifiOff,
          label: 'Connection Failed',
          variant: 'destructive' as const,
          color: 'text-red-500',
        }
      case 'closed':
        return {
          icon: WifiOff,
          label: 'Disconnected',
          variant: 'secondary' as const,
          color: 'text-muted-foreground',
        }
      default:
        return {
          icon: WifiOff,
          label: 'Disconnected',
          variant: 'secondary' as const,
          color: 'text-muted-foreground',
        }
    }
  }

  const config = getStatusConfig()
  const Icon = config.icon

  return (
    <div className="flex items-center gap-3">
      <Avatar className="h-10 w-10">
        <AvatarFallback>
          <Icon className={`h-5 w-5 ${config.color}`} />
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <Badge variant={config.variant}>{config.label}</Badge>
        </div>
        {peerName && connectionState === 'connected' && (
          <p className="text-sm text-muted-foreground">{peerName}</p>
        )}
      </div>
    </div>
  )
}

