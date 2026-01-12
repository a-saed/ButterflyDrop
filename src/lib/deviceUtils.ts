/**
 * Device utilities for peer identification
 */

export type DeviceType = "desktop" | "mobile" | "tablet" | "laptop";

/**
 * Detect device type from user agent
 */
export function detectDeviceType(): DeviceType {
  const ua = navigator.userAgent.toLowerCase();

  // Check tablet first (iPad, Android tablets)
  if (/ipad|tablet|playbook|silk/i.test(ua)) {
    return "tablet";
  }

  // Check mobile devices (iPhone, Android phones, etc.)
  if (
    /iphone|ipod|android.*mobile|blackberry|opera.*mini|windows\sce|palm|smartphone|iemobile/i.test(
      ua,
    )
  ) {
    return "mobile";
  }

  // Check laptops (MacOS, but not iPad which was caught above)
  if (/macintosh|mac os x/i.test(ua) && !/ipad/i.test(ua)) {
    return "laptop";
  }

  return "desktop";
}

/**
 * Get device name from browser/OS
 */
export function getDeviceName(): string {
  const ua = navigator.userAgent;
  const platform = navigator.platform;

  // Check mobile devices FIRST (most specific)
  if (/iphone/i.test(ua)) {
    // Try to get iPhone model from UA
    const match = ua.match(/iphone\s*os\s*(\d+)/i);
    if (match && match[1]) {
      return `iPhone (iOS ${match[1]})`;
    }
    return "iPhone";
  }

  if (/ipad/i.test(ua)) {
    const match = ua.match(/ipad.*?os\s*(\d+)/i);
    if (match && match[1]) {
      return `iPad (iOS ${match[1]})`;
    }
    return "iPad";
  }

  if (/android/i.test(ua)) {
    // Try to get Android device model
    const match = ua.match(/android.*?;\s*([^)]+)\)/i);
    if (match && match[1]) {
      const model = match[1].trim();
      // Clean up common prefixes
      return model.replace(/^(Build\/|SAMSUNG\s*)/i, "");
    }
    return "Android Device";
  }

  // Desktop/Laptop devices
  if (/macintosh|mac os x/i.test(ua) && !/ipad/i.test(ua)) {
    // Check if it's Apple Silicon or Intel
    if (/arm64|aarch64/i.test(ua)) {
      return "Mac (Apple Silicon)";
    }
    return "Mac";
  }

  if (/windows/i.test(ua)) {
    if (/windows nt 10/i.test(ua)) {
      return "Windows 10/11 PC";
    }
    return "Windows PC";
  }

  if (/linux/i.test(ua)) {
    // Check for specific Linux distros
    if (/ubuntu/i.test(ua)) {
      return "Ubuntu PC";
    }
    if (/fedora/i.test(ua)) {
      return "Fedora PC";
    }
    return "Linux PC";
  }

  return platform || "Unknown Device";
}

/**
 * Generate a unique peer ID for this device
 * Uses localStorage to persist peer ID across sessions
 * This prevents duplicate peers when page refreshes
 */
export function generatePeerId(): string {
  const STORAGE_KEY = "butterfly-drop-peer-id";

  // Check if we already have a peer ID stored
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      console.log(
        `[deviceUtils] 🔄 Reusing existing peer ID: ${stored.slice(0, 8)}...`,
      );
      return stored;
    }
  } catch (error) {
    console.warn(
      "[deviceUtils] ⚠️ localStorage not available, generating new ID",
    );
  }

  // Generate new peer ID
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  const peerId = `${timestamp}-${random}`;

  // Store for future use
  try {
    localStorage.setItem(STORAGE_KEY, peerId);
    console.log(
      `[deviceUtils] 🆕 Generated and stored new peer ID: ${peerId.slice(0, 8)}...`,
    );
  } catch (error) {
    console.warn("[deviceUtils] ⚠️ Could not store peer ID in localStorage");
  }

  return peerId;
}
