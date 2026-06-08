use crate::fs::{entry_from_path, DriveInfo, FileEntry};
use std::path::Path;
use tauri::{command, AppHandle, Emitter};

#[command]
pub async fn list_directory(
    path: String,
    show_hidden: bool,
    sort_by: Option<String>,
    sort_asc: Option<bool>,
) -> Result<Vec<FileEntry>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let mut entries: Vec<FileEntry> = tokio::task::spawn_blocking(move || {
        let mut result = Vec::new();
        let read_dir = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
        for entry in read_dir.flatten() {
            let path = entry.path();
            if let Some(fe) = entry_from_path(&path) {
                if !show_hidden && fe.is_hidden {
                    continue;
                }
                result.push(fe);
            }
        }
        Ok::<Vec<FileEntry>, String>(result)
    })
    .await
    .map_err(|e| e.to_string())??;

    let sort_key = sort_by.as_deref().unwrap_or("name");
    let asc = sort_asc.unwrap_or(true);

    entries.sort_by(|a, b| {
        // Dirs-first only applies to name sort, matching File Explorer behaviour.
        // For date/size/type sorts everything is ordered by the chosen key so the
        // modified column reflects the true order top-to-bottom.
        let dirs_first = sort_key == "name" || sort_key == "type";
        if dirs_first && a.is_dir != b.is_dir {
            return if a.is_dir { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
        }

        let ord = match sort_key {
            "size" => {
                // Dirs have size 0; sort them after files when descending so they
                // don't all cluster at the top.
                if a.is_dir != b.is_dir {
                    return if a.is_dir { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Less };
                }
                a.size.cmp(&b.size)
            }
            "modified" => {
                // RFC-3339 strings are always UTC from our backend so lexicographic
                // order equals chronological order. None sorts last (treat as epoch 0).
                match (&a.modified, &b.modified) {
                    (None, None) => std::cmp::Ordering::Equal,
                    (None, Some(_)) => std::cmp::Ordering::Less,
                    (Some(_), None) => std::cmp::Ordering::Greater,
                    (Some(am), Some(bm)) => am.cmp(bm),
                }
            }
            "type" => {
                // Sort by extension, then name within the same extension.
                let ext_ord = a.extension.cmp(&b.extension);
                if ext_ord == std::cmp::Ordering::Equal {
                    a.name.to_lowercase().cmp(&b.name.to_lowercase())
                } else {
                    ext_ord
                }
            }
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        };
        if asc { ord } else { ord.reverse() }
    });

    Ok(entries)
}

#[command]
pub async fn get_file_info(path: String) -> Result<FileEntry, String> {
    let p = Path::new(&path);
    entry_from_path(p).ok_or_else(|| format!("Cannot read: {}", path))
}

#[command]
pub async fn read_text_file(path: String, max_bytes: Option<u64>) -> Result<String, String> {
    let limit = max_bytes.unwrap_or(1024 * 1024);
    let content = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    let bytes = &content[..content.len().min(limit as usize)];
    Ok(String::from_utf8_lossy(bytes).into_owned())
}

#[command]
pub async fn create_directory(path: String) -> Result<(), String> {
    tokio::fs::create_dir_all(&path).await.map_err(|e| e.to_string())
}

