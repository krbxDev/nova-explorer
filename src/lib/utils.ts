import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

export function formatDate(iso: string | null, relative = false): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    if (relative) return formatDistanceToNow(d, { addSuffix: true });
    return format(d, "dd/MM/yyyy HH:mm:ss");
  } catch {
    return iso;
  }
}

export function getPathParts(path: string): { label: string; path: string }[] {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const result: { label: string; path: string }[] = [];

  let current = "";
  for (const part of parts) {
    // Windows drive like C:
    if (part.match(/^[A-Za-z]:$/)) {
      current = part + "\\";
      result.push({ label: part + "\\", path: current });
    } else {
      current = current.endsWith("\\") || current.endsWith("/")
        ? current + part
        : current + "\\" + part;
      result.push({ label: part, path: current });
    }
  }
  return result;
}

export function pathJoin(...parts: string[]): string {
  return parts.join("\\").replace(/\\+/g, "\\");
}

export function pathParent(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return path;
  parts.pop();
  const p = parts.join("\\");
  return p.endsWith(":") ? p + "\\" : p;
}

export function pathBasename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

export const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "ico", "tiff"]);
export const TEXT_EXTS = new Set(["txt", "md", "json", "ts", "tsx", "js", "jsx", "css", "html", "xml", "yaml", "yml", "toml", "ini", "cfg", "log", "sh", "bat", "ps1", "py", "rs", "go", "java", "c", "cpp", "h", "cs", "rb", "php", "sql"]);
export const VIDEO_EXTS = new Set(["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm"]);
export const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac"]);
export const ARCHIVE_EXTS = new Set(["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "cab", "iso"]);
export const OPENER_EXTS = new Set([
  "exe", "msi", "com", "cmd", "bat", "vbs", "js", "wsf", "reg",
  "lnk", "url", "pif", "scr", "gadget",
  "dll", "sys", "drv", "ocx",
  "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp",
  "pdf", "epub",
  "psd", "ai", "xd", "fig", "sketch",
  "blend", "fbx", "obj",
  "ttf", "otf", "woff", "woff2",
  "db", "sqlite", "accdb", "mdb",
]);

const TYPE_LABELS: Record<string, string> = {
  // Shortcuts & launchers
  lnk: "Shortcut", url: "Internet Shortcut", exe: "Application",
  msi: "Windows Installer", com: "MS-DOS Application",
  bat: "Batch File", cmd: "Command Script",
  vbs: "VBScript", wsf: "Windows Script",
  pif: "MS-DOS Shortcut", scr: "Screen Saver",
  // Archives
  zip: "Compressed Folder", rar: "RAR Archive", "7z": "7-Zip Archive",
  tar: "TAR Archive", gz: "GZip Archive", bz2: "BZip2 Archive",
  xz: "XZ Archive", zst: "Zstandard Archive", tgz: "Gzipped TAR",
  cab: "Cabinet File", iso: "Disc Image",
  // Documents
  pdf: "PDF Document",
  doc: "Word 97 Document", docx: "Word Document",
  xls: "Excel 97 Spreadsheet", xlsx: "Excel Spreadsheet",
  ppt: "PowerPoint 97 Presentation", pptx: "PowerPoint Presentation",
  odt: "OpenDocument Text", ods: "OpenDocument Spreadsheet", odp: "OpenDocument Presentation",
  // Images
  jpg: "JPEG Image", jpeg: "JPEG Image", png: "PNG Image", gif: "GIF Image",
  bmp: "Bitmap Image", webp: "WebP Image", svg: "SVG Image",
  ico: "Icon", tiff: "TIFF Image", tif: "TIFF Image",
  avif: "AVIF Image", heic: "HEIC Image",
  psd: "Photoshop Document", ai: "Illustrator File",
  raw: "RAW Image", cr2: "Canon RAW", nef: "Nikon RAW", arw: "Sony RAW",
  // Video
  mp4: "MP4 Video", mkv: "MKV Video", avi: "AVI Video", mov: "QuickTime Video",
  wmv: "Windows Media Video", flv: "Flash Video", webm: "WebM Video",
  m4v: "iTunes Video", mpg: "MPEG Video", mpeg: "MPEG Video",
  // Audio
  mp3: "MP3 Audio", wav: "WAV Audio", ogg: "OGG Audio", flac: "FLAC Audio",
  m4a: "MPEG-4 Audio", aac: "AAC Audio", wma: "Windows Media Audio",
  opus: "Opus Audio", aiff: "AIFF Audio",
  // Code
  ts: "TypeScript File", tsx: "TypeScript JSX", js: "JavaScript File", jsx: "JavaScript JSX",
  json: "JSON File", xml: "XML File", html: "HTML File", css: "CSS File",
  py: "Python Script", rs: "Rust Source", go: "Go Source", java: "Java Source",
  c: "C Source", cpp: "C++ Source", h: "C/C++ Header", cs: "C# Source",
  // Text
  txt: "Text Document", md: "Markdown Document", log: "Log File",
  csv: "CSV File", ini: "Configuration File", cfg: "Configuration File",
  toml: "TOML File", yaml: "YAML File", yml: "YAML File",
  // System
  dll: "Application Extension", sys: "System File",
  reg: "Registry File", inf: "Setup Information",
  // Fonts
  ttf: "TrueType Font", otf: "OpenType Font", woff: "Web Font", woff2: "Web Font",
  // Database
  db: "Database File", sqlite: "SQLite Database", accdb: "Access Database",
};

export function getFileTypeLabel(entry: { isDir: boolean; extension: string | null; name?: string }): string {
  if (entry.isDir) return "Folder";
  const ext = entry.extension?.toLowerCase() ?? "";
  return TYPE_LABELS[ext] ?? (ext ? `${ext.toUpperCase()} File` : "File");
}

export function getFileCategory(ext: string | null): string {
  if (!ext) return "file";
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.has(e)) return "image";
  if (TEXT_EXTS.has(e)) return "text";
  if (VIDEO_EXTS.has(e)) return "video";
  if (AUDIO_EXTS.has(e)) return "audio";
  if (ARCHIVE_EXTS.has(e)) return "archive";
  return "file";
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}
