import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface ButterflyProps {
  onComplete?: () => void
  variant?: 'fly-in' | 'fly-out' | 'flutter' | 'success'
  delay?: number
}

export function Butterfly({ onComplete, variant = 'fly-in', delay = 0 }: ButterflyProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true)
    }, delay)

    return () => clearTimeout(timer)
  }, [delay])

  useEffect(() => {
    if (variant === 'fly-out' && isVisible) {
      const timer = setTimeout(() => {
        setIsVisible(false)
        onComplete?.()
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [variant, isVisible, onComplete])

  if (!isVisible) return null

  return (
    <div
      className={cn(
        'fixed pointer-events-none z-50',
        variant === 'fly-in' && 'animate-[flyIn_2s_ease-out_forwards]',
        variant === 'fly-out' && 'animate-[flyOut_2s_ease-in_forwards]',
        variant === 'flutter' && 'animate-flutter',
        variant === 'success' && 'animate-[success_3s_ease-out_forwards]'
      )}
      style={{
        left: variant === 'fly-in' ? '-100px' : variant === 'fly-out' ? '50%' : '50%',
        top: variant === 'fly-in' ? '50%' : variant === 'fly-out' ? '50%' : '50%',
        transform: 'translate(-50%, -50%)',
      }}
    >
      <svg
        width="60"
        height="60"
        viewBox="0 0 100 100"
        className="drop-shadow-lg"
      >
        {/* Left wing */}
        <path
          d="M30 50 Q20 30 20 50 Q20 70 30 50"
          fill="url(#wingGradient)"
          className={variant === 'flutter' ? 'animate-[wingFlap_0.3s_ease-in-out_infinite]' : ''}
          style={{
            transformOrigin: '30px 50px',
          }}
        />
        {/* Right wing */}
        <path
          d="M70 50 Q80 30 80 50 Q80 70 70 50"
          fill="url(#wingGradient)"
          className={variant === 'flutter' ? 'animate-[wingFlap_0.3s_ease-in-out_infinite_0.15s]' : ''}
          style={{
            transformOrigin: '70px 50px',
          }}
        />
        {/* Body */}
        <ellipse cx="50" cy="50" rx="3" ry="20" fill="url(#bodyGradient)" />
        {/* Antennae */}
        <line x1="50" y1="30" x2="45" y2="20" stroke="url(#bodyGradient)" strokeWidth="1" />
        <line x1="50" y1="30" x2="55" y2="20" stroke="url(#bodyGradient)" strokeWidth="1" />
        <circle cx="45" cy="20" r="1.5" fill="url(#bodyGradient)" />
        <circle cx="55" cy="20" r="1.5" fill="url(#bodyGradient)" />

        {/* Gradients */}
        <defs>
          <linearGradient id="wingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(200, 70%, 70%)" stopOpacity="0.9" />
            <stop offset="50%" stopColor="hsl(220, 60%, 60%)" stopOpacity="0.7" />
            <stop offset="100%" stopColor="hsl(240, 50%, 50%)" stopOpacity="0.5" />
          </linearGradient>
          <linearGradient id="bodyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="hsl(200, 50%, 40%)" />
            <stop offset="100%" stopColor="hsl(220, 60%, 30%)" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )
}

// Butterfly container that manages multiple butterflies
interface ButterflyContainerProps {
  trigger: 'connected' | 'transfer-started' | 'transfer-completed' | 'error' | null
}

export function ButterflyContainer({ trigger }: ButterflyContainerProps) {
  const [butterflies, setButterflies] = useState<Array<{ id: number; variant: ButterflyProps['variant'] }>>([])

  useEffect(() => {
    if (!trigger) return

    let newButterflies: Array<{ id: number; variant: ButterflyProps['variant'] }> = []

    switch (trigger) {
      case 'connected':
        newButterflies = [{ id: Date.now(), variant: 'fly-in' }]
        break
      case 'transfer-started':
        newButterflies = [{ id: Date.now(), variant: 'flutter' }]
        break
      case 'transfer-completed':
        newButterflies = [
          { id: Date.now(), variant: 'success' },
          { id: Date.now() + 1, variant: 'success' },
        ]
        break
      case 'error':
        newButterflies = [{ id: Date.now(), variant: 'fly-out' }]
        break
    }

    setButterflies(newButterflies)

    // Clean up after animation
    const timer = setTimeout(() => {
      setButterflies([])
    }, 4000)

    return () => clearTimeout(timer)
  }, [trigger])

  return (
    <>
      {butterflies.map((butterfly, index) => (
        <Butterfly
          key={butterfly.id}
          variant={butterfly.variant}
          delay={index * 200}
          onComplete={() => {
            setButterflies((prev) => prev.filter((b) => b.id !== butterfly.id))
          }}
        />
      ))}
    </>
  )
}

