import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Loader2, AlertCircle, Search, X, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { PaneSidebar } from "../sidebar/PaneSidebar";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../../store";
import { fs } from "../../lib/invoke";
import { DetailsView } from "./DetailsView";
import { GridView } from "./GridView";
import { ContextMenu } from "./ContextMenu";
import { BreadcrumbBar } from "../toolbar/BreadcrumbBar";
import type { FileEntry, ContextMenuAction } from "../../lib/types";
import { cn, ARCHIVE_EXTS, OPENER_EXTS, IMAGE_EXTS, TEXT_EXTS, VIDEO_EXTS, AUDIO_EXTS } from "../../lib/utils";

interface Props { paneId: string; showNavBar?: boolean; }
interface CtxMenuState { x: number; y: number; entry: FileEntry | null }

export function FilePane({ paneId, showNavBar }: Props) {
  const {
    panes, navigate, openPreview, setSelection, clearSelection, selectAll, invertSelection,
    addFavorite, refresh, setClipboard, pasteClipboard, clipboard,
    openQuickLook, activePaneId, setActivePane, toggleBulkRename, openProperties,
    pushUndo, previewOpen, closePreview, openPalette,
    navigateBack, navigateForward, navigateUp,
  } = useStore();
  const pane = panes[paneId];
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [localSearch, setLocalSearch] = useState("");
  const [dropTarget, setDropTarget] = useState(false);
  const [paneSidebarCollapsed, setPaneSidebarCollapsed] = useState(false);
  const isActive = activePaneId === paneId;
  const containerRef = useRef<HTMLDivElement>(null);

  // New folder state: path of folder being created inline (name shown in list)
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  // Clear filter bar whenever the folder changes
  useEffect(() => { setLocalSearch(""); }, [pane?.path]);

  // filterInputRef for Ctrl+E focus (declared here, wired up below after callbacks)
  const filterInputRef = useRef<HTMLInputElement>(null);

  // File watcher — auto-refresh on changes
  useEffect(() => {
    if (!pane?.path) return;
    const unlisten = listen<any>("fs-change", (event) => {
      if (event.payload?.path === pane.path) refresh(paneId);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [pane?.path, paneId]);

  const displayEntries = useMemo(() => {
    if (!pane) return [];
    const q = localSearch.toLowerCase();
    if (!q) return pane.entries;
    return pane.entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [pane?.entries, localSearch]);

  const handleOpen = useCallback(async (entry: FileEntry) => {
    if (entry.isDir) { navigate(paneId, entry.path); return; }
    const ext = entry.extension?.toLowerCase() ?? "";
    if (ARCHIVE_EXTS.has(ext) && !entry.path.includes("::")) { navigate(paneId, entry.path); return; }
    if (IMAGE_EXTS.has(ext) || TEXT_EXTS.has(ext) || VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext)) {
      openQuickLook(entry.path); return;
    }
    if (ext === "lnk") {
      try {
        const target = await fs.resolveShortcut(entry.path);
        if (target) { navigate(paneId, target); return; }
      } catch {}
    }
    try { await fs.openItem(entry.path); } catch {}
  }, [paneId, navigate, openQuickLook]);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    setCtxMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  // Right-click on empty space
  const handleEmptyContextMenu = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-row]")) return;
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, entry: null });
  }, []);

  // Start creating a new folder
  const startNewFolder = useCallback(() => {
    setNewFolderName("New Folder");
    setTimeout(() => {
      newFolderInputRef.current?.focus();
      newFolderInputRef.current?.select();
    }, 30);
  }, []);

  const commitNewFolder = useCallback(async () => {
    if (!newFolderName?.trim() || !pane) { setNewFolderName(null); return; }
    const newPath = pane.path.replace(/[\\/]+$/, "") + "\\" + newFolderName.trim();
    try {
      await fs.createDirectory(newPath);
      pushUndo({ id: Math.random().toString(36).slice(2), kind: "create", sources: [newPath], timestamp: Date.now() });
      await refresh(paneId);
      // Select the new folder
      setSelection(paneId, [newPath]);
    } catch (err) { console.error("New folder failed:", err); }
    setNewFolderName(null);
  }, [newFolderName, pane, paneId, refresh, setSelection, pushUndo]);

  // Listen for nova:newfolder (placed after startNewFolder is declared)
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ paneId?: string }>;
      if (!ce.detail?.paneId || ce.detail.paneId === paneId) startNewFolder();
    };
    window.addEventListener("nova:newfolder", handler);
    return () => window.removeEventListener("nova:newfolder", handler);
  }, [paneId, startNewFolder]);

  // Listen for nova:focussearch (Ctrl+E)
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ paneId?: string }>;
      if (!ce.detail?.paneId || ce.detail.paneId === paneId) {
        filterInputRef.current?.focus();
        filterInputRef.current?.select();
      }
    };
    window.addEventListener("nova:focussearch", handler);
    return () => window.removeEventListener("nova:focussearch", handler);
  }, [paneId]);

  const handleRenameCommit = useCallback(async (_entry: FileEntry, _newName: string) => {
    // refresh is called inside DetailsView
  }, []);

  // Drag & drop — drop onto this pane
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("nova/paths")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : "move";
      setDropTarget(true);
    }
  };
  const handleDragLeave = () => setDropTarget(false);
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDropTarget(false);
    const raw = e.dataTransfer.getData("nova/paths");
    if (!raw || !pane) return;
    try {
      const paths: string[] = JSON.parse(raw);
      if (e.ctrlKey) {
        await fs.copyItems(paths, pane.path);
        pushUndo({ id: Math.random().toString(36).slice(2), kind: "copy", sources: paths, dest: pane.path, timestamp: Date.now() });
      } else {
        await fs.moveItems(paths, pane.path);
        pushUndo({ id: Math.random().toString(36).slice(2), kind: "move", sources: paths, dest: pane.path, timestamp: Date.now() });
      }
      refresh(paneId);
    } catch (err) { console.error("Drop failed:", err); }
  };

  const buildContextActions = (entry: FileEntry | null): ContextMenuAction[] => {
    const sel = Array.from(pane?.selection ?? []);

    // ── Empty-space context menu ──────────────────────────────────────────
    if (!entry) {
      return [
        {
          id: "new-folder", label: "New Folder", shortcut: "Ctrl+Shift+N",
          action: startNewFolder,
        },
        { id: "sep-new", label: "", separator: true, action: () => {} },
        {
          id: "paste", label: "Paste", shortcut: "Ctrl+V",
          disabled: !clipboard,
          action: () => pasteClipboard(paneId),
        },
        { id: "sep-view", label: "", separator: true, action: () => {} },
        {
          id: "sort-name", label: "Sort by Name",
          action: () => useStore.getState().setSort(paneId, "name", true),
        },
        {
          id: "sort-modified", label: "Sort by Date modified",
          action: () => useStore.getState().setSort(paneId, "modified", false),
        },
        {
          id: "sort-type", label: "Sort by Type",
          action: () => useStore.getState().setSort(paneId, "type", true),
        },
        {
          id: "sort-size", label: "Sort by Size",
          action: () => useStore.getState().setSort(paneId, "size", false),
        },
        { id: "sep-end", label: "", separator: true, action: () => {} },
        {
          id: "refresh", label: "Refresh", shortcut: "F5",
          action: () => refresh(paneId),
        },
        {
          id: "properties-dir", label: "Properties",
          action: () => pane?.path && openProperties(pane.path),
        },
      ];
    }

    const targets = sel.length > 1 ? sel : [entry.path];
    const ext = entry.extension?.toLowerCase() ?? "";
    const isImage = IMAGE_EXTS.has(ext);
    const isArchive = ARCHIVE_EXTS.has(ext);
    const isExe = ["exe", "msi", "bat", "cmd"].includes(ext);

    const actions: ContextMenuAction[] = [
      {
        id: "open", label: entry.isDir ? "Open" : "Open",
        action: () => handleOpen(entry),
      },
    ];

    // Open with
    if (!entry.isDir) {
      actions.push({
        id: "open-with", label: "Open with…",
        action: async () => {
          const apps = await fs.getOpenWithApps(ext).catch(() => []);
          window.dispatchEvent(new CustomEvent("nova:openwith", { detail: { path: entry.path, ext, apps } }));
        },
      });
    }

    // Run as admin
    if (isExe) {
      actions.push({
        id: "run-admin", label: "Run as administrator",
        action: () => fs.runAsAdmin(entry.path).catch(() => {}),
      });
    }

    // Open file location for .lnk
    if (ext === "lnk") {
      actions.push({
        id: "open-location", label: "Open file location",
        action: async () => {
          const target = await fs.resolveShortcut(entry.path).catch(() => "");
          if (target) {
            const parent = target.replace(/[\\/][^\\/]+$/, "");
            navigate(paneId, parent || target);
          }
        },
      });
    }

    actions.push(
      {
        id: "open-new-tab", label: "Open in new tab",
        action: () => useStore.getState().openTab(entry.path),
      },
      {
        id: "preview", label: "Show in preview panel",
        action: () => openPreview(entry.path),
      },
      { id: "sep0", label: "", separator: true, action: () => {} },
      {
        id: "copy", label: "Copy", shortcut: "Ctrl+C",
        action: () => setClipboard(targets, "copy"),
      },
      {
        id: "cut", label: "Cut", shortcut: "Ctrl+X",
        action: () => setClipboard(targets, "cut"),
      },
      {
        id: "paste", label: "Paste", shortcut: "Ctrl+V",
        disabled: !clipboard,
        action: () => pasteClipboard(paneId),
      },
      { id: "sep1", label: "", separator: true, action: () => {} },
      {
        id: "copy-path", label: "Copy as path",
        action: () => navigator.clipboard.writeText(targets.join("\n")),
      },
      {
        id: "rename", label: "Rename", shortcut: "F2",
        disabled: targets.length > 1,
        action: () => {
          // Trigger inline rename via event
          window.dispatchEvent(new CustomEvent("nova:startrename", { detail: { path: entry.path } }));
        },
      },
      {
        id: "bulk-rename", label: "Bulk rename…",
        disabled: targets.length < 2,
        action: () => { setSelection(paneId, targets); toggleBulkRename(); },
      },
      { id: "sep2", label: "", separator: true, action: () => {} },
    );

    // Create shortcut
    if (!entry.path.endsWith(".lnk")) {
      actions.push({
        id: "create-shortcut", label: "Create shortcut",
        action: async () => {
          const shortcutPath = entry.path.replace(/[\\/][^\\/]+$/, "") + "\\" + entry.name + ".lnk";
          await fs.createShortcut(entry.path, shortcutPath).catch(() => {});
          refresh(paneId);
        },
      });
    }

    // Compress to ZIP
    actions.push({
      id: "compress-zip", label: `Compress ${targets.length > 1 ? targets.length + " items" : '"' + entry.name + '"'} to ZIP`,
      action: async () => {
        const defaultName = targets.length === 1 ? entry.name.replace(/\.[^.]+$/, "") : "Archive";
        const outputPath = (pane?.path ?? "") + "\\" + defaultName + ".zip";
        await fs.createZip(targets, outputPath).catch((e) => console.error(e));
        refresh(paneId);
      },
    });

    // Archive extraction
    if (isArchive) {
      actions.push(
        {
          id: "extract-here", label: "Extract here",
          action: async () => {
            const { archive } = await import("../../lib/invoke");
            await archive.extract(entry.path, pane?.path ?? "");
            refresh(paneId);
          },
        },
        {
          id: "extract-to", label: "Extract to…",
          action: async () => {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const dest = await open({ directory: true, title: "Extract to folder" }).catch(() => null);
            if (dest) {
              const { archive } = await import("../../lib/invoke");
              await archive.extract(entry.path, dest as string);
              refresh(paneId);
            }
          },
        },
      );
    }

    // Set as wallpaper for images
    if (isImage) {
      actions.push({
        id: "wallpaper", label: "Set as desktop background",
        action: () => fs.setWallpaper(entry.path).catch(() => {}),
      });
    }

    // Print
    if (!entry.isDir) {
      actions.push({
        id: "print", label: "Print",
        action: () => fs.printFile(entry.path).catch(() => {}),
      });
    }

    actions.push(
      { id: "sep-fav", label: "", separator: true, action: () => {} },
      {
        id: "fav", label: "Add to Favorites",
        action: () => addFavorite(entry.path, entry.name),
      },
    );

    if (entry.isDir) {
      actions.push(
        {
          id: "vscode", label: "Open in VS Code",
          action: () => fs.openInVscode(entry.path),
        },
        {
          id: "terminal", label: "Open terminal here",
          action: () => fs.openTerminalAt(entry.path),
        },
      );
    }

    actions.push(
      { id: "sep3", label: "", separator: true, action: () => {} },
      {
        id: "properties", label: "Properties", shortcut: "Alt+Enter",
        action: () => openProperties(entry.path),
      },
      { id: "sep4", label: "", separator: true, action: () => {} },
      {
        id: "delete", label: "Move to Recycle Bin", shortcut: "Del", danger: true,
        action: async () => {
          if (confirm(`Delete ${targets.length} item(s)?`)) {
            await fs.deleteItems(targets, true);
            refresh(paneId);
          }
        },
      },
      {
        id: "delete-perm", label: "Delete Permanently", shortcut: "Shift+Del", danger: true,
        action: async () => {
          if (confirm(`Permanently delete ${targets.length} item(s)? This cannot be undone.`)) {
            await fs.deleteItems(targets, false);
            refresh(paneId);
          }
        },
      },
    );

    return actions;
  };

  if (!pane) return null;

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col h-full bg-[var(--bg-base)] relative outline-none",
        dropTarget && "ring-2 ring-inset ring-[var(--accent)]",
        isActive && "ring-1 ring-inset ring-[var(--accent)]/20"
      )}
      onClick={() => { clearSelection(paneId); setActivePane(paneId); }}
      onContextMenu={handleEmptyContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onKeyDown={(e) => {
        if (e.key === "a" && e.ctrlKey) { e.preventDefault(); selectAll(paneId); }
        if (e.key === "i" && e.ctrlKey) { e.preventDefault(); invertSelection(paneId); }
        if (e.key === "F5") refresh(paneId);
        if (e.key === "N" && e.ctrlKey && e.shiftKey) { e.preventDefault(); startNewFolder(); }
        if (e.key === "c" && e.ctrlKey) {
          const sel = Array.from(pane.selection);
          if (sel.length) setClipboard(sel, "copy");
        }
        if (e.key === "x" && e.ctrlKey) {
          const sel = Array.from(pane.selection);
          if (sel.length) setClipboard(sel, "cut");
        }
        if (e.key === "v" && e.ctrlKey) pasteClipboard(paneId);
        if (e.key === " " && !e.ctrlKey) {
          e.preventDefault();
          const sel = Array.from(pane.selection);
          if (sel.length === 1) openQuickLook(sel[0]);
          else if (sel.length === 0 && displayEntries.length > 0) openQuickLook(displayEntries[0].path);
        }
        if (e.key === "Delete") {
          const sel = Array.from(pane.selection);
          if (sel.length && confirm(`Delete ${sel.length} item(s)?`)) {
            fs.deleteItems(sel, !e.shiftKey).then(() => refresh(paneId));
          }
        }
        if (e.key === "Enter" && e.altKey) {
          const sel = Array.from(pane.selection);
          if (sel.length === 1) openProperties(sel[0]);
        }
      }}
      tabIndex={0}
    >
      {/* Per-pane navigation bar (shown in split mode) */}
      {showNavBar && (
        <div
          className={cn(
            "flex items-center h-8 px-1 gap-0.5 border-b shrink-0",
            isActive
              ? "bg-[var(--bg-surface)] border-[var(--accent)]/40"
              : "bg-[var(--bg-base)] border-[var(--border)]"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => navigateBack(paneId)}
            disabled={pane.historyIndex <= 0}
            title="Back"
            className="h-6 w-6 flex items-center justify-center rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => navigateForward(paneId)}
            disabled={pane.historyIndex >= pane.history.length - 1}
            title="Forward"
            className="h-6 w-6 flex items-center justify-center rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronRight size={14} />
          </button>
          <button
            onClick={() => navigateUp(paneId)}
            title="Up"
            className="h-6 w-6 flex items-center justify-center rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <ChevronUp size={14} />
          </button>
          <div className="flex-1 overflow-hidden">
            <BreadcrumbBar paneId={paneId} />
          </div>
        </div>
      )}

      {/* Body: sidebar (split mode only) + content column */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {showNavBar && (
          <PaneSidebar
            paneId={paneId}
            collapsed={paneSidebarCollapsed}
            onToggle={() => setPaneSidebarCollapsed((v) => !v)}
          />
        )}

        {/* Content column */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">

      {/* Archive banner */}
      {pane.isArchive && pane.archivePath && (() => {
        // pane.path may be "archive.zip::subdir/" or just "archive.zip"
        const archiveFile = pane.archivePath.split(/[\\/]/).pop();
        const sepIdx = pane.path.indexOf("::");
        const subDir = sepIdx >= 0 ? pane.path.slice(sepIdx + 2).replace(/\/?$/, "") : "";
        const canGoUpInArchive = subDir.includes("/") || subDir.length > 0;

        const goUpInArchive = () => {
          if (!canGoUpInArchive) return;
          const parts = subDir.split("/").filter(Boolean);
          parts.pop();
          const newSubDir = parts.length > 0 ? parts.join("/") + "/" : "";
          navigate(paneId, newSubDir ? `${pane.archivePath}::${newSubDir}` : pane.archivePath!);
        };

        const leaveArchive = () => {
          const parts = pane.archivePath!.replace(/\\/g, "/").split("/");
          parts.pop();
          navigate(paneId, parts.join("\\") || pane.archivePath!);
        };

        return (
          <div className="flex items-center gap-2 px-3 h-7 bg-[var(--accent-dim)] border-b border-[var(--accent)]/30 shrink-0">
            <span className="text-[10px] text-[var(--accent)] font-medium truncate">
              📦 {archiveFile}{subDir ? ` › ${subDir}` : ""} — read-only
            </span>
            {canGoUpInArchive && (
              <button onClick={goUpInArchive} className="text-[10px] text-[var(--accent)] hover:underline shrink-0">
                ↑ Up
              </button>
            )}
            <button onClick={leaveArchive} className="text-[10px] text-[var(--accent)] hover:underline shrink-0 ml-auto">
              Leave archive
            </button>
          </div>
        );
      })()}

      {/* Local search / filter bar */}
      <div className="flex items-center h-8 px-2 border-b border-[var(--border)] gap-2 shrink-0">
        <Search size={12} className={localSearch ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
        <input
          ref={filterInputRef}
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Filter in folder…"
          className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Escape") setLocalSearch(""); }}
        />
        {localSearch && (
          <button onClick={() => setLocalSearch("")} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={12} />
          </button>
        )}
        <span className="text-[10px] text-[var(--text-muted)] shrink-0">
          {displayEntries.length} item{displayEntries.length !== 1 ? "s" : ""}
        </span>
        {clipboard && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-dim)] text-[var(--accent)] shrink-0">
            {clipboard.mode === "cut" ? "✂" : "📋"} {clipboard.paths.length}
          </span>
        )}
      </div>

      {/* Loading overlay */}
      {pane.loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-base)]/80 z-10 pointer-events-none">
          <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
        </div>
      )}

      {/* Error state */}
      {pane.error && !pane.loading && (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--danger)]">
          <AlertCircle size={32} />
          <p className="text-sm text-center px-8">{pane.error}</p>
        </div>
      )}

      {/* Empty state + new folder input */}
      {!pane.loading && !pane.error && displayEntries.length === 0 && !newFolderName && (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-muted)]">
          <span className="text-4xl">📁</span>
          <p className="text-sm">{localSearch ? "No matches found" : "This folder is empty"}</p>
          {!localSearch && (
            <button
              onClick={startNewFolder}
              className="text-[10px] text-[var(--accent)] hover:underline mt-1"
            >
              + New Folder
            </button>
          )}
        </div>
      )}

      {/* New folder inline creation (shown at top of list) */}
      {newFolderName !== null && (
        <div className="flex items-center h-[26px] px-2 gap-2 bg-[var(--bg-surface)] border-b border-[var(--border)] shrink-0 z-10">
          <span className="text-sm">📁</span>
          <input
            ref={newFolderInputRef}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") { e.preventDefault(); commitNewFolder(); }
              if (e.key === "Escape") { e.preventDefault(); setNewFolderName(null); }
            }}
            onBlur={commitNewFolder}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 text-xs bg-[var(--bg-elevated)] border border-[var(--accent)] rounded px-1 py-0 outline-none text-[var(--text-primary)]"
          />
        </div>
      )}

      {/* Drop overlay label */}
      {dropTarget && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <div className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg">
            Drop to move here (hold Ctrl to copy)
          </div>
        </div>
      )}

      {/* File list */}
      {!pane.error && (displayEntries.length > 0 || newFolderName !== null) && (
        <div className="flex-1 overflow-hidden" onClick={(e) => e.stopPropagation()}>
          {pane.viewMode === "grid" ? (
            <GridView paneId={paneId} entries={displayEntries} onOpen={handleOpen} onContextMenu={handleContextMenu} />
          ) : (
            <DetailsView
              paneId={paneId}
              entries={displayEntries}
              onOpen={handleOpen}
              onContextMenu={handleContextMenu}
              onRenameCommit={handleRenameCommit}
            />
          )}
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          actions={buildContextActions(ctxMenu.entry)}
          onClose={() => setCtxMenu(null)}
        />
      )}

        </div>{/* end content column */}
      </div>{/* end body flex row */}
    </div>
  );
}