#[command]
pub async fn delete_items(paths: Vec<String>, to_trash: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        for path in &paths {
            let p = Path::new(path);
            if to_trash {
                #[cfg(windows)]
                trash_windows(path)?;
                #[cfg(not(windows))]
                {
                    if p.is_dir() {
                        std::fs::remove_dir_all(p).map_err(|e| e.to_string())?;
                    } else {
                        std::fs::remove_file(p).map_err(|e| e.to_string())?;
                    }
                }
            } else if p.is_dir() {
                std::fs::remove_dir_all(p).map_err(|e| e.to_string())?;
            } else {
                std::fs::remove_file(p).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn trash_windows(path: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;

    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(once(0)).chain(once(0)).collect();
    let mut op = winapi::um::shellapi::SHFILEOPSTRUCTW {
        hwnd: std::ptr::null_mut(),
        wFunc: winapi::um::shellapi::FO_DELETE as u32,
        pFrom: wide.as_ptr(),
        pTo: std::ptr::null(),
        fFlags: winapi::um::shellapi::FOF_ALLOWUNDO | winapi::um::shellapi::FOF_NOCONFIRMATION | winapi::um::shellapi::FOF_SILENT,
        fAnyOperationsAborted: 0,
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: std::ptr::null(),
    };
    let result = unsafe { winapi::um::shellapi::SHFileOperationW(&mut op) };
    if result != 0 {
        Err(format!("Recycle failed with code {}", result))
    } else {
        Ok(())
    }
}

#[command]
pub async fn rename_item(path: String, new_name: String) -> Result<String, String> {
    let p = Path::new(&path);
    let new_path = p.parent().ok_or("No parent")?.join(&new_name);
    tokio::fs::rename(&path, &new_path).await.map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().into_owned())
}

#[command]
pub async fn copy_items(
    sources: Vec<String>,
    dest_dir: String,
    app: AppHandle,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let total = sources.len();
        for (i, src) in sources.iter().enumerate() {
            let src_path = Path::new(src);
            let file_name = src_path.file_name().ok_or("No filename")?;
            let dest = Path::new(&dest_dir).join(file_name);

            let _ = app.emit("copy-progress", serde_json::json!({
                "current": i + 1,
                "total": total,
                "file": src,
                "done": false,
            }));

            if src_path.is_dir() {
                copy_dir_recursive(src_path, &dest, &app)?;
            } else {
                copy_file_with_progress(src_path, &dest, &app)?;
            }
        }
        let _ = app.emit("copy-progress", serde_json::json!({ "done": true, "total": total, "current": total }));
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn copy_file_with_progress(src: &Path, dst: &Path, app: &AppHandle) -> Result<(), String> {
    use std::io::{Read, Write};
    let mut reader = std::fs::File::open(src).map_err(|e| e.to_string())?;
    let mut writer = std::fs::File::create(dst).map_err(|e| e.to_string())?;
    let total = reader.metadata().map(|m| m.len()).unwrap_or(0);
    let mut buf = vec![0u8; 256 * 1024]; // 256KB chunks
    let mut copied = 0u64;

    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        writer.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        copied += n as u64;
        if total > 0 {
            let _ = app.emit("copy-file-progress", serde_json::json!({
                "file": src.to_string_lossy(),
                "bytes": copied,
                "total": total,
                "pct": (copied as f64 / total as f64 * 100.0) as u32,
            }));
        }
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path, app: &AppHandle) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let dst_entry = dst.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir_recursive(&entry.path(), &dst_entry, app)?;
        } else {
            copy_file_with_progress(&entry.path(), &dst_entry, app)?;
        }
    }
    Ok(())
}

