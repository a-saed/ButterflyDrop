/**
 * Conflict Resolver Component
 * UI for resolving file conflicts
 */

import { AlertCircle, Check } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import type { ConflictFile, ConflictResolutionAction } from "@/types/sync";
import { formatFileSize } from "@/lib/fileUtils";
import { cn } from "@/lib/utils";

interface ConflictResolverProps {
  conflicts: ConflictFile[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolve: (resolutions: ConflictResolutionAction[]) => void;
}

export function ConflictResolver({
  conflicts,
  open,
  onOpenChange,
  onResolve,
}: ConflictResolverProps) {
  const [resolutions, setResolutions] = useState<
    Map<string, ConflictResolutionAction["action"]>
  >(new Map());

  const handleResolve = () => {
    const actions: ConflictResolutionAction[] = conflicts.map((conflict) => ({
      path: conflict.path,
      action: resolutions.get(conflict.path) || "manual",
    }));

    onResolve(actions);
    onOpenChange(false);
  };

  const handleBatchResolve = (action: ConflictResolutionAction["action"]) => {
    const newResolutions = new Map<
      string,
      ConflictResolutionAction["action"]
    >();
    conflicts.forEach((conflict) => {
      newResolutions.set(conflict.path, action);
    });
    setResolutions(newResolutions);
  };

  const allResolved = conflicts.every((c) => resolutions.has(c.path));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="size-5 text-orange-600 dark:text-orange-400" />
            Resolve Conflicts
          </DialogTitle>
          <DialogDescription>
            {conflicts.length} file{conflicts.length !== 1 ? "s have" : " has"}{" "}
            been modified on both devices. Choose which version to keep.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Batch Actions */}
          <div className="flex flex-wrap gap-2 pb-4 border-b">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleBatchResolve("local")}
            >
              Keep All Local
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleBatchResolve("remote")}
            >
              Keep All Remote
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleBatchResolve("both")}
            >
              Keep Both
            </Button>
          </div>

          {/* Conflict List */}
          {conflicts.map((conflict) => {
            const resolution = resolutions.get(conflict.path);

            return (
              <div
                key={conflict.path}
                className={cn(
                  "p-4 rounded-lg border-2 transition-all",
                  resolution
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card",
                )}
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {conflict.local.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {conflict.path}
                    </p>
                  </div>
                  {resolution && (
                    <Check className="size-5 text-primary shrink-0" />
                  )}
                </div>

                {/* Comparison */}
                <div className="grid grid-cols-2 gap-4 mb-3 text-sm">
                  <div className="p-3 bg-blue-500/10 rounded border border-blue-500/20">
                    <p className="text-xs text-muted-foreground mb-1">
                      Local Version
                    </p>
                    <p className="font-medium text-blue-600 dark:text-blue-400">
                      {formatFileSize(conflict.local.size)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(conflict.local.lastModified).toLocaleString()}
                    </p>
                  </div>

                  <div className="p-3 bg-purple-500/10 rounded border border-purple-500/20">
                    <p className="text-xs text-muted-foreground mb-1">
                      Remote Version
                    </p>
                    <p className="font-medium text-purple-600 dark:text-purple-400">
                      {formatFileSize(conflict.remote.size)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(conflict.remote.lastModified).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Resolution Options */}
                <RadioGroup
                  value={resolution || ""}
                  onValueChange={(value: string) => {
                    const newResolutions = new Map(resolutions);
                    newResolutions.set(
                      conflict.path,
                      value as ConflictResolutionAction["action"],
                    );
                    setResolutions(newResolutions);
                  }}
                >
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <RadioGroupItem value="local" />
                      <span className="text-sm">Keep local version</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <RadioGroupItem value="remote" />
                      <span className="text-sm">Keep remote version</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <RadioGroupItem value="both" />
                      <span className="text-sm">Keep both (rename)</span>
                    </label>
                  </div>
                </RadioGroup>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleResolve} disabled={!allResolved}>
            <Check className="size-4 mr-2" />
            Apply Resolutions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
