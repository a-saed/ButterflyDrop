import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, File, Folder, X } from "lucide-react";
import { formatFileSize } from "@/lib/fileUtils";
import { Button } from "@/components/ui/button";

interface DropZoneProps {
  onFilesSelected: (files: File[]) => void;
  onFolderSelected: (files: FileList) => void;
  disabled?: boolean;
}

export function DropZone({
  onFilesSelected,
  onFolderSelected,
  disabled = false,
}: DropZoneProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        setSelectedFiles(acceptedFiles);
        onFilesSelected(acceptedFiles);
      }
    },
    [onFilesSelected],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled,
    noClick: disabled,
    noKeyboard: disabled,
  });

  const handleFolderSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) {
        setSelectedFiles(Array.from(files));
        onFolderSelected(files);
      }
    },
    [onFolderSelected],
  );

  const clearSelection = useCallback(() => {
    setSelectedFiles([]);
  }, []);

  return (
    <div className="w-full">
      {/* Selected Files Preview */}
      {selectedFiles.length > 0 && (
        <div className="mb-6 p-4 bg-muted/30 rounded-xl border">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium">
              {selectedFiles.length} file{selectedFiles.length > 1 ? "s" : ""}{" "}
              selected
            </p>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={clearSelection}
              className="h-6 w-6"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {selectedFiles.slice(0, 5).map((file, index) => (
              <div key={index} className="flex items-center gap-2 text-sm">
                <File className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate flex-1">{file.name}</span>
                <span className="text-muted-foreground text-xs shrink-0">
                  {formatFileSize(file.size)}
                </span>
              </div>
            ))}
            {selectedFiles.length > 5 && (
              <p className="text-xs text-muted-foreground">
                +{selectedFiles.length - 5} more files
              </p>
            )}
          </div>
        </div>
      )}

      {/* Main Drop Zone */}
      <div
        {...getRootProps()}
        className={`
          relative w-full min-h-[400px] rounded-2xl border-2 border-dashed
          flex flex-col items-center justify-center gap-6 p-12
          transition-all duration-200 cursor-pointer
          ${
            isDragActive
              ? "border-primary/50 bg-primary/5"
              : "border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/20"
          }
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        `}
      >
        <input {...getInputProps()} />

        <div className="flex flex-col items-center gap-4">
          {isDragActive ? (
            <>
              <Upload className="h-16 w-16 text-primary transition-colors" />
              <p className="text-xl font-medium text-primary">
                Drop files here
              </p>
            </>
          ) : (
            <>
              <Upload className="h-16 w-16 text-muted-foreground transition-colors" />
              <div className="text-center">
                <p className="text-xl font-medium mb-1">
                  Drop files or folders
                </p>
                <p className="text-sm text-muted-foreground">
                  or click to browse
                </p>
              </div>
            </>
          )}
        </div>

        {!isDragActive && (
          <div className="flex gap-3 mt-4">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={(e) => {
                e.stopPropagation();
                document.getElementById("file-input")?.click();
              }}
              disabled={disabled}
              className="gap-2"
            >
              <File className="h-4 w-4" />
              Select Files
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={(e) => {
                e.stopPropagation();
                document.getElementById("folder-input")?.click();
              }}
              disabled={disabled}
              className="gap-2"
            >
              <Folder className="h-4 w-4" />
              Select Folder
            </Button>
          </div>
        )}

        <input
          id="file-input"
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              const files = Array.from(e.target.files);
              setSelectedFiles(files);
              onFilesSelected(files);
            }
          }}
          disabled={disabled}
        />
        <input
          id="folder-input"
          type="file"
          {...({ webkitdirectory: "" } as any)}
          multiple
          className="hidden"
          onChange={handleFolderSelect}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