#[command]
pub async fn move_items(sources: Vec<String>, dest_dir: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        for src in &sources {
            let src_path = Path::new(src);
            let file_name = src_path.file_name().ok_or("No filename")?;
            let dest = Path::new(&dest_dir).join(file_name);
            // Try rename first (same drive), fall back to copy+delete
            if std::fs::rename(src_path, &dest).is_err() {
                if src_path.is_dir() {
                    copy_dir_recursive_simple(src_path, &dest)?;
                    std::fs::remove_dir_all(src_path).map_err(|e| e.to_string())?;
                } else {
                    std::fs::copy(src_path, &dest).map_err(|e| e.to_string())?;
                    std::fs::remove_file(src_path).map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn copy_dir_recursive_simple(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let dst_entry = dst.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir_recursive_simple(&entry.path(), &dst_entry)?;
        } else {
            std::fs::copy(entry.path(), dst_entry).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[command]
pub async fn open_item(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| e.to_string())
}

#[command]
pub async fn open_in_vscode(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        std::process::Command::new("code")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open VS Code: {}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[command]
pub async fn open_terminal_at(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        // Try Windows Terminal first, fall back to PowerShell
        let wt = std::process::Command::new("wt")
            .args(["new-tab", "--startingDirectory", &path])
            .spawn();
        if wt.is_ok() { return Ok(()); }

        std::process::Command::new("powershell")
            .args(["-NoExit", "-Command", &format!("Set-Location '{}'", path)])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[command]
pub async fn get_drives() -> Result<Vec<DriveInfo>, String> {
    tokio::task::spawn_blocking(get_drives_impl)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn get_drives_impl() -> Result<Vec<DriveInfo>, String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    let mut buf = vec![0u16; 512];
    let len = unsafe { winapi::um::fileapi::GetLogicalDriveStringsW(512, buf.as_mut_ptr()) };
    if len == 0 { return Err("Failed to get drives".to_string()); }

    let mut drives = Vec::new();
    let mut start = 0;
    for i in 0..len as usize {
        if buf[i] == 0 {
            if i > start {
                let s = OsString::from_wide(&buf[start..i]).to_string_lossy().into_owned();
                if let Some(info) = get_drive_info(&s) { drives.push(info); }
            }
            start = i + 1;
        }
    }
    Ok(drives)
}

#[cfg(not(windows))]
fn get_drives_impl() -> Result<Vec<DriveInfo>, String> {
    Ok(vec![DriveInfo { name: "/".to_string(), path: "/".to_string(), label: None, drive_type: "Fixed".to_string(), total_space: 0, free_space: 0 }])
}

#[cfg(windows)]
fn get_drive_info(path: &str) -> Option<DriveInfo> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(std::iter::once(0)).collect();
    let drive_type = unsafe { winapi::um::fileapi::GetDriveTypeW(wide.as_ptr()) };
    let type_str = match drive_type {
        winapi::um::winbase::DRIVE_REMOVABLE => "Removable",
        winapi::um::winbase::DRIVE_FIXED => "Fixed",
        winapi::um::winbase::DRIVE_REMOTE => "Network",
        winapi::um::winbase::DRIVE_CDROM => "CD-ROM",
        _ => "Unknown",
    };
    let mut free_bytes: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut total_free: u64 = 0;
    unsafe {
        winapi::um::fileapi::GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_bytes as *mut u64 as *mut _,
            &mut total_bytes as *mut u64 as *mut _,
            &mut total_free as *mut u64 as *mut _,
        );
    }
    let name = path.trim_end_matches('\\').to_string();
    Some(DriveInfo {
        name: name.clone(), path: path.to_string(),
        label: get_volume_label(path),
        drive_type: type_str.to_string(),
        total_space: total_bytes, free_space: free_bytes,
    })
}

#[cfg(windows)]
fn get_volume_label(path: &str) -> Option<String> {
    use std::ffi::{OsStr, OsString};
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(std::iter::once(0)).collect();
    let mut label = vec![0u16; 261];
    let ok = unsafe {
        winapi::um::fileapi::GetVolumeInformationW(
            wide.as_ptr(), label.as_mut_ptr(), label.len() as u32,
            std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), 0,
        )
    };
    if ok != 0 {
        let end = label.iter().position(|&c| c == 0).unwrap_or(label.len());
        if end > 0 { return Some(OsString::from_wide(&label[..end]).to_string_lossy().into_owned()); }
    }
    None
}

#[command]
pub async fn get_recycle_bin_items() -> Result<Vec<FileEntry>, String> { Ok(vec![]) }

#[command]
pub async fn restore_from_recycle_bin(_path: String) -> Result<(), String> { Ok(()) }

#[command]
pub async fn get_icon_data(path: String, is_dir: bool, size: Option<u32>) -> Result<String, String> {
    let icon_size = size.unwrap_or(32);
    tokio::task::spawn_blocking(move || shell_icon_base64(&path, is_dir, icon_size))
        .await
        .map_err(|e| e.to_string())?
}

fn shell_icon_base64(path: &str, is_dir: bool, size: u32) -> Result<String, String> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_FLAGS_AND_ATTRIBUTES,
    };
    use windows::Win32::UI::Shell::{
        SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_SMALLICON,
        SHGFI_USEFILEATTRIBUTES,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL};

    unsafe {
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut sfi = std::mem::zeroed::<SHFILEINFOW>();

        let size_flag = if size <= 24 { SHGFI_SMALLICON } else { SHGFI_LARGEICON };

        let (file_attrs, flags) = if is_dir {
            (FILE_FLAGS_AND_ATTRIBUTES(FILE_ATTRIBUTE_DIRECTORY.0), SHGFI_ICON | size_flag)
        } else {
            (FILE_FLAGS_AND_ATTRIBUTES(FILE_ATTRIBUTE_NORMAL.0), SHGFI_ICON | size_flag | SHGFI_USEFILEATTRIBUTES)
        };

        let result = SHGetFileInfoW(
            windows::core::PCWSTR(wide.as_ptr()),
            file_attrs,
            Some(&mut sfi),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            flags,
        );

        if result == 0 || sfi.hIcon.is_invalid() {
            return Err(format!("SHGetFileInfo failed for: {path}"));
        }

        let s = size as i32;
        let null_hwnd = HWND(std::ptr::null_mut());
        let hdc_screen = GetDC(null_hwnd);
        if hdc_screen.is_invalid() {
            let _ = DestroyIcon(sfi.hIcon);
            return Err("GetDC failed".to_string());
        }

        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem.is_invalid() {
            ReleaseDC(null_hwnd, hdc_screen);
            let _ = DestroyIcon(sfi.hIcon);
            return Err("CreateCompatibleDC failed".to_string());
        }

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: s,
                biHeight: -s,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default()],
        };

        let mut pvbits: *mut std::ffi::c_void = std::ptr::null_mut();
        let hdib = match CreateDIBSection(hdc_mem, &bmi, DIB_RGB_COLORS, &mut pvbits, None, 0) {
            Ok(h) if !h.is_invalid() => h,
            _ => {
                let _ = DeleteDC(hdc_mem);
                ReleaseDC(null_hwnd, hdc_screen);
                let _ = DestroyIcon(sfi.hIcon);
                return Err("CreateDIBSection failed".to_string());
            }
        };

        let old_obj = SelectObject(hdc_mem, HGDIOBJ(hdib.0));
        let _ = DrawIconEx(hdc_mem, 0, 0, sfi.hIcon, s, s, 0, None, DI_NORMAL);

        let pixel_count = (size * size * 4) as usize;
        let pixels = std::slice::from_raw_parts(pvbits as *const u8, pixel_count);
        let mut buf = pixels.to_vec();

        SelectObject(hdc_mem, old_obj);
        let _ = DeleteObject(HGDIOBJ(hdib.0));
        DeleteDC(hdc_mem);
        ReleaseDC(null_hwnd, hdc_screen);
        let _ = DestroyIcon(sfi.hIcon);

        // Windows DIBs are BGRA — swap to RGBA for PNG encoding
        for chunk in buf.chunks_exact_mut(4) {
            chunk.swap(0, 2);
        }

        let img = image::RgbaImage::from_raw(size, size, buf)
            .ok_or_else(|| "Failed to construct RGBA image from icon data".to_string())?;

        let mut png = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;

        Ok(STANDARD.encode(&png))
    }
}

