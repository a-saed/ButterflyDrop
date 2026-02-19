import { useState, useCallback, useRef } from "react";
import type {
  FileMetadata,
  TransferProgress,
  TransferMetadata,
} from "@/types/transfer";

import {
  readFileInChunks,
  getChunkSize,
  createFileMetadata,
} from "@/lib/fileUtils";

// Simplified message types - no ACKs needed
interface TransferMessage {
  type: "metadata" | "chunk" | "transfer-complete";
  fileId?: string;
  sequenceNumber?: number;
  isLastChunk?: boolean;
  timestamp?: number;
  data?: TransferMetadata;
}

// Received file with its data
export interface ReceivedFile {
  metadata: FileMetadata;
  chunks: ArrayBuffer[];
  totalReceived: number;
  isComplete: boolean;
  downloadUrl?: string;
}

// Incoming transfer request
export interface IncomingTransfer {
  peerId: string;
  peerName: string;
  files: FileMetadata[];
  totalSize: number;
  timestamp: number;
  /** Set when the transfer originated from a folder sync */
  folderName?: string;
}

// Transfer state for UI
interface TransferState {
  isSending: boolean;
  sendingToPeer: string | null;
  sendProgress: TransferProgress | null;
  sendComplete: boolean;
  sendError: string | null;
  /** Peer name captured at send-complete time (sendingToPeer is cleared before the effect fires) */
  sendCompletePeerName: string | null;

  isReceiving: boolean;
  receivingFromPeer: string | null;
  receiveProgress: TransferProgress | null;
  receiveComplete: boolean;
  receiveError: string | null;
  /** Peer name captured at receive-complete time (incomingTransfer is cleared before the effect fires) */
  receiveCompletePeerName: string | null;

  incomingTransfer: IncomingTransfer | null;
  receivedFiles: ReceivedFile[];
}

const initialState: TransferState = {
  isSending: false,
  sendingToPeer: null,
  sendProgress: null,
  sendComplete: false,
  sendError: null,
  sendCompletePeerName: null,

  isReceiving: false,
  receivingFromPeer: null,
  receiveProgress: null,
  receiveComplete: false,
  receiveError: null,
  receiveCompletePeerName: null,

  incomingTransfer: null,
  receivedFiles: [],
};

/**
 * File transfer hook - Snapdrop-style fast protocol
 *
 * Protocol (SIMPLE & FAST):
 * 1. Send metadata
 * 2. Send chunks: JSON header immediately followed by binary data
 * 3. Send complete
 *
 * Key: Small chunks (16KB), no ACKs, just buffer management
 */
