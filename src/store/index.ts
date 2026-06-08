import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  PaneState, Tab, FileEntry, DriveInfo, Favorite, SortKey, ViewMode, CopyProgress,
  OperationRecord
} from "../lib/types";
import { fs, db, search, git, watcher } from "../lib/invoke";
import { generateId, pathParent } from "../lib/utils";

interface Clipboard { paths: string[]; mode: "copy" | "cut" }

interface NovaStore {
  panes: Record<string, PaneState>;
  activePaneId: string;
  splitMode: "none" | "horizontal" | "vertical";
  splitPaneIds: [string, string] | null; // stable order so panes don't swap on click
  tabs: Tab[];
  activeTabId: string;
  drives: DriveInfo[];
  favorites: Favorite[];
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  previewOpen: boolean;
  previewPath: string | null;
  paletteOpen: boolean;
  theme: "dark" | "light";
  globalSearchQuery: string;
  globalSearchResults: any[];
  globalSearching: boolean;
  clipboard: Clipboard | null;
  copyProgress: CopyProgress | null;
  quickLookPath: string | null;
  terminalOpen: boolean;
  bulkRenameOpen: boolean;
  diskUsageOpen: boolean;
  columnWidths: Record<string, number>;
  columnOrder: string[];
  // Undo/redo
  undoStack: OperationRecord[];
  redoStack: OperationRecord[];
  // UI state
  checkboxMode: boolean;
  showExtensions: boolean;
  showSystemFiles: boolean;
  propertiesPath: string | null;
  propertiesOpen: boolean;

  navigate: (paneId: string, path: string) => Promise<void>;
  invertSelection: (paneId: string) => void;
  pushUndo: (op: OperationRecord) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  toggleCheckboxMode: () => void;
  toggleShowExtensions: () => void;
  toggleShowSystemFiles: () => void;
  openProperties: (path: string) => void;
  closeProperties: () => void;
  setColumnOrder: (order: string[]) => void;
  navigateBack: (paneId: string) => void;
  navigateForward: (paneId: string) => void;
  navigateUp: (paneId: string) => void;
  refresh: (paneId: string) => Promise<void>;

  setSelection: (paneId: string, paths: string[]) => void;
  toggleSelection: (paneId: string, path: string) => void;
  clearSelection: (paneId: string) => void;
  selectAll: (paneId: string) => void;

  folderSortPrefs: Record<string, { key: SortKey; asc: boolean }>;
  setSort: (paneId: string, key: SortKey, asc: boolean) => void;
  setViewMode: (paneId: string, mode: ViewMode) => void;
  setShowHidden: (paneId: string, show: boolean) => void;
  setSearchQuery: (paneId: string, query: string) => void;

