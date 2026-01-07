import { File, CheckCircle2 } from 'lucide-react'
import { formatFileSize } from '@/lib/fileUtils'
import { cn } from '@/lib/utils'

interface FileItemProps {
  file: File
  isTransferring?: boolean
  isComplete?: boolean
  progress?: number
}

export function FileItem({ file, isTransferring, isComplete, progress }: FileItemProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border transition-butterfly',
        isComplete && 'bg-green-500/10 border-green-500/50 animate-morph-success',
        isTransferring && 'bg-primary/5 border-primary/50'
      )}
    >
      <div className="relative">
        <File className="h-5 w-5 text-muted-foreground" />
        {isComplete && (
          <CheckCircle2 className="absolute -top-1 -right-1 h-4 w-4 text-green-500 animate-morph-success" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{file.name}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
          {isTransferring && progress !== undefined && (
            <>
              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">{Math.round(progress)}%</span>
            </>
          )}
        </div>
      </div>
      {isTransferring && !isComplete && (
        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
      )}
    </div>
  )
}