export function useFileTransfer() {
  const [state, setState] = useState<TransferState>(initialState);

  // Per-peer receiver state
  interface ReceiverState {
    filesMetadata: FileMetadata[];
    receivedChunks: Map<string, { seq: number; data: ArrayBuffer }[]>;
    receivedBytes: number;
    startTime: number;
    lastUpdate: number;
    pendingFileId?: string;
    pendingSequence?: number;
  }

  const receiversRef = useRef<Map<string, ReceiverState>>(new Map());

  /**
   * Per-peer sync control message handlers.
   * useFolderSync registers a handler here so it can receive sync-manifest /
   * sync-ack / sync-done messages that arrive on the shared data channel.
   */
  const syncHandlersRef = useRef<
    Map<string, (msg: Record<string, unknown>) => void>
  >(new Map());

  const receivedFilesBackupRef = useRef<ReceivedFile[]>([]);

  // Sending state
  const sendingRef = useRef<{
    active: boolean;
    startTime: number;
    totalBytes: number;
    bytesTransferred: number;
  }>({
    active: false,
    startTime: 0,
    totalBytes: 0,
    bytesTransferred: 0,
  });

  const setupChannelsRef = useRef<Set<string>>(new Set());

  // Adaptive flow control thresholds
  const BUFFER_LOW = 64 * 1024; // 64 KB - safe to send aggressively
  const BUFFER_HIGH = 512 * 1024; // 512 KB - pause

  /**
   * Adaptive flow control - window-based sending
   * Instead of waiting for buffer=0, send multiple chunks then check
   */
  interface FlowControlState {
    windowSize: number;
    lastCheck: number;
  }

  const flowControlRef = useRef<Map<RTCDataChannel, FlowControlState>>(
    new Map(),
  );

  /**
   * Get or create flow control state for a channel
   */
  const getFlowControlState = useCallback(
    (channel: RTCDataChannel): FlowControlState => {
      if (!flowControlRef.current.has(channel)) {
        flowControlRef.current.set(channel, {
          windowSize: 4, // Start with 4 chunks per window
          lastCheck: Date.now(),
        });
      }
      return flowControlRef.current.get(channel)!;
    },
    [],
  );

  /**
   * Adapt window size based on buffer level
   */
  const adaptWindowSize = useCallback(
    (channel: RTCDataChannel) => {
      const state = getFlowControlState(channel);
      const bufferRatio = channel.bufferedAmount / BUFFER_HIGH;

      if (bufferRatio < 0.25) {
        // Buffer is low - send more aggressively
        state.windowSize = Math.min(Math.floor(state.windowSize * 1.5), 16);
      } else if (bufferRatio < 0.5) {
        // Buffer is medium - maintain current rate
        // No change
      } else if (bufferRatio < 0.75) {
        // Buffer is getting high - slow down
        state.windowSize = Math.max(Math.floor(state.windowSize * 0.8), 2);
      } else {
        // Buffer is very high - pause
        state.windowSize = 1;
      }

      console.log(
        `🔄 Window size: ${state.windowSize}, buffer: ${(channel.bufferedAmount / 1024).toFixed(0)} KB`,
      );
    },
    [getFlowControlState, BUFFER_HIGH],
  );

  /**
   * Wait for buffer to drain to acceptable level
   */
  const waitForBuffer = useCallback(
    async (dataChannel: RTCDataChannel) => {
      // If buffer is already low, no need to wait
      if (dataChannel.bufferedAmount < BUFFER_LOW) {
        return;
      }

      return new Promise<void>((resolve) => {
        dataChannel.bufferedAmountLowThreshold = BUFFER_LOW;

        const checkBuffer = () => {
          if (dataChannel.bufferedAmount < BUFFER_LOW) {
            resolve();
          } else {
            setTimeout(checkBuffer, 10);
          }
        };

        const handler = () => {
          dataChannel.removeEventListener("bufferedamountlow", handler);
          resolve();
        };

        dataChannel.addEventListener("bufferedamountlow", handler);
        checkBuffer();
      });
    },
    [BUFFER_LOW],
  );

  const formatBytes = useCallback((bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }, []);

  const downloadFile = useCallback((file: ReceivedFile) => {
    console.log(`📥 Downloading: ${file.metadata.name}`);

    let chunks = file.chunks;

    if (!chunks || chunks.length === 0) {
      const backupFile = receivedFilesBackupRef.current.find(
        (f) => f.metadata.id === file.metadata.id,
      );
      if (backupFile?.chunks) {
        chunks = backupFile.chunks;
      } else {
        alert(`Error: No data for "${file.metadata.name}"`);
        return;
      }
    }

    try {
      const blob = new Blob(chunks, {
        type: file.metadata.type || "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.metadata.name || "download";
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error(`Download failed:`, error);
      alert(
        `Download failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, []);

  const downloadAllFiles = useCallback(
    (filesToDownload?: ReceivedFile[]) => {
      const files = filesToDownload || state.receivedFiles;
      if (files.length === 0) {
        alert("No files to download");
        return;
      }
      files.forEach((file, index) => {
        if (file.chunks && file.chunks.length > 0) {
          setTimeout(() => downloadFile(file), index * 200);
        }
      });
    },
    [state.receivedFiles, downloadFile],
  );

  const clearReceivedFiles = useCallback(() => {
    setState((prev) => ({
      ...prev,
      receivedFiles: [],
      receiveComplete: false,
      receiveCompletePeerName: null,
    }));
  }, []);

  const handleMessage = useCallback(
    async (peerId: string, peerName: string, event: MessageEvent) => {
      try {
        // Handle JSON messages
        if (typeof event.data === "string") {
          const message: TransferMessage = JSON.parse(event.data);

          // ── Sync control messages ──────────────────────────────────────────
          // These are thin JSON envelopes used by useFolderSync to coordinate a
          // sync session.  They don't carry file bytes so they're handled here
          // and forwarded to whoever registered a handler for this peer.
          if (
            typeof message.type === "string" &&
            message.type.startsWith("sync-")
          ) {
            const handler = syncHandlersRef.current.get(peerId);
            if (handler) {
              handler(message as unknown as Record<string, unknown>);
            }
            return;
          }

          if (message.type === "metadata" && message.data) {
            const metadata = message.data;
            console.log(
              `📦 Receiving ${metadata.files.length} files from ${peerName}`,
            );

            const receiverState = {
              filesMetadata: metadata.files,
              receivedChunks: new Map<
                string,
                { seq: number; data: ArrayBuffer }[]
              >(),
              receivedBytes: 0,
              startTime: Date.now(),
              lastUpdate: Date.now(),
            };

            metadata.files.forEach((file) => {
              receiverState.receivedChunks.set(file.id, []);
            });

            receiversRef.current.set(peerId, receiverState);

            const totalSize = metadata.files.reduce(
              (sum, f) => sum + f.size,
              0,
            );

            setState((prev) => ({
              ...prev,
              incomingTransfer: {
                peerId,
                peerName,
                files: metadata.files,
                totalSize,
                timestamp: Date.now(),
                folderName: metadata.folderName,
              },
              isReceiving: true,
              receivingFromPeer: peerId,
              receiveError: null,
              receiveComplete: false,
            }));
          } else if (message.type === "chunk" && message.fileId) {
            // Chunk metadata - store fileId for next binary message
            const receiver = receiversRef.current.get(peerId);
            if (receiver) {
              receiver.pendingFileId = message.fileId;
              receiver.pendingSequence = message.sequenceNumber;
            }
          } else if (message.type === "transfer-complete") {
            console.log(`✅ Transfer complete from ${peerName}`);
            const receiver = receiversRef.current.get(peerId);
            if (!receiver) return;

            const receivedFiles: ReceivedFile[] = receiver.filesMetadata.map(
              (meta) => {
                const chunkData = receiver.receivedChunks.get(meta.id) || [];

                // Sort chunks by sequence number to ensure correct order
                chunkData.sort((a, b) => a.seq - b.seq);

                // Check for missing chunks
                const missingChunks: number[] = [];
                const receivedSeqs = new Set(chunkData.map((c) => c.seq));
                const maxSeq =
                  chunkData.length > 0
                    ? Math.max(...chunkData.map((c) => c.seq))
                    : 0;

                for (let seq = 0; seq <= maxSeq; seq++) {
                  if (!receivedSeqs.has(seq)) {
                    missingChunks.push(seq);
                  }
                }

                if (missingChunks.length > 0) {
                  console.error(
                    `❌ ${meta.name}: Missing ${missingChunks.length} chunks: ${missingChunks.slice(0, 10).join(", ")}${missingChunks.length > 10 ? "..." : ""}`,
                  );
                }

                // Extract ArrayBuffers in correct order and copy them
                const copiedChunks: ArrayBuffer[] = chunkData.map(
                  ({ data }) => {
                    const copy = new ArrayBuffer(data.byteLength);
                    new Uint8Array(copy).set(new Uint8Array(data));
                    return copy;
                  },
                );

                const totalReceived = copiedChunks.reduce(
                  (sum, c) => sum + c.byteLength,
                  0,
                );

                console.log(
                  `📦 ${meta.name}: ${copiedChunks.length} chunks (${chunkData[0]?.seq || 0}-${chunkData[chunkData.length - 1]?.seq || 0}), ${totalReceived}/${meta.size} bytes`,
                );

                return {
                  metadata: meta,
                  chunks: copiedChunks,
                  totalReceived,
                  isComplete:
                    totalReceived >= meta.size * 0.95 &&
                    missingChunks.length === 0,
                };
              },
            );

            receivedFilesBackupRef.current = receivedFiles;

            setState((prev) => ({
              ...prev,
              isReceiving: false,
              receiveComplete: true,
              receiveCompletePeerName: peerName,
              receiveProgress: null,
              incomingTransfer: null,
              receivedFiles,
            }));
          }
        }
        // Handle binary data
        else if (
          event.data instanceof ArrayBuffer ||
          event.data instanceof Blob
        ) {
          let chunk: ArrayBuffer;
          if (event.data instanceof Blob) {
            chunk = await event.data.arrayBuffer();
          } else {
            chunk = event.data;
          }

          const receiver = receiversRef.current.get(peerId);
          if (!receiver) return;

          // Get fileId and sequence from pending chunk metadata
          const fileId = receiver.pendingFileId;
          const seq = receiver.pendingSequence ?? 0;

          if (!fileId) {
            console.error(`❌ No fileId for binary chunk`);
            return;
          }

          // Store chunk with sequence number
          const chunks = receiver.receivedChunks.get(fileId) || [];
          chunks.push({ seq, data: chunk });
          receiver.receivedChunks.set(fileId, chunks);
          receiver.receivedBytes += chunk.byteLength;

          console.log(
            `💾 Chunk ${seq} for ${fileId.slice(0, 8)}... (${chunk.byteLength} bytes) - total: ${chunks.length} chunks`,
          );

          // Clear pending
          receiver.pendingFileId = undefined;
          receiver.pendingSequence = undefined;

          // Check if we've received all data (auto-finalize if complete)
          const totalBytes = receiver.filesMetadata.reduce(
            (sum, f) => sum + f.size,
            0,
          );

          // If we've received 100% of expected bytes, finalize immediately
          if (receiver.receivedBytes >= totalBytes) {
            console.log(
              `✅ All bytes received (${receiver.receivedBytes}/${totalBytes}). Auto-finalizing.`,
            );

            // Finalize immediately
            const receivedFiles: ReceivedFile[] = receiver.filesMetadata.map(
              (meta) => {
                const chunkData = receiver.receivedChunks.get(meta.id) || [];
                chunkData.sort((a, b) => a.seq - b.seq);

                const copiedChunks: ArrayBuffer[] = chunkData.map(
                  ({ data }) => {
                    const copy = new ArrayBuffer(data.byteLength);
                    new Uint8Array(copy).set(new Uint8Array(data));
                    return copy;
                  },
                );

                const totalReceived = copiedChunks.reduce(
                  (sum, c) => sum + c.byteLength,
                  0,
                );
                console.log(
                  `📦 ${meta.name}: ${copiedChunks.length} chunks, ${totalReceived}/${meta.size} bytes`,
                );

                return {
                  metadata: meta,
                  chunks: copiedChunks,
                  totalReceived,
                  isComplete: true,
                };
              },
            );

            receivedFilesBackupRef.current = receivedFiles;

            setState((prev) => ({
              ...prev,
              isReceiving: false,
              receiveComplete: true,
              receiveCompletePeerName: peerName,
              receiveProgress: null,
              incomingTransfer: null,
              receivedFiles,
            }));

            return; // Skip progress update
          }

          // Throttle UI updates to every 50ms for better performance
          const now = Date.now();
          if (now - receiver.lastUpdate > 50) {
            receiver.lastUpdate = now;

            const totalBytes = receiver.filesMetadata.reduce(
              (sum, f) => sum + f.size,
              0,
            );
            const elapsed = (now - receiver.startTime) / 1000;
            const speed = receiver.receivedBytes / elapsed;
            const remaining = totalBytes - receiver.receivedBytes;
            const eta = speed > 0 ? remaining / speed : 0;
            const percentage = (receiver.receivedBytes / totalBytes) * 100;

            const currentFile = receiver.filesMetadata.find(
              (f) => f.id === fileId,
            );

            setState((prev) => ({
              ...prev,
              receiveProgress: {
                fileId,
                fileName: currentFile?.name || "Unknown",
                bytesTransferred: receiver.receivedBytes,
                totalBytes,
                percentage,
                speed,
                eta,
              },
            }));
          }
        }
      } catch (error) {
        console.error(`Error:`, error);
      }
    },
    [],
  );

  const setupReceiver = useCallback(
    (
      peerId: string,
      peerName: string,
      dataChannel: RTCDataChannel,
      queuedMessages: MessageEvent[] = [],
    ) => {
      if (!dataChannel || setupChannelsRef.current.has(peerId)) {
        return;
      }

      console.log(`📥 Setting up receiver for ${peerName}`);
      dataChannel.binaryType = "arraybuffer";
      dataChannel.onmessage = (event) => {
        handleMessage(peerId, peerName, event);
      };

      setupChannelsRef.current.add(peerId);

      // Process queued messages
      queuedMessages.forEach((event) => {
        handleMessage(peerId, peerName, event);
      });
    },
    [handleMessage],
  );

  const sendFiles = useCallback(
    async (
      files: File[],
      dataChannel: RTCDataChannel,
      peerId: string,
      peerName: string,
      /** Optional: set to folder name when this is a folder-sync transfer */
      folderName?: string,
    ) => {
      if (!dataChannel || dataChannel.readyState !== "open") {
        throw new Error("Data channel not open");
      }

      console.log(`🚀 Sending ${files.length} files to ${peerName}`);

      const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

      sendingRef.current = {
        active: true,
        startTime: Date.now(),
        totalBytes,
        bytesTransferred: 0,
      };

      setState((prev) => ({
        ...prev,
        isSending: true,
        sendingToPeer: peerId,
        sendProgress: null,
        sendComplete: false,
        sendError: null,
      }));

      try {
        // Send metadata
        const fileMetadata: FileMetadata[] = files.map((f) =>
          createFileMetadata(f),
        );
        const metadata: TransferMetadata = {
          type: folderName ? "folder" : "file",
          files: fileMetadata,
          ...(folderName ? { folderName } : {}),
        };

        dataChannel.send(
          JSON.stringify({
            type: "metadata",
            data: metadata,
            timestamp: Date.now(),
          }),
        );

        console.log(`📋 Sent metadata`);
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Get optimal chunk size based on total file size
        const chunkSize = getChunkSize(totalBytes);
        console.log(
          `📦 Using chunk size: ${(chunkSize / 1024).toFixed(0)} KB for ${(totalBytes / 1024 / 1024).toFixed(1)} MB total`,
        );

        let lastUpdate = Date.now();
        const flowState = getFlowControlState(dataChannel);

        // Send each file
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const fileMeta = fileMetadata[i];

          console.log(
            `📦 Sending: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`,
          );

          const chunks: ArrayBuffer[] = [];

          // Collect chunks first (for window-based sending)
          for await (const chunk of readFileInChunks(file, chunkSize)) {
            chunks.push(chunk);
          }

          // Send chunks in windows
          let chunkIndex = 0;
          while (chunkIndex < chunks.length) {
            if (dataChannel.readyState !== "open") {
              throw new Error("Connection lost");
            }

            // Check buffer and adapt window size
            adaptWindowSize(dataChannel);
            const windowSize = flowState.windowSize;

            // Send a window of chunks
            const windowEnd = Math.min(chunkIndex + windowSize, chunks.length);

            for (let w = chunkIndex; w < windowEnd; w++) {
              const chunk = chunks[w];
              const isLastChunk = w === chunks.length - 1;

              // Send chunk metadata
              const header = {
                type: "chunk" as const,
                fileId: fileMeta.id,
                sequenceNumber: w,
                isLastChunk,
              };

              dataChannel.send(JSON.stringify(header));

              // Small delay to ensure header is processed
              await new Promise((resolve) => setTimeout(resolve, 1));

              // Send binary data
              dataChannel.send(chunk);

              sendingRef.current.bytesTransferred += chunk.byteLength;

              console.log(
                `📤 Sent chunk ${w}/${chunks.length - 1} (${chunk.byteLength} bytes)`,
              );
            }

            chunkIndex = windowEnd;

            // Wait for buffer to drain before next window
            await waitForBuffer(dataChannel);

            // Update progress (throttled)
            const now = Date.now();
            if (now - lastUpdate > 100) {
              lastUpdate = now;

              const elapsed = (now - sendingRef.current.startTime) / 1000;
              const speed = sendingRef.current.bytesTransferred / elapsed;
              const remaining =
                totalBytes - sendingRef.current.bytesTransferred;
              const eta = speed > 0 ? remaining / speed : 0;
              const percentage =
                (sendingRef.current.bytesTransferred / totalBytes) * 100;

              setState((prev) => ({
                ...prev,
                sendProgress: {
                  fileId: fileMeta.id,
                  fileName: fileMeta.name,
                  bytesTransferred: sendingRef.current.bytesTransferred,
                  totalBytes,
                  percentage,
                  speed,
                  eta,
                },
              }));
            }
          }

          console.log(`✅ Sent: ${file.name}`);
        }

        // Send completion
        await waitForBuffer(dataChannel);
        dataChannel.send(
          JSON.stringify({
            type: "transfer-complete",
            timestamp: Date.now(),
          }),
        );

        console.log(`🎉 Transfer complete!`);

        setState((prev) => ({
          ...prev,
          isSending: false,
          sendComplete: true,
          sendCompletePeerName: peerName,
          sendProgress: null,
          sendingToPeer: null,
        }));

        sendingRef.current.active = false;
      } catch (error) {
        console.error(`Send error:`, error);
        setState((prev) => ({
          ...prev,
          isSending: false,
          sendError: error instanceof Error ? error.message : "Unknown error",
          sendingToPeer: null,
        }));
        sendingRef.current.active = false;
        throw error;
      }
    },
    [waitForBuffer, getFlowControlState, adaptWindowSize],
  );

  const resetSendState = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isSending: false,
      sendingToPeer: null,
      sendProgress: null,
      sendComplete: false,
      sendError: null,
      sendCompletePeerName: null,
    }));
  }, []);

  const cleanupPeer = useCallback((peerId: string) => {
    receiversRef.current.delete(peerId);
    setupChannelsRef.current.delete(peerId);
    syncHandlersRef.current.delete(peerId);
  }, []);

  /**
   * Register a handler for sync control messages (sync-manifest, sync-ack, sync-done)
   * arriving on the data channel for a given peer.
   * Returns an unregister function — call it in a cleanup effect.
   */
  const registerSyncHandler = useCallback(
    (
      peerId: string,
      handler: (msg: Record<string, unknown>) => void,
    ): (() => void) => {
      syncHandlersRef.current.set(peerId, handler);
      return () => {
        syncHandlersRef.current.delete(peerId);
      };
    },
    [],
  );

  return {
    ...state,
    sendFiles,
    setupReceiver,
    downloadFile,
    downloadAllFiles,
    clearReceivedFiles,
    resetSendState,
    cleanupPeer,
    registerSyncHandler,
    formatBytes,
  };
}