  openTab: (path?: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  pinTab: (tabId: string) => void;

  setSplit: (mode: "none" | "horizontal" | "vertical") => void;
  setActivePane: (paneId: string) => void;

  loadDrives: () => Promise<void>;
  loadFavorites: () => Promise<void>;
  addFavorite: (path: string, name: string, isSearch?: boolean, searchQuery?: string) => Promise<void>;
  removeFavorite: (path: string) => Promise<void>;
  setSidebarWidth: (w: number) => void;
  setSidebarCollapsed: (v: boolean) => void;

  openPreview: (path: string) => void;
  closePreview: () => void;
  openPalette: () => void;
  closePalette: () => void;

  setClipboard: (paths: string[], mode: "copy" | "cut") => void;
  pasteClipboard: (destPaneId: string) => Promise<void>;

  setCopyProgress: (p: CopyProgress | null) => void;
  openQuickLook: (path: string) => void;
  closeQuickLook: () => void;
  toggleTerminal: () => void;
  toggleBulkRename: () => void;
  toggleDiskUsage: () => void;

  runGlobalSearch: (query: string, root: string) => Promise<void>;
  loadColumnWidths: () => Promise<void>;
  setColumnWidth: (col: string, width: number) => void;
}

function createPane(path: string): PaneState {
  return {
    id: generateId(),
    path,
    history: [path],
    historyIndex: 0,
    entries: [],
    loading: false,
    error: null,
    selection: new Set(),
    sortKey: "name",
    sortAsc: true,
    showHidden: true,
    viewMode: "details",
    searchQuery: "",
    gitStatus: {},
    isGitRepo: false,
    gitBranch: null,
    isArchive: false,
    archivePath: null,
  };
}

const HOME = "C:\\Users";
const initialPane = createPane(HOME);
const initialTab: Tab = { id: generateId(), label: "Home", paneId: initialPane.id, pinned: false };

export const useStore = create<NovaStore>()(
  immer((set, get) => ({
    panes: { [initialPane.id]: initialPane },
    activePaneId: initialPane.id,
    splitMode: "none",
    splitPaneIds: null,
    tabs: [initialTab],
    activeTabId: initialTab.id,
    drives: [],
    favorites: [],
    sidebarWidth: 220,
    sidebarCollapsed: false,
    previewOpen: false,
    previewPath: null,
    paletteOpen: false,
    theme: "dark",
    globalSearchQuery: "",
    globalSearchResults: [],
    globalSearching: false,
    clipboard: null,
    copyProgress: null,
    quickLookPath: null,
    terminalOpen: false,
    bulkRenameOpen: false,
    diskUsageOpen: false,
    columnWidths: { name: 400, modified: 144, type: 96, size: 80 },
    columnOrder: ["name", "modified", "type", "size"],
    folderSortPrefs: {},
    undoStack: [],
    redoStack: [],
    checkboxMode: false,
    showExtensions: true,
    showSystemFiles: false,
    propertiesPath: null,
    propertiesOpen: false,

    navigate: async (paneId, path) => {
      const { ARCHIVE_EXTS } = await import("../lib/utils");
      const ext = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
      const isArchive = ARCHIVE_EXTS.has(ext) && !path.endsWith("\\") && !path.endsWith("/");

      // Determine sort for this folder:
      // 1. Saved per-folder pref (user previously changed sort here)
      // 2. Folder-specific default (Downloads → modified desc)
      // 3. Carry over pane's current sort
      const { folderSortPrefs, panes } = get();
      const basename = path.replace(/\\/g, "/").split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
      const FOLDER_DEFAULTS: Record<string, { key: SortKey; asc: boolean }> = {
        downloads: { key: "modified", asc: false },
      };
      const resolvedSort: { key: SortKey; asc: boolean } =
        folderSortPrefs[path] ??
        FOLDER_DEFAULTS[basename] ??
        { key: panes[paneId]?.sortKey ?? "name", asc: panes[paneId]?.sortAsc ?? true };

      set((s) => {
        const pane = s.panes[paneId];
        if (!pane) return;
        pane.loading = true;
        pane.error = null;
        pane.searchQuery = "";
        pane.sortKey = resolvedSort.key;
        pane.sortAsc = resolvedSort.asc;
        if (pane.history[pane.historyIndex] !== path) {
          pane.history = pane.history.slice(0, pane.historyIndex + 1);
          pane.history.push(path);
          pane.historyIndex = pane.history.length - 1;
        }
        pane.path = path;
        pane.selection = new Set();
        const tab = s.tabs.find((t) => t.paneId === paneId);
        if (tab) tab.label = path.split(/[\\/]/).pop() || path;
      });

      try {
        const pane = get().panes[paneId];
        let entries: FileEntry[] = [];

        // Helper: list entries from an archive, optionally scoped to a sub-directory
        const listArchive = async (archivePath: string, subDir: string = "") => {
          const { archive } = await import("../lib/invoke");
          const rawEntries = await archive.list(archivePath);
          const prefix = subDir ? subDir.replace(/\\/g, "/").replace(/\/?$/, "/") : "";
          const seen = new Set<string>();
          const result: FileEntry[] = rawEntries
            .filter((e: any) => {
              const ep = e.path.replace(/\\/g, "/");
              if (!ep.startsWith(prefix)) return false;
              const remaining = ep.slice(prefix.length).split("/").filter(Boolean);
              return remaining.length === 1 || (remaining.length === 0 && e.isDir);
            })
            .filter((e: any) => {
              const key = e.path.replace(/\\/g, "/").replace(/\/?$/, "");
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .map((e: any): FileEntry => {
              const namePart = e.name || e.path.replace(/\\/g, "/").replace(/\/?$/, "").split("/").pop() || e.path;
              const extPart = e.isDir ? null : namePart.includes(".") ? namePart.split(".").pop()!.toLowerCase() : null;
              return {
                name: namePart,
                path: `${archivePath}::${e.path}`,
                isDir: e.isDir,
                isSymlink: false,
                isHidden: false,
                size: e.size ?? 0,
                modified: e.modified ?? null,
                created: null,
                extension: extPart,
                readonly: true,
                iconType: e.isDir ? "folder" : extPart ?? "file",
              };
            });
          result.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          });
          return result;
        };

        // Case 1: navigating INTO a subfolder inside an already-open archive
        // path looks like: C:\foo\bar.zip::some/subdir/
        if (path.includes("::")) {
          const sepIdx = path.indexOf("::");
          const archivePath = path.slice(0, sepIdx);
          const subDir = path.slice(sepIdx + 2);
          try {
            const result = await listArchive(archivePath, subDir);
            set((s) => {
              const p = s.panes[paneId];
              if (p) { p.loading = false; p.isArchive = true; p.archivePath = archivePath; p.entries = result; p.error = null; }
            });
          } catch (err: any) {
            set((s) => { const p = s.panes[paneId]; if (p) { p.loading = false; p.error = String(err); } });
          }
          return;
        }

        // Case 2: opening an archive file from the filesystem
        if (isArchive) {
          try {
            const result = await listArchive(path);
            set((s) => {
              const p = s.panes[paneId];
              if (p) { p.loading = false; p.isArchive = true; p.archivePath = path; p.entries = result; p.error = null; }
            });
          } catch (err: any) {
            set((s) => {
              const p = s.panes[paneId];
              if (p) { p.loading = false; p.error = String(err); }
            });
          }
          return;
        }

        entries = await fs.listDirectory(path, pane?.showHidden ?? false, resolvedSort.key, resolvedSort.asc);
        // Filter system files if toggled off
        if (!get().showSystemFiles) {
          entries = entries.filter((e) => !e.isSystem);
        }

        // Git status (non-blocking, best-effort)
        git.getStatus(path).then((gs) => {
          set((s) => {
            const p = s.panes[paneId];
            if (p) {
              p.isGitRepo = gs.isRepo;
              p.gitBranch = gs.branch;
              p.gitStatus = gs.files;
              // Annotate entries
              p.entries = p.entries.map((e) => ({
                ...e,
                gitStatus: gs.files[e.path] ?? gs.files[e.path.replace(/\\/g, "/")] ?? undefined,
              }));
            }
          });
        }).catch(() => {});

        // Watch directory
        watcher.watchDirectory(path).catch(() => {});

        set((s) => {
          const p = s.panes[paneId];
          if (p) { p.entries = entries; p.loading = false; p.isArchive = false; p.archivePath = null; }
        });
        db.addHistory(path, false).catch(() => {});
      } catch (err: any) {
        set((s) => {
          const p = s.panes[paneId];
          if (p) { p.loading = false; p.error = String(err); }
        });
      }
    },

    navigateBack: (paneId) => {
      const pane = get().panes[paneId];
      if (!pane || pane.historyIndex <= 0) return;
      const newIndex = pane.historyIndex - 1;
      set((s) => { s.panes[paneId].historyIndex = newIndex; });
      get().navigate(paneId, pane.history[newIndex]);
    },

    navigateForward: (paneId) => {
      const pane = get().panes[paneId];
      if (!pane || pane.historyIndex >= pane.history.length - 1) return;
      const newIndex = pane.historyIndex + 1;
      set((s) => { s.panes[paneId].historyIndex = newIndex; });
      get().navigate(paneId, pane.history[newIndex]);
    },

    navigateUp: (paneId) => {
      const pane = get().panes[paneId];
      if (!pane) return;
      const parent = pathParent(pane.path);
      if (parent !== pane.path) get().navigate(paneId, parent);
    },

    refresh: async (paneId) => {
      const pane = get().panes[paneId];
      if (!pane) return;
      await get().navigate(paneId, pane.path);
    },

    setSelection: (paneId, paths) => {
      set((s) => { s.panes[paneId].selection = new Set(paths); });
    },
    toggleSelection: (paneId, path) => {
      set((s) => {
        const sel = s.panes[paneId].selection;
        if (sel.has(path)) sel.delete(path); else sel.add(path);
      });
    },
    clearSelection: (paneId) => {
      set((s) => { s.panes[paneId].selection = new Set(); });
    },
    selectAll: (paneId) => {
      set((s) => {
        s.panes[paneId].selection = new Set(s.panes[paneId].entries.map((e) => e.path));
      });
    },

    setSort: (paneId, key, asc) => {
      set((s) => {
        const p = s.panes[paneId];
        p.sortKey = key;
        p.sortAsc = asc;
        // Remember this sort for the folder so it persists across navigations
        if (p.path) s.folderSortPrefs[p.path] = { key, asc };
      });
      get().refresh(paneId);
    },
    setViewMode: (paneId, mode) => { set((s) => { s.panes[paneId].viewMode = mode; }); },
    setShowHidden: (paneId, show) => {
      set((s) => { s.panes[paneId].showHidden = show; });
      get().refresh(paneId);
    },
    setSearchQuery: (paneId, query) => { set((s) => { s.panes[paneId].searchQuery = query; }); },

    openTab: (path) => {
      const newPane = createPane(path ?? HOME);
      const newTab: Tab = { id: generateId(), label: path?.split(/[\\/]/).pop() || "New Tab", paneId: newPane.id, pinned: false };
      set((s) => {
        s.panes[newPane.id] = newPane;
        s.tabs.push(newTab);
        s.activeTabId = newTab.id;
        s.activePaneId = newPane.id;
      });
      get().navigate(newPane.id, path ?? HOME);
    },

    closeTab: (tabId) => {
      const { tabs } = get();
      if (tabs.length <= 1) return;
      const idx = tabs.findIndex((t) => t.id === tabId);
      const tab = tabs[idx];
      set((s) => {
        delete s.panes[tab.paneId];
        s.tabs.splice(idx, 1);
        if (s.activeTabId === tabId) {
          const newIdx = Math.max(0, idx - 1);
          s.activeTabId = s.tabs[newIdx]?.id ?? "";
          s.activePaneId = s.tabs[newIdx]?.paneId ?? "";
        }
      });
    },

    setActiveTab: (tabId) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (!tab) return;
      set((s) => { s.activeTabId = tabId; s.activePaneId = tab.paneId; });
    },

    pinTab: (tabId) => {
      set((s) => { const tab = s.tabs.find((t) => t.id === tabId); if (tab) tab.pinned = !tab.pinned; });
    },

    setSplit: (mode) => {
      set((s) => {
        s.splitMode = mode;
        if (mode === "none") {
          s.splitPaneIds = null;
          return;
        }
        // Create second pane if needed
        if (Object.keys(s.panes).length < 2) {
          const currentPane = s.panes[s.activePaneId];
          const newPane = createPane(currentPane?.path ?? HOME);
          s.panes[newPane.id] = newPane;
          s.splitPaneIds = [s.activePaneId, newPane.id];
        } else if (!s.splitPaneIds) {
          const ids = Object.keys(s.panes);
          s.splitPaneIds = [s.activePaneId, ids.find((id) => id !== s.activePaneId)!];
        }
      });
      if (mode !== "none") {
        const { splitPaneIds } = get();
        const secondId = splitPaneIds?.[1];
        if (secondId) {
          const secondPane = get().panes[secondId];
          if (secondPane) get().navigate(secondId, secondPane.path);
        }
      }
    },

    setActivePane: (paneId) => { set((s) => { s.activePaneId = paneId; }); },

    loadDrives: async () => {
      try { const drives = await fs.getDrives(); set((s) => { s.drives = drives; }); } catch {}
    },

    loadFavorites: async () => {
      try { const favorites = await db.getFavorites(); set((s) => { s.favorites = favorites; }); } catch {}
    },

    addFavorite: async (path, name, isSearch = false, searchQuery) => {
      await db.addFavorite(path, name, isSearch, searchQuery);
      await get().loadFavorites();
    },

    removeFavorite: async (path) => {
      await db.removeFavorite(path);
      await get().loadFavorites();
    },

    setSidebarWidth: (w) => set((s) => { s.sidebarWidth = w; }),
    setSidebarCollapsed: (v) => set((s) => { s.sidebarCollapsed = v; }),

    openPreview: (path) => set((s) => { s.previewOpen = true; s.previewPath = path; }),
    closePreview: () => set((s) => { s.previewOpen = false; s.previewPath = null; }),
    openPalette: () => set((s) => { s.paletteOpen = true; }),
    closePalette: () => set((s) => { s.paletteOpen = false; }),

    setClipboard: (paths, mode) => set((s) => { s.clipboard = { paths, mode }; }),

    pasteClipboard: async (destPaneId) => {
      const { clipboard, panes } = get();
      if (!clipboard) return;
      const destPane = panes[destPaneId];
      if (!destPane) return;
      const destDir = destPane.path;

      // Check for conflicts first — emit event for ConflictDialog to handle
      const conflicts = await fs.checkConflicts(clipboard.paths, destDir).catch(() => []);
      if (conflicts.length > 0) {
        // Dispatch a custom event so ConflictDialog can intercept
        window.dispatchEvent(new CustomEvent("nova:conflict", {
          detail: { conflicts, paths: clipboard.paths, destDir, mode: clipboard.mode, destPaneId }
        }));
        return;
      }

      get().setCopyProgress({ current: 0, total: clipboard.paths.length, file: "", done: false });
      try {
        if (clipboard.mode === "copy") {
          await fs.copyItems(clipboard.paths, destDir);
          get().pushUndo({ id: Math.random().toString(36).slice(2), kind: 'copy', sources: clipboard.paths, dest: destDir, timestamp: Date.now() });
        } else {
          await fs.moveItems(clipboard.paths, destDir);
          get().pushUndo({ id: Math.random().toString(36).slice(2), kind: 'move', sources: clipboard.paths, dest: destDir, timestamp: Date.now() });
          set((s) => { s.clipboard = null; });
        }
      } finally {
        get().setCopyProgress(null);
        await get().refresh(destPaneId);
      }
    },

    setCopyProgress: (p) => set((s) => { s.copyProgress = p; }),
    openQuickLook: (path) => set((s) => { s.quickLookPath = path; }),
    closeQuickLook: () => set((s) => { s.quickLookPath = null; }),
    toggleTerminal: () => set((s) => { s.terminalOpen = !s.terminalOpen; }),
    toggleBulkRename: () => set((s) => { s.bulkRenameOpen = !s.bulkRenameOpen; }),
    toggleDiskUsage: () => set((s) => { s.diskUsageOpen = !s.diskUsageOpen; }),

    runGlobalSearch: async (query, root) => {
      set((s) => { s.globalSearchQuery = query; s.globalSearching = true; });
      try {
        const results = await search.searchDirectory(root, query);
        set((s) => { s.globalSearchResults = results; s.globalSearching = false; });
      } catch {
        set((s) => { s.globalSearching = false; });
      }
    },

    invertSelection: (paneId) => {
      set((s) => {
        const p = s.panes[paneId];
        if (!p) return;
        const all = new Set(p.entries.map((e) => e.path));
        const newSel = new Set<string>();
        all.forEach((path) => { if (!p.selection.has(path)) newSel.add(path); });
        p.selection = newSel;
      });
    },

    pushUndo: (op) => {
      set((s) => {
        s.undoStack.push(op);
        if (s.undoStack.length > 50) s.undoStack.shift();
        s.redoStack = [];
      });
    },

    undo: async () => {
      const { undoStack } = get();
      if (undoStack.length === 0) return;
      const op = undoStack[undoStack.length - 1];
      set((s) => { s.undoStack.pop(); s.redoStack.push(op); });
      try {
        if (op.kind === 'rename' && op.sources[0] && op.newName && op.oldName) {
          const parent = op.sources[0].replace(/[\\/][^\\/]+$/, "");
          const currentPath = parent + "\\" + op.newName;
          await fs.renameItem(currentPath, op.oldName);
        } else if (op.kind === 'move' && op.dest) {
          const moved = op.sources.map(s => {
            const name = s.replace(/\\/g, "/").split("/").pop()!;
            return op.dest! + "\\" + name;
          });
          await fs.moveItems(moved, op.sources[0].replace(/[\\/][^\\/]+$/, ""));
        } else if (op.kind === 'copy' && op.dest) {
          const copied = op.sources.map(s => {
            const name = s.replace(/\\/g, "/").split("/").pop()!;
            return op.dest! + "\\" + name;
          });
          await fs.deleteItems(copied, false);
        } else if (op.kind === 'create' && op.sources[0]) {
          await fs.deleteItems(op.sources, false);
        }
        const { activePaneId } = get();
        await get().refresh(activePaneId);
      } catch { /* best-effort */ }
    },

    redo: async () => {
      const { redoStack } = get();
      if (redoStack.length === 0) return;
      const op = redoStack[redoStack.length - 1];
      set((s) => { s.redoStack.pop(); s.undoStack.push(op); });
      // Re-apply the operation
      try {
        if (op.kind === 'rename' && op.sources[0] && op.oldName && op.newName) {
          const parent = op.sources[0].replace(/[\\/][^\\/]+$/, "");
          await fs.renameItem(parent + "\\" + op.oldName, op.newName);
        } else if (op.kind === 'move' && op.dest) {
          await fs.moveItems(op.sources, op.dest);
        } else if (op.kind === 'copy' && op.dest) {
          await fs.copyItems(op.sources, op.dest);
        } else if (op.kind === 'create' && op.sources[0]) {
          await fs.createDirectory(op.sources[0]);
        }
        const { activePaneId } = get();
        await get().refresh(activePaneId);
      } catch { /* best-effort */ }
    },

    toggleCheckboxMode: () => set((s) => { s.checkboxMode = !s.checkboxMode; }),
    toggleShowExtensions: () => set((s) => { s.showExtensions = !s.showExtensions; }),
    toggleShowSystemFiles: () => {
      set((s) => { s.showSystemFiles = !s.showSystemFiles; });
      const { activePaneId } = get();
      get().refresh(activePaneId);
    },

    openProperties: (path) => set((s) => { s.propertiesPath = path; s.propertiesOpen = true; }),
    closeProperties: () => set((s) => { s.propertiesOpen = false; s.propertiesPath = null; }),
    setColumnOrder: (order) => set((s) => { s.columnOrder = order; }),

    loadColumnWidths: async () => {
      try {
        const widths = await db.getColumnWidths();
        set((s) => {
          for (const { col, width } of widths) s.columnWidths[col] = width;
        });
      } catch {}
    },

    setColumnWidth: (col, width) => {
      set((s) => { s.columnWidths[col] = width; });
      db.setColumnWidth(col, width).catch(() => {});
    },
  }))
);
