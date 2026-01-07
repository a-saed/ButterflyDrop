import { useEffect, useRef, useState } from 'react'

interface ButterflyCanvasProps {
  isActive: boolean
  variant: 'fly-across' | 'fly-to-peer' | 'success' | 'error'
  targetPosition?: { x: number; y: number }
  onComplete?: () => void
}

interface Butterfly {
  x: number
  y: number
  wingAngle: number
  scale: number
  opacity: number
  speed: number
}

export function ButterflyCanvas({ isActive, variant, targetPosition, onComplete }: ButterflyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number | undefined>(undefined)
  const butterflyRef = useRef<Butterfly>({
    x: -50,
    y: window.innerHeight / 2,
    wingAngle: 0,
    scale: 1,
    opacity: 1,
    speed: 5,
  })

  useEffect(() => {
    if (!isActive) return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    // Initialize butterfly position based on variant
    if (variant === 'fly-across') {
      butterflyRef.current = {
        x: -100,
        y: window.innerHeight / 2 + (Math.random() - 0.5) * 100,
        wingAngle: 0,
        scale: 2.5, // Bigger butterfly
        opacity: 1,
        speed: 8,
      }
    } else if (variant === 'fly-to-peer') {
      // Start from bottom center (where user is)
      butterflyRef.current = {
        x: window.innerWidth / 2,
        y: window.innerHeight - 100,
        wingAngle: 0,
        scale: 2, // Big butterfly
        opacity: 1,
        speed: 0,
      }
    } else if (variant === 'success') {
      butterflyRef.current = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        wingAngle: 0,
        scale: 2,
        opacity: 0,
        speed: 0,
      }
    }

    let startTime = Date.now()
    const duration = variant === 'success' ? 2000 : 2500

    const drawButterfly = (butterfly: Butterfly) => {
      ctx.save()
      ctx.translate(butterfly.x, butterfly.y)
      ctx.scale(butterfly.scale, butterfly.scale)
      ctx.globalAlpha = butterfly.opacity

      // Body
      ctx.fillStyle = '#3b82f6'
      ctx.beginPath()
      ctx.ellipse(0, 0, 3, 12, 0, 0, Math.PI * 2)
      ctx.fill()

      // Left wing
      ctx.save()
      ctx.rotate(butterfly.wingAngle)
      ctx.fillStyle = '#60a5fa'
      ctx.beginPath()
      ctx.ellipse(-8, -5, 12, 8, -0.3, 0, Math.PI * 2)
      ctx.fill()
      
      // Left wing pattern
      ctx.fillStyle = '#93c5fd'
      ctx.beginPath()
      ctx.ellipse(-10, -5, 6, 4, -0.3, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // Right wing
      ctx.save()
      ctx.rotate(-butterfly.wingAngle)
      ctx.fillStyle = '#60a5fa'
      ctx.beginPath()
      ctx.ellipse(8, -5, 12, 8, 0.3, 0, Math.PI * 2)
      ctx.fill()
      
      // Right wing pattern
      ctx.fillStyle = '#93c5fd'
      ctx.beginPath()
      ctx.ellipse(10, -5, 6, 4, 0.3, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // Antennae
      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(-2, -12)
      ctx.lineTo(-4, -16)
      ctx.moveTo(2, -12)
      ctx.lineTo(4, -16)
      ctx.stroke()

      // Antennae tips
      ctx.fillStyle = '#3b82f6'
      ctx.beginPath()
      ctx.arc(-4, -16, 1.5, 0, Math.PI * 2)
      ctx.arc(4, -16, 1.5, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()
    }

    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const butterfly = butterflyRef.current

      if (variant === 'fly-across') {
        // Fly from left to right - BIGGER
        butterfly.x = -100 + (canvas.width + 200) * progress
        butterfly.y += Math.sin(progress * Math.PI * 4) * 3 // Wavy motion
        butterfly.wingAngle = Math.sin(Date.now() * 0.02) * 0.5 // Flap wings
        butterfly.opacity = progress < 0.1 ? progress * 10 : progress > 0.9 ? (1 - progress) * 10 : 1
      } else if (variant === 'fly-to-peer') {
        // Fly from bottom center to target peer position
        const startX = canvas.width / 2
        const startY = canvas.height - 100
        const targetX = targetPosition ? (targetPosition.x / 100) * canvas.width : canvas.width / 2
        const targetY = targetPosition ? (targetPosition.y / 100) * canvas.height : 100

        // Curved path using bezier-like interpolation
        const t = progress
        const controlX = (startX + targetX) / 2 + (Math.random() - 0.5) * 100
        const controlY = (startY + targetY) / 2 - 100 // Arc upward

        // Quadratic bezier curve
        butterfly.x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * controlX + t * t * targetX
        butterfly.y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * targetY

        // Flap wings
        butterfly.wingAngle = Math.sin(Date.now() * 0.03) * 0.6
        
        // Scale up as it flies
        butterfly.scale = 2 + progress * 1
        
        // Fade in/out
        butterfly.opacity = progress < 0.1 ? progress * 10 : progress > 0.85 ? (1 - progress) / 0.15 : 1
      } else if (variant === 'success') {
        // Appear and flutter in place, then fly up
        if (progress < 0.3) {
          butterfly.opacity = progress / 0.3
          butterfly.scale = 0.5 + (progress / 0.3) * 0.5
        } else if (progress < 0.7) {
          butterfly.wingAngle = Math.sin((progress - 0.3) * Math.PI * 20) * 0.6
          butterfly.scale = 1 + Math.sin((progress - 0.3) * Math.PI * 10) * 0.1
        } else {
          butterfly.y -= 3
          butterfly.opacity = 1 - ((progress - 0.7) / 0.3)
        }
      }

      drawButterfly(butterfly)

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate)
      } else {
        onComplete?.()
      }
    }

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isActive, variant, onComplete])

  if (!isActive) return null

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 100 }}
      aria-hidden="true"
    />
  )
}

