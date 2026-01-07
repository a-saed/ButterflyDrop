import { File, X, FileText, FileImage, FileVideo, FileAudio, FileArchive } from 'lucide-react'
import { formatFileSize } from '@/lib/fileUtils'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useState, useEffect } from 'react'

interface FileItemProps {
  file: File
  index: number
  onRemove?: () => void
}

const getFileIcon = (type: string) => {
  if (type.startsWith('image/')) return FileImage
  if (type.startsWith('video/')) return FileVideo
  if (type.startsWith('audio/')) return FileAudio
  if (type.includes('zip') || type.includes('rar') || type.includes('tar')) return FileArchive
  if (type.includes('text') || type.includes('pdf') || type.includes('document')) return FileText
  return File
}

const getFileColor = (type: string) => {
  if (type.startsWith('image/')) return 'bg-green-500/10 text-green-600 border-green-500/20 dark:text-green-400'
  if (type.startsWith('video/')) return 'bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400'
  if (type.startsWith('audio/')) return 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400'
  if (type.includes('zip') || type.includes('rar')) return 'bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400'
  if (type.includes('text') || type.includes('pdf')) return 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400'
  return 'bg-muted text-muted-foreground border-border'
}

function FileChip({ file, index, onRemove }: FileItemProps) {
  const Icon = getFileIcon(file.type)
  const colorClass = getFileColor(file.type)
  const [thumbnail, setThumbnail] = useState<string | null>(null)

  // Generate thumbnail for images
  useEffect(() => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (e) => {
        setThumbnail(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
    return () => {
      if (thumbnail) {
        URL.revokeObjectURL(thumbnail)
      }
    }
  }, [file])

  return (
    <div
      className={cn(
        'group inline-flex items-center gap-2 px-3 py-1.5 rounded-full border',
        'transition-all duration-200 hover:scale-105',
        'animate-in fade-in slide-in-from-bottom-2',
        colorClass
      )}
      style={{ animationDelay: `${index * 30}ms` }}
      title={`${file.name} (${formatFileSize(file.size)})`}
    >
      {/* Thumbnail or Icon */}
      {thumbnail ? (
        <div className="h-5 w-5 rounded-full overflow-hidden shrink-0 border border-current/20">
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        </div>
      ) : (
        <Icon className="h-4 w-4 shrink-0" />
      )}

      {/* File name */}
      <span className="text-xs font-medium truncate max-w-[120px] sm:max-w-[180px]">
        {file.name}
      </span>

      {/* File size - hidden on very small screens */}
      <span className="text-xs opacity-70 hidden sm:inline">
        {formatFileSize(file.size)}
      </span>

      {/* Remove button */}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="ml-1 -mr-1 h-5 w-5 rounded-full hover:bg-current/20 flex items-center justify-center transition-colors shrink-0"
          aria-label="Remove file"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

interface FileListProps {
  files: File[]
  onRemove?: (index: number) => void
  onClear?: () => void
}

export function FileList({ files, onRemove, onClear }: FileListProps) {
  if (files.length === 0) return null

  const totalSize = files.reduce((sum, file) => sum + file.size, 0)

  return (
    <div className="w-full space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <p className="text-sm font-medium">
            {files.length} file{files.length > 1 ? 's' : ''}
          </p>
          <span className="text-xs text-muted-foreground">
            {formatFileSize(totalSize)}
          </span>
        </div>
        {onClear && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-7 text-xs"
          >
            Clear all
          </Button>
        )}
      </div>

      {/* File Chips - Horizontal Scrollable */}
      <div className="flex flex-wrap gap-2 max-h-[120px] overflow-y-auto pr-2 scrollbar-thin">
        {files.map((file, index) => (
          <FileChip
            key={`${file.name}-${index}-${file.size}`}
            file={file}
            index={index}
            onRemove={onRemove ? () => onRemove(index) : undefined}
          />
        ))}
      </div>
    </div>
  )
}

