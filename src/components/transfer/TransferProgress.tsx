import { CheckCircle2 } from 'lucide-react'
import { ButterflyProgress } from './ButterflyProgress'
import type { TransferProgress as TransferProgressType } from '@/types/transfer'

interface TransferProgressProps {
  progress: TransferProgressType | null
  isComplete: boolean
}

export function TransferProgress({ progress, isComplete }: TransferProgressProps) {
  if (!progress && !isComplete) {
    return null
  }

  if (isComplete) {
    return (
      <div className="p-6 bg-muted/30 rounded-xl border border-green-500/20">
        <div className="flex items-center justify-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 bg-green-500/20 rounded-full blur-xl animate-pulse" />
            <CheckCircle2 className="h-12 w-12 text-green-500 relative z-10 animate-[morphSuccess_0.5s_ease-out_forwards]" />
          </div>
          <div>
            <p className="font-semibold text-lg">Transfer Complete!</p>
            <p className="text-sm text-muted-foreground">Files have been sent successfully</p>
          </div>
        </div>
      </div>
    )
  }

  if (!progress) {
    return null
  }

  return (
    <div className="bg-muted/30 rounded-xl border">
      <ButterflyProgress progress={progress} />
    </div>
  )
}
