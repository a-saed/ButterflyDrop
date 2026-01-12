/**
 * Device utilities for peer identification
 */

export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'laptop'

/**
 * Detect device type from user agent
 */
export function detectDeviceType(): DeviceType {
  const ua = navigator.userAgent.toLowerCase()
  
  if (/tablet|ipad|playbook|silk/i.test(ua)) {
    return 'tablet'
  }
  if (/mobile|iphone|ipod|android|blackberry|opera|mini|windows\sce|palm|smartphone|iemobile/i.test(ua)) {
    return 'mobile'
  }
  if (/macintosh|mac os x/i.test(ua)) {
    return 'laptop'
  }
  return 'desktop'
}

/**
 * Get device name from browser/OS
 */
export function getDeviceName(): string {
  const ua = navigator.userAgent
  const platform = navigator.platform
  
  // Try to extract device name from user agent
  if (/macintosh|mac os x/i.test(ua)) {
    // Try to get Mac model name if available
    return 'Mac'
  }
  if (/windows/i.test(ua)) {
    return 'Windows PC'
  }
  if (/linux/i.test(ua)) {
    return 'Linux PC'
  }
  if (/iphone/i.test(ua)) {
    return 'iPhone'
  }
  if (/ipad/i.test(ua)) {
    return 'iPad'
  }
  if (/android/i.test(ua)) {
    // Try to get Android device model
    const match = ua.match(/android.*?; (.*?)\)/i)
    if (match && match[1]) {
      return match[1].trim()
    }
    return 'Android Device'
  }
  
  return platform || 'Device'
}

/**
 * Generate a unique peer ID for this device
 */
export function generatePeerId(): string {
  // Use a combination of timestamp and random to ensure uniqueness
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 9)
  return `${timestamp}-${random}`
}

