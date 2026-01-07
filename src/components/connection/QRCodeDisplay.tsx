import { QRCodeSVG } from 'react-qr-code'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Copy, Check } from 'lucide-react'
import { useState } from 'react'

interface QRCodeDisplayProps {
  url: string
}

export function QRCodeDisplay({ url }: QRCodeDisplayProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy URL:', error)
    }
  }

  return (
    <Card className="p-6">
      <div className="flex flex-col items-center gap-4">
        <h3 className="text-lg font-semibold">Share this link</h3>
        <div className="p-4 bg-white rounded-lg">
          <QRCodeSVG value={url} size={200} />
        </div>
        <div className="flex items-center gap-2 w-full">
          <input
            type="text"
            value={url}
            readOnly
            className="flex-1 px-3 py-2 text-sm border rounded-md bg-muted"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleCopy}
            className="shrink-0"
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground text-center">
          Scan the QR code or copy the link to share with another device
        </p>
      </div>
    </Card>
  )
}

