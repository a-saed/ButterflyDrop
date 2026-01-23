/**
 * Sync Wizard Component
 * Multi-step wizard for creating folder syncs with modern UI
 */

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Folder,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useFolderSync } from "@/hooks/useFolderSync";
import { useSession } from "@/contexts/SessionContext";
import type { SyncDirection, ConflictResolution } from "@/types/sync";
import { cn } from "@/lib/utils";

interface SyncWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type Step = "peer" | "folder" | "config" | "confirm";

const steps: Step[] = ["peer", "folder", "config", "confirm"];

export function SyncWizard({ open, onOpenChange, onSuccess }: SyncWizardProps) {
  const { peers } = useSession();
  const { createSync, browserCaps } = useFolderSync();

  const [currentStep, setCurrentStep] = useState<Step>("peer");
  const [selectedPeerId, setSelectedPeerId] = useState<string>("");
  const [direction, setDirection] = useState<SyncDirection>("bidirectional");
  const [conflictResolution, setConflictResolution] =
    useState<ConflictResolution>("last-write-wins");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentStepIndex = steps.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  const selectedPeer = peers.find((p) => p.id === selectedPeerId);

  const canProceed = () => {
    switch (currentStep) {
      case "peer":
        return selectedPeerId !== "";
      case "folder":
        return true; // Folder selection happens in createSync
      case "config":
        return true;
      case "confirm":
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStep === "confirm") {
      handleCreate();
    } else {
      const nextIndex = currentStepIndex + 1;
      if (nextIndex < steps.length) {
        setCurrentStep(steps[nextIndex]);
        setError(null);
      }
    }
  };

  const handleBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex]);
      setError(null);
    }
  };

  const handleCreate = async () => {
    if (!selectedPeerId || !selectedPeer) {
      setError("Please select a peer device");
      return;
    }

    try {
      setIsCreating(true);
      setError(null);

      const config = await createSync(
        selectedPeerId,
        selectedPeer.name,
        direction,
        conflictResolution,
      );

      if (config) {
        onSuccess?.();
        handleClose();
      } else {
        setError("Failed to create sync. Please try again.");
      }
    } catch (err) {
      console.error("Failed to create sync:", err);
      setError(err instanceof Error ? err.message : "Failed to create sync");
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      onOpenChange(false);
      setTimeout(() => {
        setCurrentStep("peer");
        setSelectedPeerId("");
        setDirection("bidirectional");
        setConflictResolution("last-write-wins");
        setError(null);
      }, 300);
    }
  };

  const onlinePeers = peers.filter((p) => p.isOnline);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Folder Sync</DialogTitle>
          <DialogDescription>
            Set up automatic folder synchronization with a peer device
          </DialogDescription>
        </DialogHeader>

        {/* Progress Bar */}
        <div className="relative h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-primary transition-all duration-300 ease-in-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Step Indicators */}
        <div className="flex justify-between mb-6">
          {steps.map((step, index) => (
            <div key={step} className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  "flex items-center justify-center size-8 rounded-full border-2 transition-all duration-300",
                  index <= currentStepIndex
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted bg-background text-muted-foreground",
                )}
              >
                {index < currentStepIndex ? (
                  <Check className="size-4" />
                ) : (
                  <span className="text-sm font-medium">{index + 1}</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground capitalize">
                {step}
              </span>
            </div>
          ))}
        </div>

        {/* Browser Capability Warning */}
        {!browserCaps.hasFileSystemAccessAPI && (
          <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg mb-4">
            <AlertCircle className="size-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-yellow-900 dark:text-yellow-100">
                Limited folder access
              </p>
              <p className="text-yellow-700 dark:text-yellow-300 mt-1">
                Your browser doesn't support persistent folder access. You'll
                need to manually rescan folders after page refresh.
              </p>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg mb-4">
            <AlertCircle className="size-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-red-900 dark:text-red-100">{error}</p>
          </div>
        )}

        {/* Step Content */}
        <div className="py-6 min-h-[300px]">
          {/* Step 1: Peer Selection */}
          {currentStep === "peer" && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              <div>
                <h3 className="text-lg font-semibold mb-2">
                  Select Peer Device
                </h3>
                <p className="text-sm text-muted-foreground">
                  Choose the device you want to sync with
                </p>
              </div>

              {onlinePeers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
                    <AlertCircle className="size-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    No online peers available. Please connect with another
                    device first.
                  </p>
                </div>
              ) : (
                <RadioGroup
                  value={selectedPeerId}
                  onValueChange={setSelectedPeerId}
                >
                  <div className="space-y-2">
                    {onlinePeers.map((peer) => (
                      <label
                        key={peer.id}
                        className={cn(
                          "flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all duration-150",
                          selectedPeerId === peer.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50 hover:bg-accent",
                        )}
                      >
                        <RadioGroupItem value={peer.id} />
                        <div className="flex-1">
                          <p className="font-medium">{peer.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {peer.deviceType}
                          </p>
                        </div>
                        <div className="size-2 rounded-full bg-green-500" />
                      </label>
                    ))}
                  </div>
                </RadioGroup>
              )}
            </div>
          )}

          {/* Step 2: Folder Selection Info */}
          {currentStep === "folder" && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              <div>
                <h3 className="text-lg font-semibold mb-2">Select Folder</h3>
                <p className="text-sm text-muted-foreground">
                  You'll be prompted to select a folder in the next step
                </p>
              </div>

              <div className="flex flex-col items-center justify-center py-12">
                <div className="size-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Folder className="size-10 text-primary" />
                </div>
                <p className="text-center text-sm text-muted-foreground max-w-sm">
                  {browserCaps.hasFileSystemAccessAPI
                    ? "You'll be able to select any folder on your device and we'll keep it in sync automatically."
                    : "You'll select files from a folder. Due to browser limitations, you may need to reselect after page refresh."}
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Configuration */}
          {currentStep === "config" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div>
                <h3 className="text-lg font-semibold mb-2">
                  Sync Configuration
                </h3>
                <p className="text-sm text-muted-foreground">
                  Choose how files should be synchronized
                </p>
              </div>

              {/* Sync Direction */}
              <div className="space-y-3">
                <Label className="text-base font-medium">Sync Direction</Label>
                <RadioGroup
                  value={direction}
                  onValueChange={(v: string) =>
                    setDirection(v as SyncDirection)
                  }
                >
                  <label
                    className={cn(
                      "flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all",
                      direction === "bidirectional"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <RadioGroupItem value="bidirectional" />
                    <div>
                      <p className="font-medium">Bidirectional</p>
                      <p className="text-sm text-muted-foreground">
                        Sync changes in both directions
                      </p>
                    </div>
                  </label>

                  <label
                    className={cn(
                      "flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all",
                      direction === "upload-only"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <RadioGroupItem value="upload-only" />
                    <div>
                      <p className="font-medium">Upload Only</p>
                      <p className="text-sm text-muted-foreground">
                        Only send changes to peer
                      </p>
                    </div>
                  </label>

                  <label
                    className={cn(
                      "flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all",
                      direction === "download-only"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <RadioGroupItem value="download-only" />
                    <div>
                      <p className="font-medium">Download Only</p>
                      <p className="text-sm text-muted-foreground">
                        Only receive changes from peer
                      </p>
                    </div>
                  </label>
                </RadioGroup>
              </div>

              {/* Conflict Resolution */}
              <div className="space-y-3">
                <Label className="text-base font-medium">
                  Conflict Resolution
                </Label>
                <RadioGroup
                  value={conflictResolution}
                  onValueChange={(v: string) =>
                    setConflictResolution(v as ConflictResolution)
                  }
                >
                  <label
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all",
                      conflictResolution === "last-write-wins"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <RadioGroupItem value="last-write-wins" />
                    <div>
                      <p className="font-medium text-sm">Last Write Wins</p>
                      <p className="text-xs text-muted-foreground">
                        Newest version overwrites
                      </p>
                    </div>
                  </label>

                  <label
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all",
                      conflictResolution === "manual"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <RadioGroupItem value="manual" />
                    <div>
                      <p className="font-medium text-sm">Manual</p>
                      <p className="text-xs text-muted-foreground">
                        Ask me each time
                      </p>
                    </div>
                  </label>
                </RadioGroup>
              </div>
            </div>
          )}

          {/* Step 4: Confirmation */}
          {currentStep === "confirm" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div>
                <h3 className="text-lg font-semibold mb-2">
                  Ready to Create Sync
                </h3>
                <p className="text-sm text-muted-foreground">
                  Review your settings and create the sync
                </p>
              </div>

              <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Peer Device
                  </Label>
                  <p className="font-medium">{selectedPeer?.name}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Sync Direction
                  </Label>
                  <p className="font-medium capitalize">
                    {direction.replace("-", " ")}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Conflict Resolution
                  </Label>
                  <p className="font-medium capitalize">
                    {conflictResolution.replace("-", " ")}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-between pt-6 border-t">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStepIndex === 0 || isCreating}
          >
            <ArrowLeft className="size-4 mr-2" />
            Back
          </Button>

          <Button
            onClick={handleNext}
            disabled={
              !canProceed() ||
              isCreating ||
              (currentStep === "peer" && onlinePeers.length === 0)
            }
          >
            {isCreating ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : currentStep === "confirm" ? (
              <>
                <Check className="size-4 mr-2" />
                Create Sync
              </>
            ) : (
              <>
                Next
                <ArrowRight className="size-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
