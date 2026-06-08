import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  PaneState, Tab, FileEntry, DriveInfo, Favorite, SortKey, ViewMode, CopyProgress
} from "../lib/types";
import { fs, db, search, git, watcher } from "../lib/invoke";
import { generateId, pathParent } from "../lib/utils";

interface Clipboard { paths: string[]; mode: "copy" | "cut" }

interface NovaStore {
  panes: Record<string, PaneState>;
  activePaneId: string;
  splitMode: "none" | "horizontal" | "vertical";
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

  navigate: (paneId: string, path: string) => Promise<void>;
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
    folderSortPrefs: {},

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

        if (isArchive) {
          try {
            const { archive } = await import("../lib/invoke");
            const rawEntries = await archive.list(path);
            // Show only top-level entries (no nested paths)
            const seen = new Set<string>();
            const entries: FileEntry[] = rawEntries
              .filter((e: any) => {
                const parts = e.path.replace(/\\/g, "/").split("/").filter(Boolean);
                return parts.length <= 1;
              })
              .filter((e: any) => {
                const key = e.path.replace(/\\/g, "/").replace(/\/$/, "");
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              })
              .map((e: any): FileEntry => {
                const namePart = e.name || e.path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || e.path;
                const extPart = e.isDir ? null : namePart.includes(".") ? namePart.split(".").pop()!.toLowerCase() : null;
                return {
                  name: namePart,
                  path: `${path}::${e.path}`,
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
            entries.sort((a, b) => {
              if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
              return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            });
            set((s) => {
              const p = s.panes[paneId];
              if (p) { p.loading = false; p.isArchive = true; p.archivePath = path; p.entries = entries; p.error = null; }
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
        if (mode !== "none" && Object.keys(s.panes).length < 2) {
          const currentPane = s.panes[s.activePaneId];
          const newPane = createPane(currentPane?.path ?? HOME);
          s.panes[newPane.id] = newPane;
        }
      });
      if (mode !== "none") {
        const panes = Object.values(get().panes);
        const secondPane = panes.find((p) => p.id !== get().activePaneId);
        if (secondPane) get().navigate(secondPane.id, secondPane.path);
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
      get().setCopyProgress({ current: 0, total: clipboard.paths.length, file: "", done: false });
      try {
        if (clipboard.mode === "copy") {
          await fs.copyItems(clipboard.paths, destDir);
        } else {
          await fs.moveItems(clipboard.paths, destDir);
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
