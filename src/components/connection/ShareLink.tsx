import { useState } from "react";
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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy URL:", error);
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
            <DialogTitle>Scan QR Code</DialogTitle>
            <DialogDescription>
              Scan this QR code with another device to connect
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="p-4 bg-white rounded-lg">
              <QRCode value={url} size={256} />
            </div>
            <p className="text-sm text-muted-foreground text-center max-w-xs">
              {url}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
