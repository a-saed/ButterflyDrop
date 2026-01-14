/**
 * Butterfly-themed sound effects using Web Audio API
 * Generates flutter, wing flap, and success sounds programmatically
 */

class SoundManager {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled: boolean = true;
  private volume: number = 0.3; // Default volume (0-1)

  constructor() {
    // Initialize audio context on first user interaction
    if (typeof window !== 'undefined') {
      this.initAudioContext();
    }
  }

  private async initAudioContext() {
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioContextClass();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.audioContext.destination);
    } catch (error) {
      console.warn('Web Audio API not supported:', error);
      this.enabled = false;
    }
  }

  private async ensureAudioContext() {
    if (!this.audioContext) {
      await this.initAudioContext();
    }
    // Resume audio context if suspended (browser autoplay policy)
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.masterGain) {
      this.masterGain.gain.value = this.volume;
    }
  }

  /**
   * Generate a flutter sound (gentle wing flap)
   */
  async flutter(duration: number = 0.15, frequency: number = 800) {
    if (!this.enabled) return;
    await this.ensureAudioContext();
    if (!this.audioContext || !this.masterGain) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    
    // Quick flutter - frequency modulation
    oscillator.frequency.exponentialRampToValueAtTime(
      frequency * 1.2,
      this.audioContext.currentTime + duration * 0.3
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      frequency,
      this.audioContext.currentTime + duration
    );

    // Envelope - quick attack, gentle decay
    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, this.audioContext.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);

    oscillator.connect(gainNode);
    if (this.masterGain) {
      gainNode.connect(this.masterGain);
    }

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + duration);
  }

  /**
   * Generate a wing flap sound (deeper, more pronounced)
   */
  async wingFlap(duration: number = 0.2, frequency: number = 400) {
    if (!this.enabled) return;
    await this.ensureAudioContext();
    if (!this.audioContext || !this.masterGain) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    
    // Wing flap - frequency drops then rises
    oscillator.frequency.linearRampToValueAtTime(
      frequency * 0.7,
      this.audioContext.currentTime + duration * 0.5
    );
    oscillator.frequency.linearRampToValueAtTime(
      frequency * 1.1,
      this.audioContext.currentTime + duration
    );

    // Envelope - quick attack, smooth decay
    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.4, this.audioContext.currentTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);

    oscillator.connect(gainNode);
    if (this.masterGain) {
      gainNode.connect(this.masterGain);
    }

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + duration);
  }

  /**
   * Generate a success sound (butterfly landing/completion)
   */
  async success() {
    if (!this.enabled) return;
    await this.ensureAudioContext();
    if (!this.audioContext || !this.masterGain) return;

    const now = this.audioContext.currentTime;
    
    // Create a pleasant ascending chord
    const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5
    
    frequencies.forEach((freq, index) => {
      const oscillator = this.audioContext!.createOscillator();
      const gainNode = this.audioContext!.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, now + index * 0.05);
      
      // Slight vibrato
      const vibrato = this.audioContext!.createOscillator();
      const vibratoGain = this.audioContext!.createGain();
      vibrato.type = 'sine';
      vibrato.frequency.value = 5;
      vibratoGain.gain.value = freq * 0.02;
      vibrato.connect(vibratoGain);
      vibratoGain.connect(oscillator.frequency);
      
      // Envelope - gentle attack and decay
      gainNode.gain.setValueAtTime(0, now + index * 0.05);
      gainNode.gain.linearRampToValueAtTime(0.2, now + index * 0.05 + 0.1);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + index * 0.05 + 0.4);

      oscillator.connect(gainNode);
      if (this.masterGain) {
        gainNode.connect(this.masterGain);
      }

      vibrato.start(now + index * 0.05);
      vibrato.stop(now + index * 0.05 + 0.4);
      oscillator.start(now + index * 0.05);
      oscillator.stop(now + index * 0.05 + 0.4);
    });
  }

  /**
   * Generate a connection sound (butterfly approaching)
   */
  async connect() {
    if (!this.enabled) return;
    await this.ensureAudioContext();
    if (!this.audioContext || !this.masterGain) return;

    // Series of gentle flutters approaching
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        this.flutter(0.1, 600 + i * 50);
      }, i * 100);
    }
  }

  /**
   * Generate a transfer started sound
   */
  async transferStart() {
    if (!this.enabled) return;
    await this.ensureAudioContext();
    if (!this.audioContext || !this.masterGain) return;

    // Quick wing flaps
    this.wingFlap(0.15, 450);
    setTimeout(() => {
      this.wingFlap(0.15, 500);
    }, 80);
  }

  /**
   * Generate a file received sound
   */
  async fileReceived() {
    if (!this.enabled) return;
    await this.ensureAudioContext();
    if (!this.audioContext || !this.masterGain) return;

    // Gentle flutter followed by success
    this.flutter(0.12, 700);
    setTimeout(() => {
      this.success();
    }, 150);
  }

  /**
   * Generate an error sound (gentle, not harsh)
   */
  async error() {
    if (!this.enabled) return;
    await this.ensureAudioContext();
    if (!this.audioContext || !this.masterGain) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(300, this.audioContext.currentTime);
    oscillator.frequency.linearRampToValueAtTime(200, this.audioContext.currentTime + 0.3);

    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.2, this.audioContext.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);

    oscillator.connect(gainNode);
    if (this.masterGain) {
      gainNode.connect(this.masterGain);
    }

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + 0.3);
  }
}

// Singleton instance
export const soundManager = new SoundManager();

// Convenience functions
export const playFlutter = () => soundManager.flutter();
export const playWingFlap = () => soundManager.wingFlap();
export const playSuccess = () => soundManager.success();
export const playConnect = () => soundManager.connect();
export const playTransferStart = () => soundManager.transferStart();
export const playFileReceived = () => soundManager.fileReceived();
export const playError = () => soundManager.error();

