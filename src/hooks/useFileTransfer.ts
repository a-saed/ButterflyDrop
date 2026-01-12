import { useState, useCallback, useRef } from "react";
import type {
  FileMetadata,
  FolderMetadata,
  TransferProgress,
  TransferMetadata,
} from "@/types/transfer";

import {
  readFileInChunks,
  getChunkSize,
  createFileMetadata,
} from "@/lib/fileUtils";
import { useWebRTC } from "./useWebRTC_v2";

export function useFileTransfer() {
  const { dataChannel } = useWebRTC();
  const [transferState, setTransferState] = useState<{
    files: FileMetadata[];
    folders: FolderMetadata[];
    currentTransfer: TransferProgress | null;
    isTransferring: boolean;
    isComplete: boolean;
    error: string | null;
  }>({
    files: [],
    folders: [],
    currentTransfer: null,
    isTransferring: false,
    isComplete: false,
    error: null,
  });

  const transferStartTimeRef = useRef<number>(0);
  const receivedChunksRef = useRef<Map<string, ArrayBuffer[]>>(new Map());

  /**
   * Send file metadata
   */
  const sendMetadata = useCallback(
    (files: File[], folders?: FolderMetadata[]) => {
      if (!dataChannel || dataChannel.readyState !== "open") {
        setTransferState((prev) => ({
          ...prev,
          error: "Data channel not ready",
        }));
        return;
      }

      const fileMetadata: FileMetadata[] = files.map((file) =>
        createFileMetadata(file),
      );
      const metadata: TransferMetadata = {
        type: folders ? "folder" : "file",
        files: fileMetadata,
        folders,
      };

      dataChannel.send(JSON.stringify({ type: "metadata", data: metadata }));
    },
    [dataChannel],
  );

  /**
   * Send files
   */
  const sendFiles = useCallback(
    async (files: File[], folders?: FolderMetadata[]) => {
      if (!dataChannel || dataChannel.readyState !== "open") {
        setTransferState((prev) => ({
          ...prev,
          error: "Data channel not ready",
        }));
        return;
      }

      setTransferState((prev) => ({
        ...prev,
        files: files.map((f) => createFileMetadata(f)),
        folders: folders || [],
        isTransferring: true,
        isComplete: false,
        error: null,
      }));

      // Send metadata first
      sendMetadata(files, folders);

      // Wait a bit for receiver to process metadata
      await new Promise((resolve) => setTimeout(resolve, 100));

      const chunkSize = getChunkSize();
      let totalBytesTransferred = 0;
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

      transferStartTimeRef.current = Date.now();

      // Send each file
      for (const file of files) {
        const fileMeta = createFileMetadata(file);
        let sequenceNumber = 0;
        let fileBytesTransferred = 0;

        try {
          for await (const chunk of readFileInChunks(file, chunkSize)) {
            const isLastChunk =
              fileBytesTransferred + chunk.byteLength >= file.size;

            // Create chunk data for sending

            // Send chunk (using structured clone for ArrayBuffer)
            dataChannel.send(
              JSON.stringify({
                type: "chunk",
                sequenceNumber,
                fileId: fileMeta.id,
                isLastChunk,
              }),
            );
            dataChannel.send(chunk);

            fileBytesTransferred += chunk.byteLength;
            totalBytesTransferred += chunk.byteLength;
            sequenceNumber++;

            // Update progress
            const elapsed = (Date.now() - transferStartTimeRef.current) / 1000;
            const speed = totalBytesTransferred / elapsed;
            const remaining = totalBytes - totalBytesTransferred;
            const eta = speed > 0 ? remaining / speed : 0;

            setTransferState((prev) => ({
              ...prev,
              currentTransfer: {
                fileId: fileMeta.id,
                fileName: fileMeta.name,
                bytesTransferred: totalBytesTransferred,
                totalBytes,
                percentage: (totalBytesTransferred / totalBytes) * 100,
                speed,
                eta,
              },
            }));
          }
        } catch (error) {
          console.error(`Error sending file ${file.name}:`, error);
          setTransferState((prev) => ({
            ...prev,
            error: `Failed to send file: ${file.name}`,
            isTransferring: false,
          }));
          return;
        }
      }

      setTransferState((prev) => ({
        ...prev,
        isTransferring: false,
        isComplete: true,
        currentTransfer: null,
      }));
    },
    [dataChannel, sendMetadata],
  );

  /**
   * Receive files (receiver side)
   */
  const setupReceiver = useCallback(() => {
    if (!dataChannel) return;

    dataChannel.onmessage = async (event) => {
      try {
        // Check if it's a text message (metadata or chunk info)
        if (typeof event.data === "string") {
          const message = JSON.parse(event.data);

          if (message.type === "metadata") {
            const metadata = message.data as TransferMetadata;
            setTransferState((prev) => ({
              ...prev,
              files: metadata.files,
              folders: metadata.folders || [],
              isTransferring: true,
            }));

            // Initialize chunk storage
            metadata.files.forEach((file) => {
              receivedChunksRef.current.set(file.id, []);
            });

            transferStartTimeRef.current = Date.now();
          } else if (message.type === "chunk") {
            // Next message will be the actual chunk data
            // We'll handle it in the next onmessage call
          }
        } else if (event.data instanceof ArrayBuffer) {
          // This is a chunk - we need to know which file it belongs to
          // For MVP, we'll use a simple approach: store chunks and reconstruct files
          // In a real implementation, you'd track the current file being received
          // Store chunk for later reconstruction
          // This is simplified - you'd need proper chunk tracking
          // const chunk = event.data;
        }
      } catch (error) {
        console.error("Error receiving data:", error);
        setTransferState((prev) => ({
          ...prev,
          error: "Failed to receive file data",
          isTransferring: false,
        }));
      }
    };
  }, [dataChannel]);

  return {
    ...transferState,
    sendFiles,
    setupReceiver,
  };
}
