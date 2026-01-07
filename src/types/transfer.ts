export interface FileMetadata {
  id: string
  name: string
  size: number
  type: string
  lastModified?: number
  path?: string
}

export interface FolderMetadata {
  name: string
  path: string
  files: FileMetadata[]
  folders: FolderMetadata[]
}

export interface TransferProgress {
  fileId: string
  fileName: string
  bytesTransferred: number
  totalBytes: number
  percentage: number
  speed: number // bytes per second
  eta: number // seconds
}

export interface TransferState {
  files: FileMetadata[]
  folders: FolderMetadata[]
  currentTransfer: TransferProgress | null
  isTransferring: boolean
  isComplete: boolean
  error: string | null
}

export interface ChunkData {
  sequenceNumber: number
  fileId: string
  data: ArrayBuffer
  isLastChunk: boolean
}

export interface TransferMetadata {
  type: 'file' | 'folder'
  files: FileMetadata[]
  folders?: FolderMetadata[]
}

