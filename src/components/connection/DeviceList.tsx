import { Laptop, Smartphone, Monitor, Tablet } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Device {
  id: string
  name: string
  type: 'desktop' | 'mobile' | 'tablet'
  isOnline: boolean
}

interface DeviceListProps {
  devices: Device[]
  selectedDeviceId?: string
  onDeviceSelect?: (deviceId: string) => void
}

const deviceIcons = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  default: Laptop,
}

export function DeviceList({
  devices,
  selectedDeviceId,
  onDeviceSelect,
}: DeviceListProps) {
  if (devices.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">No devices found</p>
        <p className="text-xs mt-1">Waiting for peers...</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {devices.map((device) => {
        const Icon = deviceIcons[device.type] || deviceIcons.default
        const isSelected = selectedDeviceId === device.id

        return (
          <button
            key={device.id}
            onClick={() => onDeviceSelect?.(device.id)}
            className={cn(
              'w-full p-4 rounded-lg border transition-butterfly text-left hover-lift',
              'hover:bg-muted/50 hover:border-primary/50',
              isSelected && 'bg-primary/5 border-primary animate-pulse-glow',
              !device.isOnline && 'opacity-50'
            )}
          >
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12">
                <AvatarFallback className="bg-primary/10">
                  <Icon className="h-6 w-6 text-primary" />
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{device.name}</p>
                  {device.isOnline && (
                    <Badge variant="default" className="h-5 text-xs">
                      Online
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground capitalize">
                  {device.type}
                </p>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

