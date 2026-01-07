import { useEffect, useRef } from 'react'
import { formatFileSize } from '@/lib/fileUtils'
import type { TransferProgress } from '@/types/transfer'

interface ButterflyProgressProps {
  progress: TransferProgress
}

export function ButterflyProgress({ progress }: ButterflyProgressProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number>()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    const progressPercent = progress.percentage / 100

    // Butterfly position based on progress
    const butterflyX = 60 + (width - 120) * progressPercent
    const butterflyY = height / 2

    // Wing flap animation
    let wingPhase = 0

    const drawButterfly = () => {
      ctx.clearRect(0, 0, width, height)

      // Draw progress track
      ctx.strokeStyle = 'rgba(100, 100, 100, 0.2)'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(40, height / 2)
      ctx.lineTo(width - 40, height / 2)
      ctx.stroke()

      // Draw progress line (behind butterfly)
      if (progressPercent > 0) {
        const gradient = ctx.createLinearGradient(40, 0, butterflyX, 0)
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)')
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0.8)')
        
        ctx.strokeStyle = gradient
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(40, height / 2)
        ctx.lineTo(butterflyX, height / 2)
        ctx.stroke()
      }

      // Draw butterfly
      ctx.save()
      ctx.translate(butterflyX, butterflyY)

      // Wing flap calculation (smooth sine wave)
      wingPhase += 0.15
      const wingAngle = Math.sin(wingPhase) * 0.4 // Flap range

      // Body
      ctx.fillStyle = '#3b82f6'
      ctx.beginPath()
      ctx.ellipse(0, 0, 4, 15, 0, 0, Math.PI * 2)
      ctx.fill()

      // Head
      ctx.beginPath()
      ctx.arc(0, -15, 5, 0, Math.PI * 2)
      ctx.fill()

      // Left wing
      ctx.save()
      ctx.rotate(wingAngle)
      
      // Outer wing
      ctx.fillStyle = '#60a5fa'
      ctx.beginPath()
      ctx.ellipse(-15, -8, 18, 12, -0.2, 0, Math.PI * 2)
      ctx.fill()
      
      // Inner wing pattern
      ctx.fillStyle = '#93c5fd'
      ctx.beginPath()
      ctx.ellipse(-18, -8, 10, 7, -0.2, 0, Math.PI * 2)
      ctx.fill()
      
      // Wing spots
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.beginPath()
      ctx.arc(-20, -10, 3, 0, Math.PI * 2)
      ctx.arc(-15, -5, 2, 0, Math.PI * 2)
      ctx.fill()
      
      ctx.restore()

      // Right wing
      ctx.save()
      ctx.rotate(-wingAngle)
      
      // Outer wing
      ctx.fillStyle = '#60a5fa'
      ctx.beginPath()
      ctx.ellipse(15, -8, 18, 12, 0.2, 0, Math.PI * 2)
      ctx.fill()
      
      // Inner wing pattern
      ctx.fillStyle = '#93c5fd'
      ctx.beginPath()
      ctx.ellipse(18, -8, 10, 7, 0.2, 0, Math.PI * 2)
      ctx.fill()
      
      // Wing spots
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.beginPath()
      ctx.arc(20, -10, 3, 0, Math.PI * 2)
      ctx.arc(15, -5, 2, 0, Math.PI * 2)
      ctx.fill()
      
      ctx.restore()

      // Antennae
      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-3, -18)
      ctx.quadraticCurveTo(-5, -25, -6, -28)
      ctx.moveTo(3, -18)
      ctx.quadraticCurveTo(5, -25, 6, -28)
      ctx.stroke()

      // Antennae tips
      ctx.fillStyle = '#3b82f6'
      ctx.beginPath()
      ctx.arc(-6, -28, 2, 0, Math.PI * 2)
      ctx.arc(6, -28, 2, 0, Math.PI * 2)
      ctx.fill()

      // Add glow effect
      ctx.shadowBlur = 20
      ctx.shadowColor = 'rgba(59, 130, 246, 0.5)'
      ctx.fillStyle = 'rgba(59, 130, 246, 0.2)'
      ctx.beginPath()
      ctx.arc(0, -5, 25, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()

      animationFrameRef.current = requestAnimationFrame(drawButterfly)
    }

    drawButterfly()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [progress.percentage])

  const speedMBps = (progress.speed / (1024 * 1024)).toFixed(2)
  const etaMinutes = Math.floor(progress.eta / 60)
  const etaSeconds = Math.floor(progress.eta % 60)
  const etaText = etaMinutes > 0 ? `${etaMinutes}m ${etaSeconds}s` : `${etaSeconds}s`

  return (
    <div className="w-full space-y-4 p-6">
      {/* File info */}
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium truncate">{progress.fileName}</span>
        <span className="text-muted-foreground">{progress.percentage.toFixed(0)}%</span>
      </div>

      {/* Canvas Progress Bar with Butterfly */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={800}
          height={100}
          className="w-full h-[100px]"
          style={{ imageRendering: 'crisp-edges' }}
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Transferred</p>
          <p className="font-medium">{formatFileSize(progress.bytesTransferred)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Speed</p>
          <p className="font-medium">{speedMBps} MB/s</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">ETA</p>
          <p className="font-medium">{etaText}</p>
        </div>
      </div>
    </div>
  )
}

