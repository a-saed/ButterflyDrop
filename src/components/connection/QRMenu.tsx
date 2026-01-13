import { useState, useEffect, useRef } from "react";
import { QrCode, ScanLine, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import QRCode from "react-qr-code";
import { Html5Qrcode } from "html5-qrcode";
import { isValidSessionId } from "@/lib/sessionUtils";

interface QRMenuProps {
  shareUrl: string;
  onScanSuccess: (sessionId: string) => void;
}

export function QRMenu({ shareUrl, onScanSuccess }: QRMenuProps) {
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showScannerDialog, setShowScannerDialog] = useState(false);

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 transition-butterfly hover-lift"
            title="QR Code options"
          >
            <QrCode className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="end">
          <div className="space-y-1">
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={() => {
                setShowShareDialog(true);
              }}
            >
              <QrCode className="h-4 w-4" />
              <span>Show QR Code</span>
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={() => {
                setShowScannerDialog(true);
              }}
            >
              <ScanLine className="h-4 w-4" />
              <span>Scan QR Code</span>
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Share QR Code Dialog */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share with QR Code</DialogTitle>
            <DialogDescription>
              Scan this QR code with another device to join
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="p-4 bg-white rounded-lg">
              <QRCode 
                value={shareUrl} 
                size={256} 
                level="H"
              />
            </div>
            <div className="text-sm text-muted-foreground text-center space-y-2 w-full">
              <p className="font-medium">Session URL:</p>
              <code className="text-xs bg-muted px-2 py-1 rounded block break-all">
                {shareUrl}
              </code>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Scanner Dialog */}
      <Dialog open={showScannerDialog} onOpenChange={setShowScannerDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Scan QR Code</DialogTitle>
            <DialogDescription>
              Point your camera at a Butterfly Drop session QR code
            </DialogDescription>
          </DialogHeader>
          <QRScannerContent
            onScanSuccess={(sessionId) => {
              setShowScannerDialog(false);
              onScanSuccess(sessionId);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

// Scanner content without its own dialog wrapper
function QRScannerContent({ onScanSuccess }: { onScanSuccess: (sessionId: string) => void }) {
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerId = "qr-scanner-menu";

  useEffect(() => {
    const startScanner = async () => {
      if (scannerRef.current) return;

      try {
        setError(null);
        setIsScanning(true);
        const html5QrCode = new Html5Qrcode(scannerId);
        scannerRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: "environment" },
          { 
            fps: 10, 
            qrbox: { width: 300, height: 300 }, 
            aspectRatio: 1.0,
            videoConstraints: {
              facingMode: "environment",
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
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
                const match = decodedText.match(/session[=:]([A-Za-z0-9_-]{8,16})/i);
                if (match) sessionId = match[1];
              }
            }

            if (sessionId && isValidSessionId(sessionId)) {
              html5QrCode.stop().then(() => html5QrCode.clear());
              scannerRef.current = null;
              setIsScanning(false);
              onScanSuccess(sessionId);
            }
          },
          () => {}
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        if (errorMessage.includes("Permission denied") || errorMessage.includes("NotAllowedError")) {
          setError("Camera permission denied. Please allow camera access.");
        } else if (errorMessage.includes("NotFoundError")) {
          setError("No camera found.");
        } else {
          setError(`Failed to start camera: ${errorMessage}`);
        }
        setIsScanning(false);
        scannerRef.current = null;
      }
    };

    startScanner();

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current.clear();
      }
    };
  }, [onScanSuccess]);

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      {error ? (
        <div className="w-full p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
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
  );
}

