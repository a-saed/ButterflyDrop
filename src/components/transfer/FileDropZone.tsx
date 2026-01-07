import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Folder } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface FileDropZoneProps {
  onFilesSelected: (files: File[]) => void
  onFolderSelected: (files: FileList) => void
  disabled?: boolean
}

export function FileDropZone({
  onFilesSelected,
  onFolderSelected,
  disabled = false,
}: FileDropZoneProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFilesSelected(acceptedFiles)
      }
    },
    [onFilesSelected]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled,
    noClick: disabled,
    noKeyboard: disabled,
  })

  const handleFolderSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (files && files.length > 0) {
        onFolderSelected(files)
      }
    },
    [onFolderSelected]
  )

  return (
    <Card className="border-2 border-dashed p-12 transition-colors hover:border-primary/50">
      <div
        {...getRootProps()}
        className={`flex flex-col items-center justify-center gap-4 cursor-pointer ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        } ${isDragActive ? 'border-primary' : ''}`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-2">
          {isDragActive ? (
            <>
              <Upload className="h-12 w-12 text-primary animate-bounce" />
              <p className="text-lg font-medium">Drop files here</p>
            </>
          ) : (
            <>
              <Upload className="h-12 w-12 text-muted-foreground" />
              <p className="text-lg font-medium">Drag & drop files here</p>
              <p className="text-sm text-muted-foreground">or click to select</p>
            </>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation()
              document.getElementById('file-input')?.click()
            }}
            disabled={disabled}
          >
            <Upload className="h-4 w-4 mr-2" />
            Select Files
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation()
              document.getElementById('folder-input')?.click()
            }}
            disabled={disabled}
          >
            <Folder className="h-4 w-4 mr-2" />
            Select Folder
          </Button>
        </div>

        <input
          id="file-input"
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              onFilesSelected(Array.from(e.target.files))
            }
          }}
          disabled={disabled}
        />
        <input
          id="folder-input"
          type="file"
          webkitdirectory=""
          multiple
          className="hidden"
          onChange={handleFolderSelect}
          disabled={disabled}
        />
      </div>
    </Card>
  )
}

