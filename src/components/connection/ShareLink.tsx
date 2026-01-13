import { useState, useEffect } from "react";
import { Copy, Check, Share2, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ShareLinkProps {
  url: string;
}

export function ShareLink({ url }: ShareLinkProps) {
  const [copied, setCopied] = useState(false);
  const [qrSize, setQrSize] = useState(256);

  useEffect(() => {
    const updateQrSize = () => {
      // Larger QR codes are easier to scan
      setQrSize(window.innerWidth < 640 ? 280 : 320);
    };
    updateQrSize();
    window.addEventListener('resize', updateQrSize);
    return () => window.removeEventListener('resize', updateQrSize);
  }, []);

  // Log QR code URL whenever it changes
  useEffect(() => {
    if (url) {
      console.log("🔗 [ShareLink] QR Code URL generated:");
      console.log(`  - Full URL: ${url}`);
      console.log(
        `  - Session ID: ${url.split("#session=")[1] || "NOT FOUND"}`,
      );
      console.log(`  ✅ Scan this QR code to join session`);
    }
  }, [url]);

  const handleCopy = async () => {
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        toast.success("Link copied!", {
          description: url,
          icon: "📋",
          duration: 3000,
        });
        setTimeout(() => setCopied(false), 2000);
        console.log("📋 [ShareLink] URL copied to clipboard:", url);
        return;
      } catch (error) {
        console.warn("❌ [ShareLink] Clipboard API failed, trying fallback:", error);
      }
    }

    // Fallback for mobile browsers
    try {
      // Create a temporary textarea element
      const textArea = document.createElement("textarea");
      textArea.value = url;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      textArea.style.opacity = "0";
      textArea.setAttribute("readonly", "");
      document.body.appendChild(textArea);

      // Select and copy
      textArea.select();
      textArea.setSelectionRange(0, url.length);

      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);

      if (successful) {
        setCopied(true);
        toast.success("Link copied!", {
          description: url,
          icon: "📋",
          duration: 3000,
        });
        setTimeout(() => setCopied(false), 2000);
        console.log("📋 [ShareLink] URL copied using fallback method");
      } else {
        throw new Error("execCommand failed");
      }
    } catch (error) {
      console.error("❌ [ShareLink] All copy methods failed:", error);
      toast.error("Failed to copy link", {
        description: "Please use the share button or manually copy the URL",
        duration: 4000,
      });
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Butterfly Drop",
          text: "Share files with me",
          url,
        });
      } catch (error) {
        // User cancelled or error occurred
        console.error("Share failed:", error);
      }
    } else {
      handleCopy();
    }
  };

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
      <Button
        variant="outline"
        size="icon"
        onClick={handleCopy}
        className="shrink-0 transition-butterfly hover-lift h-9 w-9 sm:h-9 sm:w-9 touch-manipulation"
        title={copied ? "Copied to clipboard!" : "Copy session URL to clipboard"}
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-500 animate-morph-success" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>

      {navigator.share && typeof navigator.share === "function" && (
        <Button
          variant="outline"
          size="icon"
          onClick={handleShare}
          className="shrink-0 transition-butterfly hover-lift h-9 w-9 sm:h-9 sm:w-9 touch-manipulation"
          title="Share session link via native share dialog"
        >
          <Share2 className="h-4 w-4" />
        </Button>
      )}

      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 transition-butterfly hover-lift h-9 w-9 sm:h-9 sm:w-9 touch-manipulation"
            title="Show QR code - scan with another device to join"
          >
            <QrCode className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md mx-auto">
          <DialogHeader>
            <DialogTitle>Share with QR Code</DialogTitle>
            <DialogDescription>
              Scan this QR code with your mobile device to join
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="p-3 sm:p-4 bg-white rounded-lg w-full max-w-[280px] sm:max-w-none flex items-center justify-center">
              <QRCode 
                value={url} 
                size={qrSize} 
                level="H"
              />
            </div>
            <div className="text-sm text-muted-foreground text-center space-y-2">
              <p className="font-medium">Session URL:</p>
              <code className="text-xs bg-muted px-2 py-1 rounded block break-all">
                {url}
              </code>
              <p className="text-xs text-green-600 dark:text-green-400">
                ✅ QR code contains this URL
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
