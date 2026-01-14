import { useEffect, useRef } from 'react';
import { soundManager, playConnect, playTransferStart, playSuccess, playFileReceived, playError } from '@/lib/soundEffects';

interface UseSoundEffectsOptions {
  enabled?: boolean;
  volume?: number;
}

/**
 * Hook to manage sound effects for butterfly-themed events
 */
export function useSoundEffects(options: UseSoundEffectsOptions = {}) {
  const { enabled = true, volume = 0.3 } = options;
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      soundManager.setEnabled(enabled);
      soundManager.setVolume(volume);
      initializedRef.current = true;
    }
  }, [enabled, volume]);

  return {
    playConnect,
    playTransferStart,
    playSuccess,
    playFileReceived,
    playError,
    setEnabled: (enabled: boolean) => {
      soundManager.setEnabled(enabled);
    },
    setVolume: (volume: number) => {
      soundManager.setVolume(volume);
    },
  };
}

