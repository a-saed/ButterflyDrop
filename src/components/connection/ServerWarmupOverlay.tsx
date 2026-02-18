import { useEffect, useState, useId } from 'react'
import { cn } from '@/lib/utils'
import { ButterflyLogo } from '@/components/layout/ButterflyLogo'
import type { WarmupStatus } from '@/lib/serverWarmup'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServerWarmupOverlayProps {
  status: WarmupStatus
  elapsed: number
}

interface FlyingButterflyConfig {
  wingColor: string
  wingAccent: string
  bodyColor: string
  size: number
  topPercent: number
  duration: number
  delay: number
  wingDuration: number
}

// ---------------------------------------------------------------------------
// Data — five butterflies with distinct personalities
// ---------------------------------------------------------------------------

const BUTTERFLIES: FlyingButterflyConfig[] = [
  {
    wingColor: '#f472b6',
    wingAccent: '#ec4899',
    bodyColor: '#9d174d',
    size: 54,
    topPercent: 11,
    duration: 9200,
    delay: 0,
    wingDuration: 370,
  },
  {
    wingColor: '#60a5fa',
    wingAccent: '#3b82f6',
    bodyColor: '#1e40af',
    size: 44,
    topPercent: 34,
    duration: 7400,
    delay: -2900,
    wingDuration: 310,
  },
  {
    wingColor: '#fb923c',
    wingAccent: '#f97316',
    bodyColor: '#9a3412',
    size: 66,
    topPercent: 60,
    duration: 11200,
    delay: -5600,
    wingDuration: 430,
  },
  {
    wingColor: '#a78bfa',
    wingAccent: '#8b5cf6',
    bodyColor: '#5b21b6',
    size: 40,
    topPercent: 23,
    duration: 8600,
    delay: -1300,
    wingDuration: 345,
  },
  {
    wingColor: '#34d399',
    wingAccent: '#10b981',
    bodyColor: '#065f46',
    size: 50,
    topPercent: 74,
    duration: 10400,
    delay: -4200,
    wingDuration: 400,
  },
]

// ---------------------------------------------------------------------------
// Progressive messages — change tone as the wait grows
// ---------------------------------------------------------------------------

interface WarmupMessage {
  headline: string
  sub: string
}

function getWarmupMessage(elapsed: number, status: WarmupStatus): WarmupMessage {
  if (status === 'ready') {
    return {
      headline: 'Ready to fly! 🎉',
      sub: 'Your connection is live',
    }
  }

  if (status === 'timeout') {
    return {
      headline: 'Taking longer than expected',
      sub: 'The server might be unreachable. Try refreshing the page.',
    }
  }

  if (elapsed < 6) {
    return {
      headline: 'Warming up the server…',
      sub: 'Just a moment while things get ready',
    }
  }

  if (elapsed < 16) {
    return {
      headline: 'Brewing some coffee ☕',
      sub: 'Servers love a little rest — almost awake now',
    }
  }

  if (elapsed < 28) {
    return {
      headline: 'Almost there…',
      sub: 'Cold starts take ~20–30 s — nearly done!',
    }
  }

  if (elapsed < 50) {
    return {
      headline: 'Still waking up…',
      sub: 'Hang tight, we\'re almost there',
    }
  }

  return {
    headline: 'Taking a little longer than usual',
    sub: 'We\'re still trying — thanks for your patience 🙏',
  }
}

// ---------------------------------------------------------------------------
// FlyingButterfly — one SVG butterfly that flies across the screen
// ---------------------------------------------------------------------------

