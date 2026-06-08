//! Embedded terminal via Windows ConPTY (CreatePseudoConsole).
//!
//! Implemented directly with the `windows` crate instead of a wrapper crate
//! so we control every CreateProcess flag and avoid the 0xc0000142
//! (STATUS_DLL_INIT_FAILED) that wrapper crates can trigger on some
//! Windows configurations due to bad handle-inheritance setup.

use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Console::{
    ClosePseudoConsole, CreatePseudoConsole, ResizePseudoConsole, COORD, HPCON,
};
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, InitializeProcThreadAttributeList,
    TerminateProcess, UpdateProcThreadAttribute, EXTENDED_STARTUPINFO_PRESENT,
    LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION, STARTUPINFOEXW, STARTUPINFOW,
};

// Not exposed as a named constant in windows 0.58
const PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE: usize = 0x00020016;

// ── Shared state ─────────────────────────────────────────────────────────────

struct PtyInner {
    /// Write end of the pipe that feeds keyboard input into the ConPTY.
    writer: std::fs::File,
    /// The ConPTY handle (needed for resize and close).
    hpc: HPCON,
    /// Child process handle (needed to kill the process).
    proc_handle: HANDLE,
}

// SAFETY: HANDLE / HPCON are raw pointers we manage carefully.
unsafe impl Send for PtyInner {}
unsafe impl Sync for PtyInner {}

pub struct PtyState(Arc<Mutex<Option<PtyInner>>>);

impl Default for PtyState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn pty_spawn(
    path: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    kill_inner(&mut state.0.lock().unwrap());
    unsafe { spawn_conpty(path, cols, rows, app, Arc::clone(&state.0)) }
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_write(data: String, state: State<'_, PtyState>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(ref mut inner) = *guard {
        inner.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(cols: u16, rows: u16, state: State<'_, PtyState>) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    if let Some(ref inner) = *guard {
        let size = COORD { X: cols as i16, Y: rows as i16 };
        unsafe { ResizePseudoConsole(inner.hpc, size).map_err(|e| e.to_string())? };
    }
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>) -> Result<(), String> {
    kill_inner(&mut state.0.lock().unwrap());
    Ok(())
}

// ── Internals ─────────────────────────────────────────────────────────────────

fn kill_inner(guard: &mut Option<PtyInner>) {
    if let Some(inner) = guard.take() {
        unsafe {
            let _ = TerminateProcess(inner.proc_handle, 1);
            CloseHandle(inner.proc_handle).ok();
            ClosePseudoConsole(inner.hpc);
            // `inner.writer` (File) is dropped here, closing pty_in_write
        }
    }
}

unsafe fn spawn_conpty(
    cwd: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
    state_arc: Arc<Mutex<Option<PtyInner>>>,
) -> windows::core::Result<()> {
    // ── 1. Pipe pair: keyboard input ──────────────────────────────────────────
    let mut pty_in_read  = HANDLE::default();
    let mut pty_in_write = HANDLE::default();
    CreatePipe(&mut pty_in_read, &mut pty_in_write, None, 0)?;

    // ── 2. Pipe pair: terminal output ─────────────────────────────────────────
    let mut pty_out_read  = HANDLE::default();
    let mut pty_out_write = HANDLE::default();
    CreatePipe(&mut pty_out_read, &mut pty_out_write, None, 0)?;

    // ── 3. CreatePseudoConsole ────────────────────────────────────────────────
    let size = COORD { X: cols as i16, Y: rows as i16 };
    let hpc = CreatePseudoConsole(size, pty_in_read, pty_out_write, 0)?;

    // ConPTY owns the slave ends now — close our copies.
    CloseHandle(pty_in_read).ok();
    CloseHandle(pty_out_write).ok();

    // ── 4. Process thread attribute list with the ConPTY handle ──────────────

    // First call: query required buffer size. Intentionally passes null and
    // ignores the error (Windows always returns INSUFFICIENT_BUFFER here).
    let mut attr_size: usize = 0;
    let _ = InitializeProcThreadAttributeList(
        LPPROC_THREAD_ATTRIBUTE_LIST(std::ptr::null_mut()),
        1, 0, &mut attr_size,
    );

    let mut attr_buf = vec![0u8; attr_size];
    let attr_list = LPPROC_THREAD_ATTRIBUTE_LIST(attr_buf.as_mut_ptr() as *mut _);
    InitializeProcThreadAttributeList(attr_list, 1, 0, &mut attr_size)?;

    UpdateProcThreadAttribute(
        attr_list,
        0,
        PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
        Some(hpc.0 as *mut _),
        std::mem::size_of::<HPCON>(),
        None,
        None,
    )?;

    // ── 5. Build STARTUPINFOEX ────────────────────────────────────────────────
    let si_ex = STARTUPINFOEXW {
        StartupInfo: STARTUPINFOW {
            cb: std::mem::size_of::<STARTUPINFOEXW>() as u32,
            ..Default::default()
        },
        lpAttributeList: attr_list,
    };

    // ── 6. CreateProcessW ─────────────────────────────────────────────────────
    let cmdline = "powershell.exe -NoLogo -NoExit";
    let mut cmd_wide: Vec<u16> = cmdline.encode_utf16().chain(std::iter::once(0)).collect();
    let cwd_wide: Vec<u16> = cwd.encode_utf16().chain(std::iter::once(0)).collect();

    let mut pi = PROCESS_INFORMATION::default();
    CreateProcessW(
        None,
        windows::core::PWSTR(cmd_wide.as_mut_ptr()),
        None,
        None,
        false,
        EXTENDED_STARTUPINFO_PRESENT,
        None,
        windows::core::PCWSTR(cwd_wide.as_ptr()),
        // Cast STARTUPINFOEXW → *const STARTUPINFOW (same leading bytes)
        &si_ex.StartupInfo as *const STARTUPINFOW,
        &mut pi,
    )?;

    CloseHandle(pi.hThread).ok();
    DeleteProcThreadAttributeList(attr_list);

    // ── 7. Store session ──────────────────────────────────────────────────────
    use std::os::windows::io::FromRawHandle;
    let writer = std::fs::File::from_raw_handle(pty_in_write.0 as *mut _);

    *state_arc.lock().unwrap() = Some(PtyInner {
        writer,
        hpc,
        proc_handle: pi.hProcess,
    });

    // ── 8. Reader thread: stream PTY output as events ─────────────────────────
    let mut reader = std::fs::File::from_raw_handle(pty_out_read.0 as *mut _);
    let state_clone = Arc::clone(&state_arc);

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit("pty://output", text);
                }
            }
        }
        kill_inner(&mut state_clone.lock().unwrap());
        let _ = app.emit("pty://exit", ());
    });

    Ok(())
}
