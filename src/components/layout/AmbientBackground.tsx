import { useEffect, useRef } from 'react'
import { useTheme } from '@/contexts/ThemeContext'

export function AmbientBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number | undefined>(undefined)
  const { theme } = useTheme()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      return
    }

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    // Ripple/radar animation like Snapdrop
    let time = 0
    const numRipples = 4
    const maxRadius = Math.max(canvas.width, canvas.height) * 0.8

    // Theme-based colors - much more contrast for light mode
    const isDark = theme === 'dark'
    
    const animate = () => {
      const centerX = canvas.width / 2
      const centerY = canvas.height / 2

      // Clear canvas with transparency
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Draw concentric ripples
      for (let i = 0; i < numRipples; i++) {
        const offset = (i / numRipples) * maxRadius
        const radius = ((time + offset) % maxRadius)
        const progress = radius / maxRadius
        
        // Much higher opacity for light mode to ensure visibility
        const baseOpacity = isDark ? 0.2 : 0.6
        const opacity = (1 - progress) * baseOpacity

        if (opacity > 0.01) {
          ctx.beginPath()
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
          
          // Use very different colors for light vs dark mode
          if (isDark) {
            // Light blue for dark backgrounds
            ctx.strokeStyle = `rgba(100, 150, 255, ${opacity})`
            ctx.lineWidth = 2
          } else {
            // Dark blue-gray for light backgrounds - much more visible
            ctx.strokeStyle = `rgba(60, 100, 200, ${opacity})` // blue-800 - very dark
            ctx.lineWidth = 2 // Much thicker
          }
          
          ctx.lineCap = 'round'
          ctx.stroke()
        }
      }

      // Increment time (controls speed)
      time += 1.5

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    console.log('🌊 Ambient ripple background initialized', { theme, isDark, canvasWidth: canvas.width, canvasHeight: canvas.height })
    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener('resize', resizeCanvas)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [theme])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ 
        zIndex: 0,
        opacity: 1, // Always full opacity
        backgroundColor: 'transparent',
      }}
      aria-hidden="true"
    />
  )
}
