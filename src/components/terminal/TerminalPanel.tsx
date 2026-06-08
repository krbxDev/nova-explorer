import { useEffect, useRef } from "react";
import { X, ExternalLink, Terminal } from "lucide-react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../../store";
import { fs } from "../../lib/invoke";
import "@xterm/xterm/css/xterm.css";

// Keys WebView2 consumes before xterm.js can see them
const TRAPPED_KEYS = new Set([
  " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "PageUp", "PageDown", "Home", "End", "Tab",
]);

export function TerminalPanel() {
  const { terminalOpen, toggleTerminal, activePaneId, panes } = useStore();
  const pane = panes[activePaneId];
  const path = pane?.path ?? "C:\\";

  const panelRef      = useRef<HTMLDivElement>(null);   // whole panel
  const containerRef  = useRef<HTMLDivElement>(null);   // xterm mount point
  const xtermRef      = useRef<XTerm | null>(null);
  const fitAddonRef   = useRef<FitAddon | null>(null);
  const spawnedPathRef = useRef<string | null>(null);
  const unlistenRefs   = useRef<Array<() => void>>([]);
  // Reliable focus tracking via xterm's own onFocus/onBlur events
  const xtermFocused  = useRef(false);

  const cleanupListeners = () => {
    unlistenRefs.current.forEach((fn) => fn());
    unlistenRefs.current = [];
  };

  // ── Mount / unmount the xterm instance ──────────────────────────────────
  useEffect(() => {
    if (!terminalOpen || !containerRef.current) return;

    const term = new XTerm({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: "#0d0d0f",
        foreground: "#e2e2e5",
        cursor: "#7c8cf8",
        selectionBackground: "#3b4166",
        black:         "#1a1a2e", brightBlack:   "#555570",
        red:           "#f87171", brightRed:     "#fc8181",
        green:         "#4ade80", brightGreen:   "#86efac",
        yellow:        "#fbbf24", brightYellow:  "#fcd34d",
        blue:          "#60a5fa", brightBlue:    "#93c5fd",
        magenta:       "#c084fc", brightMagenta: "#d8b4fe",
        cyan:          "#22d3ee", brightCyan:    "#67e8f9",
        white:         "#e2e2e5", brightWhite:   "#ffffff",
      },
      cursorBlink: true,
      scrollback: 5000,
    });

    const fit   = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(containerRef.current);
    fit.fit();
    term.focus();

    xtermRef.current    = term;
    fitAddonRef.current = fit;

    // Track xterm focus state reliably via its internal textarea element
    const onXtermFocus = () => { xtermFocused.current = true; };
    const onXtermBlur  = () => { xtermFocused.current = false; };
    term.textarea?.addEventListener("focus", onXtermFocus);
    term.textarea?.addEventListener("blur",  onXtermBlur);

    // ── Key trapping ────────────────────────────────────────────────────
    // WebView2 intercepts space/arrow keys at the C++ browser level before
    // JavaScript sees them — even with a focused textarea. Attaching to
    // window in capture phase + calling preventDefault() stops this.
    // We use xterm's own onFocus/onBlur to know when to intercept.
    const trapKeys = (e: KeyboardEvent) => {
      if (!xtermFocused.current) return;
      if (TRAPPED_KEYS.has(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", trapKeys, { capture: true });

    // Forward keystrokes → PTY stdin (xterm handles translation to ANSI)
    term.onData((data) => {
      invoke("pty_write", { data }).catch((err) => {
        term.writeln(`\r\n\x1b[31m[write error: ${err}]\x1b[0m`);
      });
    });

    // ── Focus management ──────────────────────────────────────────────
    // Click anywhere in the panel → re-focus xterm so input works immediately
    const onPanelMouseDown = (e: MouseEvent) => {
      // Don't steal focus from the Close / Pop-out buttons
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      term.focus();
    };
    panelRef.current?.addEventListener("mousedown", onPanelMouseDown);

    // Resize observer → fit + backend resize
    const ro = new ResizeObserver(() => {
      fit.fit();
      invoke("pty_resize", { cols: term.cols, rows: term.rows }).catch(() => {});
    });
    ro.observe(containerRef.current!);

    // Spawn PTY for the initial path
    spawnTerminal(term, fit, path);

    return () => {
      ro.disconnect();
      window.removeEventListener("keydown", trapKeys, { capture: true });
      panelRef.current?.removeEventListener("mousedown", onPanelMouseDown);
      term.textarea?.removeEventListener("focus", onXtermFocus);
      term.textarea?.removeEventListener("blur",  onXtermBlur);
      xtermFocused.current = false;
      cleanupListeners();
      invoke("pty_kill").catch(() => {});
      term.dispose();
      xtermRef.current    = null;
      fitAddonRef.current  = null;
      spawnedPathRef.current = null;
    };
  }, [terminalOpen]);

  // ── Re-spawn when the user navigates to a new folder ────────────────────
  useEffect(() => {
    if (!terminalOpen || !xtermRef.current || !fitAddonRef.current) return;
    if (spawnedPathRef.current === path) return;

    const term = xtermRef.current;
    const fit  = fitAddonRef.current;
    term.writeln(`\r\n\x1b[90m── ${path} ──\x1b[0m`);
    invoke("pty_kill").catch(() => {});
    spawnTerminal(term, fit, path);
  }, [path, terminalOpen]);

  // ── Helper ───────────────────────────────────────────────────────────────
  async function spawnTerminal(term: XTerm, fit: FitAddon, spawnPath: string) {
    cleanupListeners();
    fit.fit();
    spawnedPathRef.current = spawnPath;

    const u1 = await listen<string>("pty://output", (e) => {
      term.write(e.payload);
    });
    const u2 = await listen("pty://exit", () => {
      term.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
    });
    unlistenRefs.current = [u1, u2];

    try {
      await invoke("pty_spawn", { path: spawnPath, cols: term.cols, rows: term.rows });
    } catch (e) {
      term.writeln(`\r\n\x1b[31m[Failed to start terminal: ${e}]\x1b[0m`);
    }
  }

  if (!terminalOpen) return null;

  return (
    <div ref={panelRef} className="h-52 border-t border-[var(--border)] bg-[#0d0d0f] flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-8 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Terminal size={12} />
          <span className="font-mono text-[var(--text-muted)] truncate max-w-xs">{path}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => fs.openTerminalAt(path)}
            className="flex items-center gap-1 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] px-2 py-0.5 rounded hover:bg-[var(--accent-dim)] transition-colors"
            title="Pop out to Windows Terminal"
          >
            <ExternalLink size={11} /> Open external
          </button>
          <button
            onClick={toggleTerminal}
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* xterm.js */}
      <div ref={containerRef} className="flex-1 overflow-hidden px-1 pt-1" style={{ minHeight: 0 }} />
    </div>
  );
}
