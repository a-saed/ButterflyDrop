/**
 * Sync Protocol
 * Handles WebRTC messaging for folder synchronization
 */

import type { FileSnapshot, SyncMessage } from '@/types/sync';

/**
 * Protocol message types
 */
interface SyncRequestMessage extends SyncMessage {
  type: 'sync-request';
  data: {
    configId: string;
  };
}

interface SyncMetadataMessage extends SyncMessage {
  type: 'sync-metadata';
  data: {
    configId: string;
    snapshots: FileSnapshot[];
  };
}

interface SyncCompleteMessage extends SyncMessage {
  type: 'sync-complete';
  data: {
    configId: string;
    filesTransferred: number;
    bytesTransferred: number;
  };
}

interface SyncErrorMessage extends SyncMessage {
  type: 'sync-error';
  data: {
    configId: string;
    error: string;
  };
}

type SyncProtocolMessage =
  | SyncRequestMessage
  | SyncMetadataMessage
  | SyncCompleteMessage
  | SyncErrorMessage;

/**
 * Message handler callback type
 */
export type SyncMessageHandler = (
  peerId: string,
  message: SyncProtocolMessage
) => void | Promise<void>;

/**
 * SyncProtocol class manages sync messaging
 */
export class SyncProtocol {
  private handlers = new Map<string, Set<SyncMessageHandler>>();
  private dataChannels = new Map<string, RTCDataChannel>();

  /**
   * Register a data channel for a peer
   */
  registerDataChannel(peerId: string, dataChannel: RTCDataChannel): void {
    this.dataChannels.set(peerId, dataChannel);
  }

  /**
   * Unregister a data channel
   */
  unregisterDataChannel(peerId: string): void {
    this.dataChannels.delete(peerId);
  }

  /**
   * Subscribe to sync messages
   */
  on(event: 'message', handler: SyncMessageHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(event);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }

  /**
   * Emit message to handlers
   */
  private async emit(peerId: string, message: SyncProtocolMessage): Promise<void> {
    const handlers = this.handlers.get('message');
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        await handler(peerId, message);
      } catch (error) {
        console.error('Sync message handler error:', error);
      }
    }
  }

  /**
   * Handle incoming sync message
   */
  async handleMessage(peerId: string, message: unknown): Promise<void> {
    // Check if message is a sync message
    if (!this.isSyncMessage(message)) {
      return;
    }

    await this.emit(peerId, message as SyncProtocolMessage);
  }

  /**
   * Check if message is a sync message
   */
  private isSyncMessage(message: unknown): boolean {
    if (typeof message !== 'object' || message === null) {
      return false;
    }

    const msg = message as Record<string, unknown>;
    return (
      typeof msg.type === 'string' &&
      (msg.type === 'sync-request' ||
        msg.type === 'sync-metadata' ||
        msg.type === 'sync-complete' ||
        msg.type === 'sync-error') &&
      typeof msg.configId === 'string'
    );
  }

  /**
   * Send sync request to peer
   */
  async sendSyncRequest(peerId: string, configId: string): Promise<void> {
    const message: SyncRequestMessage = {
      type: 'sync-request',
      syncId: `sync-${Date.now()}`,
      configId,
      data: {
        configId,
      },
    };

    await this.sendMessage(peerId, message);
  }

  /**
   * Send metadata to peer
   */
  async sendMetadata(
    peerId: string,
    configId: string,
    snapshots: FileSnapshot[]
  ): Promise<void> {
    const message: SyncMetadataMessage = {
      type: 'sync-metadata',
      syncId: `sync-${Date.now()}`,
      configId,
      data: {
        configId,
        snapshots,
      },
    };

    await this.sendMessage(peerId, message);
  }

  /**
   * Send sync complete message
   */
  async sendSyncComplete(
    peerId: string,
    configId: string,
    filesTransferred: number,
    bytesTransferred: number
  ): Promise<void> {
    const message: SyncCompleteMessage = {
      type: 'sync-complete',
      syncId: `sync-${Date.now()}`,
      configId,
      data: {
        configId,
        filesTransferred,
        bytesTransferred,
      },
    };

    await this.sendMessage(peerId, message);
  }

  /**
   * Send sync error message
   */
  async sendSyncError(
    peerId: string,
    configId: string,
    error: string
  ): Promise<void> {
    const message: SyncErrorMessage = {
      type: 'sync-error',
      syncId: `sync-${Date.now()}`,
      configId,
      data: {
        configId,
        error,
      },
    };

    await this.sendMessage(peerId, message);
  }

  /**
   * Send message via data channel
   */
  private async sendMessage(
    peerId: string,
    message: SyncProtocolMessage
  ): Promise<void> {
    const dataChannel = this.dataChannels.get(peerId);
    if (!dataChannel) {
      throw new Error(`No data channel for peer ${peerId}`);
    }

    if (dataChannel.readyState !== 'open') {
      throw new Error(`Data channel not open for peer ${peerId}`);
    }

    try {
      const messageStr = JSON.stringify(message);
      dataChannel.send(messageStr);
    } catch (error) {
      console.error('Failed to send sync message:', error);
      throw error;
    }
  }

  /**
   * Check if peer is available
   */
  isPeerAvailable(peerId: string): boolean {
    const dataChannel = this.dataChannels.get(peerId);
    return dataChannel !== undefined && dataChannel.readyState === 'open';
  }
}

// Global sync protocol instance
export const syncProtocol = new SyncProtocol();