#[command]
pub async fn get_thumbnail(path: String, size: u32) -> Result<String, String> {
    let ext = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if !["jpg", "jpeg", "png", "gif", "bmp", "webp", "ico"].contains(&ext.as_str()) {
        return Ok(String::new());
    }

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let img = image::open(&path).map_err(|e| e.to_string())?;
        let thumb = img.thumbnail(size, size);
        let mut buf = Vec::new();
        thumb.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        Ok(format!("data:image/png;base64,{}", base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buf)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[command]
pub async fn bulk_rename(
    paths: Vec<String>,
    pattern: String,
    replacement: String,
    use_regex: bool,
    counter_start: Option<i64>,
) -> Result<Vec<(String, String)>, String> {
    tokio::task::spawn_blocking(move || {
        let re = if use_regex {
            Some(regex::Regex::new(&pattern).map_err(|e| e.to_string())?)
        } else {
            None
        };

        let mut results = Vec::new();
        let mut counter = counter_start.unwrap_or(1);

        for path in &paths {
            let p = Path::new(path);
            let name = p.file_name().ok_or("No name")?.to_string_lossy().into_owned();

            let new_name = if let Some(ref r) = re {
                // Replace counter placeholder {N} or {NNN}
                let repl = replacement.replace("{N}", &counter.to_string())
                    .replace("{NN}", &format!("{:02}", counter))
                    .replace("{NNN}", &format!("{:03}", counter))
                    .replace("{NNNN}", &format!("{:04}", counter));
                r.replace(&name, repl.as_str()).into_owned()
            } else {
                let repl = replacement.replace("{N}", &counter.to_string())
                    .replace("{NN}", &format!("{:02}", counter))
                    .replace("{NNN}", &format!("{:03}", counter))
                    .replace("{NNNN}", &format!("{:04}", counter));
                name.replace(&pattern, &repl)
            };

            if new_name != name {
                let new_path = p.parent().ok_or("No parent")?.join(&new_name);
                std::fs::rename(p, &new_path).map_err(|e| e.to_string())?;
                results.push((path.clone(), new_path.to_string_lossy().into_owned()));
            }
            counter += 1;
        }
        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[command]
pub async fn get_dir_size(path: String) -> Result<u64, String> {
    tokio::task::spawn_blocking(move || {
        let mut total = 0u64;
        for entry in walkdir::WalkDir::new(&path).follow_links(false) {
            if let Ok(e) = entry {
                if e.file_type().is_file() {
                    total += e.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }
        Ok(total)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsageEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub children: Vec<DiskUsageEntry>,
}

#[command]
pub async fn get_disk_usage(path: String, depth: Option<u32>) -> Result<DiskUsageEntry, String> {
    let max_depth = depth.unwrap_or(2);
    tokio::task::spawn_blocking(move || {
        build_disk_tree(&path, max_depth, 0)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn build_disk_tree(path: &str, max_depth: u32, current_depth: u32) -> Result<DiskUsageEntry, String> {
    let p = Path::new(path);
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or(path).to_string();

    if !p.is_dir() || current_depth >= max_depth {
        let size = if p.is_file() { std::fs::metadata(p).map(|m| m.len()).unwrap_or(0) } else {
            walkdir::WalkDir::new(p).into_iter().filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file())
                .map(|e| e.metadata().map(|m| m.len()).unwrap_or(0))
                .sum()
        };
        return Ok(DiskUsageEntry { name, path: path.to_string(), size, children: vec![] });
    }

    let mut children: Vec<DiskUsageEntry> = std::fs::read_dir(p)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|entry| {
            let child_path = entry.path().to_string_lossy().into_owned();
            build_disk_tree(&child_path, max_depth, current_depth + 1).ok()
        })
        .collect();

    children.sort_by(|a, b| b.size.cmp(&a.size));
    children.truncate(20); // top 20 per level

    let size: u64 = children.iter().map(|c| c.size).sum();
    Ok(DiskUsageEntry { name, path: path.to_string(), size, children })
}
