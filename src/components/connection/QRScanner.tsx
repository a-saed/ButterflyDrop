import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScanLine, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { isValidSessionId } from "@/lib/sessionUtils";

interface QRScannerProps {
  onScanSuccess: (sessionId: string) => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function QRScanner({
  onScanSuccess,
  isOpen: controlledOpen,
  onOpenChange,
}: QRScannerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = onOpenChange || setInternalOpen;
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerId = "qr-scanner";

  const stopScanner = async () => {
    if (scannerRef.current && isScanning) {
      try {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
      } catch (err) {
        console.error("Error stopping scanner:", err);
      }
      scannerRef.current = null;
      setIsScanning(false);
    }
  };

  const startScanner = async () => {
    if (scannerRef.current) {
      return; // Already started
    }

    try {
      setError(null);
      setIsScanning(true);

      // Check if element exists
      const element = document.getElementById(scannerId);
      if (!element) {
        throw new Error("Scanner element not found. Please try again.");
      }

      // Check camera availability first
      const devices = await Html5Qrcode.getCameras();
      if (!devices || devices.length === 0) {
        throw new Error("No camera found. Please use a device with a camera.");
      }

      console.log(`📷 Found ${devices.length} camera(s)`);

      const html5QrCode = new Html5Qrcode(scannerId);
      scannerRef.current = html5QrCode;

      // Try back camera first, fallback to any camera
      let cameraId: string | null = null;
      try {
        // Find back camera (environment facing)
        const backCamera = devices.find(
          (d) =>
            d.label.toLowerCase().includes("back") ||
            d.label.toLowerCase().includes("rear"),
        );
        if (backCamera) {
          cameraId = backCamera.id;
          console.log("📷 Using back camera:", backCamera.label);
        } else {
          // Use first available camera
          cameraId = devices[0].id;
          console.log("📷 Using camera:", devices[0].label);
        }
      } catch {
        // Fallback to facingMode
        cameraId = null;
      }

      await html5QrCode.start(
        cameraId || { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 300, height: 300 },
          aspectRatio: 1.0,
          disableFlip: false,
          videoConstraints: {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        (decodedText) => {
          // Successfully scanned
          console.log("✅ QR Code scanned:", decodedText);

          // Extract session ID from URL
          let sessionId: string | null = null;

          try {
            // Try to parse as URL first
            const url = new URL(decodedText);
            const hash = url.hash.slice(1);
            const params = new URLSearchParams(hash);
            sessionId = params.get("session");
          } catch {
            // If not a URL, check if it's just a session ID
            if (isValidSessionId(decodedText)) {
              sessionId = decodedText;
            } else {
              // Try to extract session ID from any string format
              const match = decodedText.match(
                /session[=:]([A-Za-z0-9_-]{8,16})/i,
              );
              if (match) {
                sessionId = match[1];
              }
            }
          }

          if (sessionId && isValidSessionId(sessionId)) {
            toast.success("QR code scanned!", {
              description: `Joining session...`,
              icon: "🦋",
            });

            // Stop scanner
            stopScanner();
            setIsOpen(false);

            // Call success handler
            onScanSuccess(sessionId);
          } else {
            toast.error("Invalid QR code", {
              description:
                "This doesn't appear to be a Butterfly Drop session QR code",
            });
          }
        },
        (errorMessage) => {
          // Scanning error (not a fatal error, just no QR code detected yet)
          // Don't show errors for normal scanning - this is expected
          console.log("Scanning...", errorMessage);
        },
      );

      console.log("✅ Camera started successfully");
    } catch (err) {
      console.error("❌ Error starting scanner:", err);

      let errorMessage = "Unknown error";
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === "string") {
        errorMessage = err;
      }

      // Better error messages
      if (
        errorMessage.includes("Permission denied") ||
        errorMessage.includes("NotAllowedError") ||
        errorMessage.includes("NotAllowed")
      ) {
        setError(
          "Camera permission denied. Please allow camera access in your browser settings and try again.",
        );
      } else if (
        errorMessage.includes("NotFoundError") ||
        errorMessage.includes("no camera") ||
        errorMessage.includes("No camera")
      ) {
        setError("No camera found. Please use a device with a camera.");
      } else if (
        errorMessage.includes("NotReadableError") ||
        errorMessage.includes("TrackStartError")
      ) {
        setError(
          "Camera is already in use by another application. Please close other apps using the camera.",
        );
      } else if (errorMessage.includes("OverconstrainedError")) {
        setError(
          "Camera doesn't support required settings. Trying with default settings...",
        );
        // Retry with simpler config
        setTimeout(() => {
          startScannerWithFallback();
        }, 1000);
        return;
      } else {
        // Check if HTTPS is required
        const isSecureContext =
          window.isSecureContext ||
          location.protocol === "https:" ||
          location.hostname === "localhost";
        const httpsMessage = !isSecureContext
          ? " Camera access requires HTTPS. Please use https:// or localhost."
          : "";

        setError(
          `Failed to start camera: ${errorMessage}.${httpsMessage} Please check browser permissions and try again.`,
        );
      }

      setIsScanning(false);
      scannerRef.current = null;
    }
  };

  // Fallback scanner with simpler config
  const startScannerWithFallback = async () => {
    if (scannerRef.current) return;

    try {
      setError(null);
      setIsScanning(true);

      const html5QrCode = new Html5Qrcode(scannerId);
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: "user" }, // Try front camera as fallback
        {
          fps: 5,
          qrbox: { width: 300, height: 300 },
        },
        (decodedText) => {
          let sessionId: string | null = null;
          try {
            const url = new URL(decodedText);
            const hash = url.hash.slice(1);
            const params = new URLSearchParams(hash);
            sessionId = params.get("session");
          } catch {
            if (isValidSessionId(decodedText)) {
              sessionId = decodedText;
            } else {
              const match = decodedText.match(
                /session[=:]([A-Za-z0-9_-]{8,16})/i,
              );
              if (match) sessionId = match[1];
            }
          }

          if (sessionId && isValidSessionId(sessionId)) {
            toast.success("QR code scanned!", {
              description: `Joining session...`,
              icon: "🦋",
            });
            stopScanner();
            setIsOpen(false);
            onScanSuccess(sessionId);
          }
        },
        () => {},
      );
    } catch (err) {
      console.error("Fallback scanner also failed:", err);
      setError(
        "Unable to access camera. Please check browser permissions and ensure you're using HTTPS (required for camera access).",
      );
      setIsScanning(false);
      scannerRef.current = null;
    }
  };

  useEffect(() => {
    if (isOpen && !isScanning && !scannerRef.current) {
      // Longer delay to ensure dialog is fully rendered and DOM is ready
      const timer = setTimeout(() => {
        const element = document.getElementById(scannerId);
        if (element) {
          startScanner();
        } else {
          console.warn("Scanner element not ready, retrying...");
          setTimeout(() => startScanner(), 200);
        }
      }, 300);

      return () => clearTimeout(timer);
    }

    return () => {
      // Cleanup on unmount or close
      if (!isOpen) {
        stopScanner();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleClose = async () => {
    await stopScanner();
    setIsOpen(false);
    setError(null);
  };

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setIsOpen(true)}
        className="shrink-0 h-8 w-8 touch-manipulation transition-all"
        title="Scan QR code - open camera to scan a session QR code"
      >
        <ScanLine className="h-4 w-4" />
      </Button>

      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Scan QR Code</DialogTitle>
            <DialogDescription>
              Point your camera at a Butterfly Drop session QR code
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-4">
            {error ? (
              <div className="w-full p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                  <p className="text-sm font-medium">{error}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startScanner}
                  className="mt-3 w-full"
                >
                  Try Again
                </Button>
              </div>
            ) : (
              <>
                <div
                  id={scannerId}
                  className="w-full max-w-sm rounded-lg overflow-hidden border-2 border-border"
                  style={{ minHeight: "300px" }}
                />
                {!isScanning && (
                  <p className="text-sm text-muted-foreground text-center">
                    Starting camera...
                  </p>
                )}
              </>
            )}

            <div className="text-xs text-muted-foreground text-center space-y-1">
              <p>💡 Make sure the QR code is clearly visible</p>
              <p>📱 Use the back camera on mobile devices</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
