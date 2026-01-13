import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Wifi, WifiOff, Users } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface ConnectionStatusProps {
  peerCount: number
  sessionId: string | null
}

export function ConnectionStatus({ peerCount, sessionId }: ConnectionStatusProps) {
  const [open, setOpen] = useState(false)

  if (!sessionId) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9 touch-manipulation">
            <WifiOff className="h-4 w-4 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48">
          <div className="text-sm">
            <p className="font-medium mb-1">Offline</p>
            <p className="text-xs text-muted-foreground">
              No session active
            </p>
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9 relative touch-manipulation">
          <Wifi className="h-4 w-4 text-green-500" />
          {peerCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-green-500 text-[10px] font-medium text-white flex items-center justify-center">
              {peerCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">
              {peerCount === 0 ? 'Waiting for peers' : `${peerCount} peer${peerCount === 1 ? '' : 's'} connected`}
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            <p>Session: {sessionId.slice(0, 8)}...</p>
            {peerCount === 0 && (
              <p className="mt-1">Share the link above to invite others</p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
