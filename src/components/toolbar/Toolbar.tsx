import {
  ChevronLeft, ChevronRight, ChevronUp, RotateCcw, LayoutList,
  LayoutGrid, AlignJustify, Eye, EyeOff, SplitSquareHorizontal,
  SplitSquareVertical, FileEdit, BarChart3, PanelRight,
  CheckSquare, Type, FolderPlus, Undo2, Redo2
} from "lucide-react";
import { useStore } from "../../store";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { cn } from "../../lib/utils";
import type { ViewMode } from "../../lib/types";

interface BtnProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

function Btn({ icon, label, onClick, disabled, active }: BtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "h-7 w-7 flex items-center justify-center rounded transition-colors",
        "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
        active && "bg-[var(--accent-dim)] text-[var(--accent)]",
        disabled && "opacity-30 pointer-events-none"
      )}
    >
      {icon}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-5 bg-[var(--border)] mx-0.5" />;
}

export function Toolbar() {
  const {
    activePaneId, panes, splitMode, previewOpen,
    navigateBack, navigateForward, navigateUp, refresh,
    setViewMode, setShowHidden, setSplit, openPreview, closePreview,
    toggleBulkRename, toggleDiskUsage,
    bulkRenameOpen, diskUsageOpen,
    checkboxMode, toggleCheckboxMode,
    showExtensions, toggleShowExtensions,
    undoStack, redoStack, undo, redo,
  } = useStore();

  const pane = panes[activePaneId];
  if (!pane) return null;

  const canBack = pane.historyIndex > 0;
  const canForward = pane.historyIndex < pane.history.length - 1;
  const viewMode = pane.viewMode;

  const viewModes: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
    { mode: "details", icon: <AlignJustify size={14} />, label: "Details (Ctrl+1)" },
    { mode: "list", icon: <LayoutList size={14} />, label: "List (Ctrl+2)" },
    { mode: "grid", icon: <LayoutGrid size={14} />, label: "Grid (Ctrl+3)" },
  ];

  return (
    <div className="flex items-center h-9 px-2 gap-0.5 bg-[var(--bg-surface)] border-b border-[var(--border)] shrink-0">
      <Btn icon={<ChevronLeft size={16} />} label="Back (Alt+Left)" onClick={() => navigateBack(activePaneId)} disabled={!canBack} />
      <Btn icon={<ChevronRight size={16} />} label="Forward (Alt+Right)" onClick={() => navigateForward(activePaneId)} disabled={!canForward} />
      <Btn icon={<ChevronUp size={16} />} label="Up (Alt+Up)" onClick={() => navigateUp(activePaneId)} />
      <Btn icon={<RotateCcw size={13} />} label="Refresh (F5)" onClick={() => refresh(activePaneId)} />

      <Sep />

      <Btn icon={<Undo2 size={14} />} label="Undo (Ctrl+Z)" onClick={undo} disabled={undoStack.length === 0} />
      <Btn icon={<Redo2 size={14} />} label="Redo (Ctrl+Y)" onClick={redo} disabled={redoStack.length === 0} />

      <Sep />

      <Btn
        icon={<FolderPlus size={14} />}
        label="New Folder (Ctrl+Shift+N)"
        onClick={() => window.dispatchEvent(new CustomEvent("nova:newfolder", { detail: { paneId: activePaneId } }))}
      />

      <Sep />
      <BreadcrumbBar paneId={activePaneId} />
      <Sep />

      {viewModes.map((v) => (
        <Btn key={v.mode} icon={v.icon} label={v.label}
          onClick={() => setViewMode(activePaneId, v.mode)} active={viewMode === v.mode} />
      ))}

      <Sep />

      <Btn
        icon={pane.showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
        label={pane.showHidden ? "Hide hidden files" : "Show hidden files"}
        onClick={() => setShowHidden(activePaneId, !pane.showHidden)}
        active={pane.showHidden}
      />
      <Btn
        icon={<Type size={14} />}
        label={showExtensions ? "Hide file extensions" : "Show file extensions"}
        onClick={toggleShowExtensions}
        active={showExtensions}
      />
      <Btn
        icon={<CheckSquare size={14} />}
        label="Toggle checkbox selection mode"
        onClick={toggleCheckboxMode}
        active={checkboxMode}
      />

      <Sep />

      <Btn icon={<SplitSquareHorizontal size={14} />} label="Split horizontal"
        onClick={() => setSplit(splitMode === "horizontal" ? "none" : "horizontal")}
        active={splitMode === "horizontal"} />
      <Btn icon={<SplitSquareVertical size={14} />} label="Split vertical"
        onClick={() => setSplit(splitMode === "vertical" ? "none" : "vertical")}
        active={splitMode === "vertical"} />

      <Sep />

      <Btn icon={<PanelRight size={14} />} label="Preview panel (Alt+P)"
        onClick={() => previewOpen ? closePreview() : openPreview(pane.path)}
        active={previewOpen} />
      <Btn icon={<FileEdit size={14} />} label="Bulk rename"
        onClick={toggleBulkRename} active={bulkRenameOpen} />
      <Btn icon={<BarChart3 size={14} />} label="Disk usage"
        onClick={toggleDiskUsage} active={diskUsageOpen} />
    </div>
  );
}
