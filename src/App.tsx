import { useEffect, useState } from "react";
import { TitleBar } from "./components/titlebar/TitleBar";
import { TabBar } from "./components/tabs/TabBar";
import { Toolbar } from "./components/toolbar/Toolbar";
import { Sidebar } from "./components/sidebar/Sidebar";
import { FilePane } from "./components/filepane/FilePane";
import { PreviewPanel } from "./components/preview/PreviewPanel";
import { CommandPalette } from "./components/palette/CommandPalette";
import { StatusBar } from "./components/statusbar/StatusBar";
import { QuickLook } from "./components/quicklook/QuickLook";
import { BulkRenameModal } from "./components/bulkrename/BulkRenameModal";
import { DiskUsageModal } from "./components/diskusage/DiskUsageModal";
import { CopyProgressBar } from "./components/progress/CopyProgressBar";
import { UpdateChecker } from "./components/updater/UpdateChecker";
import { PropertiesDialog } from "./components/filepane/PropertiesDialog";
import { ConflictDialog } from "./components/filepane/ConflictDialog";
import { OpenWithDialog } from "./components/filepane/OpenWithDialog";
import { useStore } from "./store";
import { useKeyboard } from "./hooks/useKeyboard";

export function App() {
  const {
    activePaneId, panes, splitMode, splitPaneIds, tabs, activeTabId,
    navigate, loadDrives, loadFavorites, previewOpen,
    sidebarCollapsed,
  } = useStore();

  const [updateOpen, setUpdateOpen] = useState(false);

  // Expose manual trigger globally so TitleBar / menu can call it
  useEffect(() => {
    (window as any).__openUpdateChecker = () => setUpdateOpen(true);
    return () => { delete (window as any).__openUpdateChecker; };
  }, []);

  useKeyboard();

  useEffect(() => {
    loadDrives();
    loadFavorites();
    const initialPaneId = Object.keys(panes)[0];
    // Support ?path=... so "Open in new window" can pass a starting directory
    const urlPath = new URLSearchParams(window.location.search).get("path");
    const startPath = urlPath ? decodeURIComponent(urlPath) : panes[initialPaneId]?.path;
    if (initialPaneId && startPath) navigate(initialPaneId, startPath);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const leftPaneId  = splitPaneIds?.[0] ?? activePaneId;
  const rightPaneId = splitPaneIds?.[1];

  return (
    <div className="flex flex-col h-full bg-[var(--bg-base)] overflow-hidden">
      <TitleBar />
      <TabBar />
      <Toolbar />

      <div className="flex flex-1 overflow-hidden">
        {!sidebarCollapsed && splitMode === "none" && <Sidebar />}

        <div className={`flex flex-1 overflow-hidden ${splitMode === "vertical" ? "flex-col" : "flex-row"}`}>
          {splitMode === "none" && (
            <div className="flex-1 overflow-hidden">
              {activeTab && <FilePane paneId={activeTab.paneId} />}
            </div>
          )}

          {splitMode !== "none" && (
            <>
              <div className="flex-1 overflow-hidden min-w-0 min-h-0">
                <FilePane paneId={leftPaneId} showNavBar />
              </div>
              <div className={splitMode === "horizontal" ? "w-px bg-[var(--border)]" : "h-px bg-[var(--border)]"} />
              {rightPaneId && (
                <div className="flex-1 overflow-hidden min-w-0 min-h-0">
                  <FilePane paneId={rightPaneId} showNavBar />
                </div>
              )}
            </>
          )}
        </div>

        {previewOpen && <PreviewPanel />}
      </div>

      <StatusBar />
      <CommandPalette />
      <QuickLook />
      <BulkRenameModal />
      <DiskUsageModal />
      <CopyProgressBar />

      {/* Global dialogs */}
      <PropertiesDialog />
      <ConflictDialog />
      <OpenWithDialog />

      {/* Silent startup check — only renders UI when update is available */}
      <UpdateChecker silent />

      {/* Manual check triggered from menu/titlebar */}
      {updateOpen && <UpdateChecker key={Date.now()} onClose={() => setUpdateOpen(false)} autoCheck />}
    </div>
  );
}

export default App;