// Container to manage multiple butterflies
interface ButterflyAnimationProps {
  trigger: 'connected' | 'transfer-started' | 'transfer-completed' | 'error' | null
  targetPosition?: { x: number; y: number }
}

export function ButterflyAnimation({ trigger, targetPosition }: ButterflyAnimationProps) {
  const [activeButterflies, setActiveButterflies] = useState<Array<{
    id: number
    variant: 'fly-across' | 'fly-to-peer' | 'success' | 'error'
    targetPosition?: { x: number; y: number }
  }>>([])

  useEffect(() => {
    if (!trigger) return

    let newButterflies: Array<{
      id: number
      variant: 'fly-across' | 'fly-to-peer' | 'success' | 'error'
      targetPosition?: { x: number; y: number }
    }> = []

    switch (trigger) {
      case 'connected':
        newButterflies = [{ id: Date.now(), variant: 'fly-across' }]
        break
      case 'transfer-started':
        // Fly to the peer's position
        newButterflies = [{ 
          id: Date.now(), 
          variant: 'fly-to-peer',
          targetPosition 
        }]
        break
      case 'transfer-completed':
        newButterflies = [
          { id: Date.now(), variant: 'success' },
          { id: Date.now() + 1, variant: 'success' },
        ]
        break
      case 'error':
        newButterflies = [{ id: Date.now(), variant: 'fly-across' }]
        break
    }

    setActiveButterflies(newButterflies)

    // Clean up after animation
    const timer = setTimeout(() => {
      setActiveButterflies([])
    }, 3500)

    return () => clearTimeout(timer)
  }, [trigger, targetPosition])

  return (
    <>
      {activeButterflies.map((butterfly) => (
        <ButterflyCanvas
          key={butterfly.id}
          isActive={true}
          variant={butterfly.variant}
          targetPosition={butterfly.targetPosition}
          onComplete={() => {
            setActiveButterflies((prev) => prev.filter((b) => b.id !== butterfly.id))
          }}
        />
      ))}
    </>
  )
}

