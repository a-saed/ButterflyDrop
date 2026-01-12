import { useState, useEffect } from "react";
import { Copy, Check, Share2, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import QRCode from "react-qr-code";
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
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      console.log("📋 [ShareLink] URL copied to clipboard:", url);
    } catch (error) {
      console.error("❌ [ShareLink] Failed to copy URL:", error);
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
    <div className="flex items-center gap-2">
      <div className="flex-1 px-3 py-2 bg-muted rounded-lg border text-sm truncate">
        {url}
      </div>

      <Button
        variant="outline"
        size="icon"
        onClick={handleCopy}
        className="shrink-0 transition-butterfly hover-lift"
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
          className="shrink-0 transition-butterfly hover-lift"
        >
          <Share2 className="h-4 w-4" />
        </Button>
      )}

      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 transition-butterfly hover-lift"
          >
            <QrCode className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share with QR Code</DialogTitle>
            <DialogDescription>
              Scan this QR code with your mobile device to join
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="p-4 bg-white rounded-lg">
              <QRCode value={url} size={256} />
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
