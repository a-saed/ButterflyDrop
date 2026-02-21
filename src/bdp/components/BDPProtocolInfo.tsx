import { useState } from "react";
import { ChevronDown, Zap, GitMerge, Shield, Layers, ArrowRightLeft, Github, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface Phase {
  name: string;
  label: string;
  description: string;
  color: string;
}

const PHASES: Phase[] = [
  {
    name: "greeting",
    label: "Greeting",
    description: "Peers exchange device identity, paired folder metadata, and protocol version to establish a shared context before any sync begins.",
    color: "bg-blue-500/15 text-blue-500 border-blue-500/20",
  },
  {
    name: "diffing",
    label: "Diffing",
    description: "Both sides compute a Merkle-style manifest of their local files (name, size, mtime, hash). Manifests are exchanged and compared to find additions, deletions, and modifications.",
    color: "bg-violet-500/15 text-violet-500 border-violet-500/20",
  },
  {
    name: "delta_sync",
    label: "Delta Sync",
    description: "Only the changed chunks of modified files are transferred using a rolling-hash algorithm — identical byte ranges are skipped entirely, minimising data over the wire.",
    color: "bg-amber-500/15 text-amber-500 border-amber-500/20",
  },
  {
    name: "full_sync",
    label: "Full Sync",
    description: "New or wholly-replaced files are streamed in 256 KB chunks through the WebRTC DataChannel. Sequence numbers guarantee correct reassembly.",
    color: "bg-orange-500/15 text-orange-500 border-orange-500/20",
  },
  {
    name: "resolving_conflict",
    label: "Conflict Resolution",
    description: "When the same file was modified on both sides since the last sync, BDP surfaces a conflict for the user to resolve — keep local, keep remote, or keep both.",
    color: "bg-red-500/15 text-red-500 border-red-500/20",
  },
  {
    name: "finalizing",
    label: "Finalizing",
    description: "Both peers confirm the transfer is complete, update their local sync-state snapshot, and emit a finalisation handshake so the next diff starts from a clean baseline.",
    color: "bg-emerald-500/15 text-emerald-500 border-emerald-500/20",
  },
];

interface Concept {
  icon: React.ReactNode;
  title: string;
  body: string;
}

const CONCEPTS: Concept[] = [
  {
    icon: <GitMerge className="h-4 w-4" />,
    title: "Pair",
    body: "A named, persistent association between a local folder on this device and the same folder on a paired peer. Pairs survive page reloads via IndexedDB.",
  },
  {
    icon: <Layers className="h-4 w-4" />,
    title: "Vault",
    body: "An encrypted at-rest copy of the synced folder stored in the browser's Origin Private File System (OPFS). The vault lets you browse received files offline.",
  },
  {
    icon: <ArrowRightLeft className="h-4 w-4" />,
    title: "Delta Engine",
    body: "The core diff/patch engine. It builds a content-addressed file manifest on each side, diffs them, then streams only the minimum set of byte-ranges needed.",
  },
  {
    icon: <Shield className="h-4 w-4" />,
    title: "Transport Security",
    body: "All data travels over WebRTC DataChannels which are DTLS-encrypted by the spec. No file bytes ever touch BDP's signalling server — it only brokers the initial handshake.",
  },
  {
    icon: <Zap className="h-4 w-4" />,
    title: "Trigger modes",
    body: "Sync can be triggered manually (Sync now button), automatically on reconnect, or scheduled. The engine debounces rapid triggers to avoid redundant diffs.",
  },
];

function PhaseTimeline() {
  return (
    <div className="relative pl-5">
      {/* Vertical line */}
      <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border/60" />

      <div className="space-y-3">
        {PHASES.map((phase, i) => (
          <div key={phase.name} className="relative flex gap-3">
            {/* Node */}
            <div className="absolute -left-5 flex items-start pt-0.5">
              <div
                className={cn(
                  "h-[18px] w-[18px] rounded-full border flex items-center justify-center shrink-0 text-[9px] font-bold",
                  phase.color,
                )}
              >
                {i + 1}
              </div>
            </div>

            <div className="min-w-0">
              <span className="text-xs font-semibold text-foreground">
                {phase.label}
              </span>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                {phase.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConceptGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {CONCEPTS.map((c) => (
        <div
          key={c.title}
          className="rounded-xl border border-border/40 bg-muted/30 px-3 py-2.5 space-y-1"
        >
          <div className="flex items-center gap-1.5 text-foreground/80">
            {c.icon}
            <span className="text-xs font-semibold">{c.title}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {c.body}
          </p>
        </div>
      ))}
    </div>
  );
}

type Section = "overview" | "phases" | "concepts";

export function BDPProtocolInfo() {
  const [open, setOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("overview");

  return (
    <div className="rounded-2xl border border-border/40 bg-background/60 overflow-hidden">
      {/* Trigger row */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors duration-150"
      >
        <div className="flex items-center gap-2.5">
          {/* BDP badge */}
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20">
            <span className="text-[10px] font-bold tracking-wider text-primary uppercase">
              BDP
            </span>
          </div>
          <div className="text-left">
            <p className="text-xs font-semibold text-foreground leading-none">
              Butterfly Delta Protocol
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Open sync protocol · v0.1
            </p>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-border/40">
          {/* Section tabs */}
          <div className="flex border-b border-border/30 px-4">
            {(["overview", "phases", "concepts"] as Section[]).map((s) => (
              <button
                key={s}
                onClick={() => setActiveSection(s)}
                className={cn(
                  "px-3 py-2 text-[11px] font-semibold capitalize transition-colors duration-150 border-b-2 -mb-px",
                  activeSection === s
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="px-4 py-4 space-y-4">
            {/* ── Overview ── */}
            {activeSection === "overview" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground">
                    BDP (Butterfly Delta Protocol)
                  </span>{" "}
                  is a lightweight, peer-to-peer folder-synchronisation
                  protocol built on top of WebRTC DataChannels. It transfers
                  only the <em>minimum byte delta</em> between two folder
                  states — no central server, no cloud storage, end-to-end
                  encrypted by the WebRTC spec.
                </p>

                {/* Key properties */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Transport", value: "WebRTC DataChannel" },
                    { label: "Encryption", value: "DTLS (built-in)" },
                    { label: "Chunk size", value: "256 KB" },
                    { label: "Diff algorithm", value: "Rolling hash" },
                    { label: "Storage", value: "OPFS + IndexedDB" },
                    { label: "Conflicts", value: "Manual resolution" },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      className="rounded-lg bg-muted/40 border border-border/30 px-2.5 py-1.5"
                    >
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                        {label}
                      </p>
                      <p className="text-xs font-semibold text-foreground mt-0.5">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  BDP is designed to be a <em>session-scoped</em> protocol —
                  both peers must be online simultaneously. There is no async
                  relay; if a peer is offline the sync is deferred until the
                  next connection.
                </p>
              </div>
            )}

            {/* ── Phases ── */}
            {activeSection === "phases" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Every sync session progresses through a fixed sequence of
                  phases. The engine transitions automatically; only conflict
                  resolution requires user input.
                </p>
                <PhaseTimeline />
              </div>
            )}

            {/* ── Concepts ── */}
            {activeSection === "concepts" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Core building blocks you'll encounter in the protocol and
                  source code.
                </p>
                <ConceptGrid />
              </div>
            )}

            {/* Footer links — always visible */}
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/30">
              <a
                href="https://github.com/a-saed/ButterflyDrop"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors duration-150"
              >
                <Github className="h-3.5 w-3.5" />
                View source
              </a>
              <a
                href="https://github.com/a-saed/ButterflyDrop/tree/main/src/bdp"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors duration-150"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                BDP source
              </a>
              <span className="ml-auto text-[10px] text-muted-foreground/50 font-mono">
                bdp@0.1.0
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
