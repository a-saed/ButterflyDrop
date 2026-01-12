import { Badge } from '@/components/ui/badge'
import { Wifi, WifiOff } from 'lucide-react'

interface ConnectionStatusProps {
  peerCount: number
  sessionId: string | null
}

export function ConnectionStatus({ peerCount, sessionId }: ConnectionStatusProps) {
  if (!sessionId) {
    return (
      <div className="flex items-center gap-2">
        <WifiOff className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Offline</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Wifi className="h-4 w-4 text-green-500" />
      <Badge variant="outline" className="text-xs">
        {peerCount === 0 ? 'Online - Waiting' : `${peerCount} ${peerCount === 1 ? 'peer' : 'peers'}`}
      </Badge>
    </div>
  )
}

