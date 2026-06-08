import { useEffect } from "react";
import { useStore } from "../store";

export function useKeyboard() {
  const {
    activePaneId, navigateBack, navigateForward, navigateUp, refresh,
    openTab, closeTab, activeTabId, tabs, openPalette, selectAll, invertSelection,
    setViewMode, panes, setClipboard, pasteClipboard, clipboard,
    openQuickLook, toggleBulkRename, toggleDiskUsage,
    previewOpen, openPreview, closePreview, undo, redo,
  } = useStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA";

      // Navigation
      if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); navigateBack(activePaneId); }
      else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); navigateForward(activePaneId); }
      else if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); navigateUp(activePaneId); }
      else if (e.key === "F5") { e.preventDefault(); refresh(activePaneId); }

      // Tabs
      else if (!isInput && e.ctrlKey && e.key === "t") { e.preventDefault(); openTab(); }
      else if (!isInput && e.ctrlKey && e.key === "w") {
        e.preventDefault();
        if (tabs.length > 1) closeTab(activeTabId);
      }

      // Palette
      else if (!isInput && (e.ctrlKey && e.key === "p" || e.key === "F3")) {
        e.preventDefault(); openPalette();
      }

      // Selection
      else if (!isInput && e.ctrlKey && e.key === "a") { e.preventDefault(); selectAll(activePaneId); }
      else if (!isInput && e.ctrlKey && e.key === "i") { e.preventDefault(); invertSelection(activePaneId); }

      // View modes
      else if (!isInput && e.ctrlKey && e.key === "1") { setViewMode(activePaneId, "details"); }
      else if (!isInput && e.ctrlKey && e.key === "2") { setViewMode(activePaneId, "list"); }
      else if (!isInput && e.ctrlKey && e.key === "3") { setViewMode(activePaneId, "grid"); }

      // Clipboard
      else if (!isInput && e.ctrlKey && e.key === "c") {
        const sel = Array.from(panes[activePaneId]?.selection ?? []);
        if (sel.length) { e.preventDefault(); setClipboard(sel, "copy"); }
      }
      else if (!isInput && e.ctrlKey && e.key === "x") {
        const sel = Array.from(panes[activePaneId]?.selection ?? []);
        if (sel.length) { e.preventDefault(); setClipboard(sel, "cut"); }
      }
      else if (!isInput && e.ctrlKey && e.key === "v") {
        if (clipboard) { e.preventDefault(); pasteClipboard(activePaneId); }
      }

      // Undo / Redo
      else if (!isInput && e.ctrlKey && !e.shiftKey && e.key === "z") { e.preventDefault(); undo(); }
      else if (!isInput && e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redo(); }

      // New folder
      else if (!isInput && e.ctrlKey && e.shiftKey && e.key === "N") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("nova:newfolder", { detail: { paneId: activePaneId } }));
      }

      // Address bar focus
      else if (!isInput && (e.key === "F4" || (e.ctrlKey && e.key === "l"))) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("nova:focusaddress", { detail: { paneId: activePaneId } }));
      }

      // Search focus
      else if (!isInput && e.ctrlKey && e.key === "e") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("nova:focussearch", { detail: { paneId: activePaneId } }));
      }

      // Quick Look
      else if (!isInput && e.key === " ") {
        e.preventDefault();
        const pane = panes[activePaneId];
        const sel = Array.from(pane?.selection ?? []);
        if (sel.length === 1) openQuickLook(sel[0]);
        else if (pane?.entries.length) openQuickLook(pane.entries[0].path);
      }

      // Preview pane toggle
      else if (e.altKey && e.key === "p") {
        e.preventDefault();
        const pane = panes[activePaneId];
        if (previewOpen) closePreview();
        else if (pane?.path) openPreview(pane.path);
      }

      // Panels
      else if (!isInput && e.ctrlKey && e.shiftKey && e.key === "R") { e.preventDefault(); toggleBulkRename(); }
      else if (!isInput && e.ctrlKey && e.shiftKey && e.key === "D") { e.preventDefault(); toggleDiskUsage(); }

      // F11 fullscreen
      else if (e.key === "F11") {
        e.preventDefault();
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
      }

      // Properties
      else if (e.altKey && e.key === "Enter" && !isInput) {
        e.preventDefault();
        const sel = Array.from(panes[activePaneId]?.selection ?? []);
        if (sel.length === 1) useStore.getState().openProperties(sel[0]);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activePaneId, tabs, activeTabId, panes, clipboard, previewOpen]);
}