function FlyingButterfly({
  wingColor,
  wingAccent,
  bodyColor,
  size,
  topPercent,
  duration,
  delay,
  wingDuration,
}: FlyingButterflyConfig) {
  // Each butterfly gets unique gradient IDs to avoid SVG namespace collisions
  const uid = useId().replace(/:/g, '')

  return (
    <div
      aria-hidden="true"
      className="absolute pointer-events-none"
      style={{
        top: `${topPercent}%`,
        left: 0,
        width: size,
        height: Math.round(size * 0.85),
        animation: `butterfly-fly ${duration}ms linear ${delay}ms infinite`,
        willChange: 'transform, opacity',
      }}
    >
      <svg
        width={size}
        height={Math.round(size * 0.85)}
        viewBox="0 0 60 51"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Left-wing gradient: rich colour near body, lighter at tip */}
          <linearGradient id={`${uid}-lw`} x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={wingColor} stopOpacity="0.95" />
            <stop offset="100%" stopColor={wingAccent} stopOpacity="0.65" />
          </linearGradient>
          {/* Right-wing gradient: mirror */}
          <linearGradient id={`${uid}-rw`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={wingColor} stopOpacity="0.95" />
            <stop offset="100%" stopColor={wingAccent} stopOpacity="0.65" />
          </linearGradient>
        </defs>

        {/* ── Left wing ───────────────────────────────────────────────── */}
        {/* transform-origin: right center → folds toward the body */}
        <g
          style={{
            transformBox: 'fill-box',
            transformOrigin: 'right center',
            animation: `wing-flap ${wingDuration}ms ease-in-out infinite`,
          }}
        >
          {/* Upper lobe */}
          <ellipse cx="13" cy="17" rx="13" ry="10" fill={`url(#${uid}-lw)`} />
          {/* Lower lobe */}
          <ellipse cx="10" cy="31" rx="10" ry="7" fill={`url(#${uid}-lw)`} opacity="0.82" />
          {/* Shimmer spots */}
          <circle cx="11" cy="18" r="2.5" fill="white" fillOpacity="0.38" />
          <circle cx="8"  cy="30" r="1.5" fill="white" fillOpacity="0.25" />
        </g>

        {/* ── Right wing ──────────────────────────────────────────────── */}
        {/* transform-origin: left center → folds toward the body */}
        {/* Half-period delay creates alternating flap */}
        <g
          style={{
            transformBox: 'fill-box',
            transformOrigin: 'left center',
            animation: `wing-flap ${wingDuration}ms ease-in-out ${Math.round(wingDuration / 2)}ms infinite`,
          }}
        >
          <ellipse cx="47" cy="17" rx="13" ry="10" fill={`url(#${uid}-rw)`} />
          <ellipse cx="50" cy="31" rx="10" ry="7" fill={`url(#${uid}-rw)`} opacity="0.82" />
          <circle cx="49" cy="18" r="2.5" fill="white" fillOpacity="0.38" />
          <circle cx="52" cy="30" r="1.5" fill="white" fillOpacity="0.25" />
        </g>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <ellipse cx="30" cy="26" rx="2.5" ry="12" fill={bodyColor} opacity="0.9" />
        {/* Head */}
        <circle  cx="30" cy="13" r="3"   fill={bodyColor} opacity="0.9" />

        {/* ── Antennae ──────────────────────────────────────────────── */}
        <path
          d="M29 11 Q27 7 24 4"
          stroke={bodyColor}
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.8"
        />
        <path
          d="M31 11 Q33 7 36 4"
          stroke={bodyColor}
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.8"
        />
        <circle cx="24" cy="4" r="1.6" fill={bodyColor} opacity="0.9" />
        <circle cx="36" cy="4" r="1.6" fill={bodyColor} opacity="0.9" />
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// IndeterminateBar — shimmer progress bar shown while warming
// ---------------------------------------------------------------------------

function IndeterminateBar() {
  return (
    <div className="w-full h-1.5 rounded-full bg-border overflow-hidden relative">
      {/* Moving highlight band */}
      <div
        className="absolute inset-y-0 w-2/5 rounded-full"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, oklch(0.55 0.15 285) 40%, oklch(0.7 0.18 285) 50%, oklch(0.55 0.15 285) 60%, transparent 100%)',
          animation: 'warmup-sweep 2.2s ease-in-out infinite',
          willChange: 'transform',
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// CheckmarkIcon — pops in when status === 'ready'
// ---------------------------------------------------------------------------

function CheckmarkIcon() {
  return (
    <div className="warmup-checkmark-pop w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shadow-lg">
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-emerald-600 dark:text-emerald-400"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TimeoutIcon — shown when we give up waiting
// ---------------------------------------------------------------------------

function TimeoutIcon() {
  return (
    <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-amber-600 dark:text-amber-400"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8"  x2="12"   y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Elapsed timer formatter
// ---------------------------------------------------------------------------

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

// ---------------------------------------------------------------------------
// ServerWarmupOverlay — main export
// ---------------------------------------------------------------------------

export function ServerWarmupOverlay({ status, elapsed }: ServerWarmupOverlayProps) {
  // Fade-in on mount, fade-out when status becomes 'ready' or 'timeout'
  const [visible, setVisible] = useState(false)
  const [isDismissing, setIsDismissing] = useState(false)

  // Respect prefers-reduced-motion — skip flying butterflies for a11y
  const [reducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  // Trigger fade-in one frame after mount (lets the browser paint first)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // When ready: linger briefly, then begin fade-out
  useEffect(() => {
    if (status !== 'ready') return
    const t = setTimeout(() => setIsDismissing(true), 900)
    return () => clearTimeout(t)
  }, [status])

  const { headline, sub } = getWarmupMessage(elapsed, status)

  const isReady   = status === 'ready'
  const isTimeout = status === 'timeout'
  const isWaiting = !isReady && !isTimeout

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Connecting to server"
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center',
        // Backdrop
        'bg-background/80 backdrop-blur-md',
        // Fade-in / fade-out transition
        'transition-opacity duration-700',
        visible && !isDismissing ? 'opacity-100' : 'opacity-0',
        isDismissing && 'pointer-events-none',
      )}
    >
      {/* ── Flying butterflies (background layer) ──────────────────────── */}
      {!reducedMotion && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {BUTTERFLIES.map((cfg, i) => (
            <FlyingButterfly key={i} {...cfg} />
          ))}
        </div>
      )}

      {/* ── Center card ────────────────────────────────────────────────── */}
      <div
        className={cn(
          // Layout
          'relative z-10 flex flex-col items-center gap-5 text-center',
          'px-8 py-10 mx-4',
          'max-w-xs w-full',
          // Visual style
          'rounded-3xl border border-border/60',
          'bg-background/75 backdrop-blur-xl shadow-2xl',
          // Entry animation
          'transition-all duration-500',
          visible && !isDismissing
            ? 'opacity-100 translate-y-0 scale-100'
            : 'opacity-0 translate-y-4 scale-95',
          // Subtle breathing while waiting (CSS class from index.css)
          isWaiting && 'warmup-card-breathe',
        )}
      >

        {/* ── Status icon ──────────────────────────────── */}
        {isReady   && <CheckmarkIcon />}
        {isTimeout && <TimeoutIcon />}
        {isWaiting && (
          <div className="relative">
            {/* Halo ring that pulses behind the logo */}
            <div className="absolute inset-0 rounded-full bg-blue-400/20 dark:bg-blue-500/15 animate-ping" />
            <div className="relative w-16 h-16 flex items-center justify-center">
              <ButterflyLogo size={64} />
            </div>
          </div>
        )}

        {/* ── App name (always shown) ───────────────────── */}
        <div className="space-y-0.5">
          <h2 className="text-xl font-bold tracking-tight">Butterfly Drop</h2>
          <p className="text-xs text-muted-foreground font-medium">Let your files fly</p>
        </div>

        {/* ── Status message (transitions between states) ── */}
        <div className="space-y-1.5 min-h-[3.5rem] flex flex-col justify-center">
          <p
            key={headline}  // re-mount triggers native CSS transition
            className={cn(
              'font-semibold text-base leading-snug',
              'transition-all duration-500',
              isReady   && 'text-emerald-600 dark:text-emerald-400',
              isTimeout && 'text-amber-600 dark:text-amber-400',
              isWaiting && 'text-foreground',
            )}
          >
            {headline}
          </p>
          <p className="text-sm text-muted-foreground leading-snug">{sub}</p>
        </div>

        {/* ── Indeterminate progress bar (only while waiting) ─ */}
        {isWaiting && <IndeterminateBar />}

        {/* ── Footer: elapsed time + hint ──────────────────── */}
        {isWaiting && (
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground/70 tabular-nums">
              <span>⏱</span>
              <span>{formatElapsed(elapsed)}</span>
              {elapsed < 4 && (
                <>
                  <span className="opacity-50">•</span>
                  <span>Usually 20–30 s</span>
                </>
              )}
            </div>
            {elapsed >= 4 && (
              <p className="text-[11px] text-muted-foreground/50">
                First visit after inactivity
              </p>
            )}
          </div>
        )}

        {/* ── Timeout action ─────────────────────────────────── */}
        {isTimeout && (
          <button
            onClick={() => window.location.reload()}
            className={cn(
              'text-sm font-medium text-primary underline-offset-4',
              'hover:underline focus:underline outline-none',
              'transition-opacity hover:opacity-80',
            )}
          >
            Refresh and try again
          </button>
        )}
      </div>
    </div>
  )
}
