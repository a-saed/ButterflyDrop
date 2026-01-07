import { useEffect, useRef } from 'react'

export function ButterflyLogo() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let wingPhase = 0

    const drawButterfly = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const centerX = canvas.width / 2
      const centerY = canvas.height / 2

      ctx.save()
      ctx.translate(centerX, centerY)

      // Wing flap calculation (gentle, slow flapping)
      wingPhase += 0.08
      const wingAngle = Math.sin(wingPhase) * 0.3

      // Scale up the butterfly
      ctx.scale(1.5, 1.5)

      // Body
      ctx.fillStyle = '#3b82f6'
      ctx.beginPath()
      ctx.ellipse(0, 0, 2, 8, 0, 0, Math.PI * 2)
      ctx.fill()

      // Head
      ctx.beginPath()
      ctx.arc(0, -8, 3, 0, Math.PI * 2)
      ctx.fill()

      // Left wing
      ctx.save()
      ctx.rotate(wingAngle)
      
      ctx.fillStyle = '#60a5fa'
      ctx.beginPath()
      ctx.ellipse(-8, -4, 10, 7, -0.2, 0, Math.PI * 2)
      ctx.fill()
      
      ctx.fillStyle = '#93c5fd'
      ctx.beginPath()
      ctx.ellipse(-10, -4, 5, 4, -0.2, 0, Math.PI * 2)
      ctx.fill()
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.beginPath()
      ctx.arc(-11, -5, 1.5, 0, Math.PI * 2)
      ctx.arc(-8, -3, 1, 0, Math.PI * 2)
      ctx.fill()
      
      ctx.restore()

      // Right wing
      ctx.save()
      ctx.rotate(-wingAngle)
      
      ctx.fillStyle = '#60a5fa'
      ctx.beginPath()
      ctx.ellipse(8, -4, 10, 7, 0.2, 0, Math.PI * 2)
      ctx.fill()
      
      ctx.fillStyle = '#93c5fd'
      ctx.beginPath()
      ctx.ellipse(10, -4, 5, 4, 0.2, 0, Math.PI * 2)
      ctx.fill()
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.beginPath()
      ctx.arc(11, -5, 1.5, 0, Math.PI * 2)
      ctx.arc(8, -3, 1, 0, Math.PI * 2)
      ctx.fill()
      
      ctx.restore()

      // Antennae
      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth = 1
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-1.5, -10)
      ctx.quadraticCurveTo(-2.5, -13, -3, -15)
      ctx.moveTo(1.5, -10)
      ctx.quadraticCurveTo(2.5, -13, 3, -15)
      ctx.stroke()

      ctx.fillStyle = '#3b82f6'
      ctx.beginPath()
      ctx.arc(-3, -15, 1, 0, Math.PI * 2)
      ctx.arc(3, -15, 1, 0, Math.PI * 2)
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
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={64}
      height={64}
      className="w-8 h-8"
      style={{ imageRendering: 'auto' }}
    />
  )
}

