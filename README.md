# KRB Explorer

A fast, modern Windows file manager built with **Tauri 2 · Rust · React · TypeScript**.

---

## Features

- Multi-tab browsing with drag-to-reorder
- Horizontal / vertical split-pane view with independent navigation
- Embedded PowerShell terminal (ConPTY — no crashes)
- Instant fuzzy search across files and folders
- File preview panel (images, text, video, audio)
- Git status indicators on files and folders
- Archive browsing (zip, tar, gz) without extraction
- Bulk rename with regex and live preview
- Disk usage visualiser
- Drag-and-drop move / copy with conflict resolution
- Undo / redo for file operations
- Customisable columns, sort, and view modes (details · list · grid)
- Keyboard-first design — full shortcut coverage

---

## Download

**[⬇ Download KRB Explorer v1.0.45](https://github.com/krbxDev/krb-explorer/releases/latest)**

Or browse all releases on the [Releases page](https://github.com/krbxDev/krb-explorer/releases).

> **Note — Windows Defender / antivirus warning**
> KRB Explorer is not code-signed with a commercial certificate. Windows and some antivirus programs may flag the installer. See the sections below for how to allow it.

---

## Auto-Updates

KRB Explorer checks for updates automatically on startup. When a new version is available, a notification will appear in the app — click it to download and install the update in the background. You can also check manually via **Help → Check for Updates**.

---

## Windows SmartScreen

When running the installer you may see *"Windows protected your PC"*:

1. Click **More info**
2. Click **Run anyway**

---

## AVG Antivirus — Adding an Exception

If AVG blocks or quarantines the installer or the app itself, add an exception so it is left alone.

### Exclude the installer (one-time, before installing)

1. Open **AVG Antivirus** and go to **☰ Menu → Settings**
2. Select **General → Exceptions**
3. Click **Add Exception**
4. Choose **File** and browse to the downloaded `KRB.Explorer_x.x.x_x64-setup.exe`
5. Click **Add Exception** to confirm
6. Run the installer — AVG will leave it untouched

### Exclude the installed app (recommended, after installing)

1. Open **AVG Antivirus → ☰ Menu → Settings → General → Exceptions**
2. Click **Add Exception → Folder**
3. Browse to `C:\Users\<YourName>\AppData\Local\krb-explorer` (default install path)
4. Click **Add Exception**

> This ensures future auto-updates are not interrupted by AVG.

### If AVG already quarantined a file

1. Open **AVG → ☰ Menu → Quarantine**
2. Find the KRB Explorer entry, click the **⋮** menu beside it
3. Select **Restore and add exception**
4. Re-run the installer if the original install was incomplete

---

## Other Antivirus Programs

| Program | Steps |
|---------|-------|
| **Windows Defender** | Settings → Virus & threat protection → Manage settings → Add or remove exclusions → Add folder exclusion |
| **Malwarebytes** | Settings → Allow List → Add file or folder |
| **Kaspersky** | Settings → Threats and Exclusions → Manage Exclusions → Add |
| **Norton** | My Norton → Device Security → Settings → Antivirus → Scans and Risks → Items to Exclude from Scans |
| **McAfee** | Navigation → PC Security → Real-Time Scanning → Excluded Files → Add file |

---

## Building from Source

**Prerequisites:** Rust (stable), Node.js 18+, WebView2 runtime (pre-installed on Windows 10/11)

```bash
git clone https://github.com/krbxDev/krb-explorer.git
cd krb-explorer
npm install
npm run tauri build
```

The installer will be at `src-tauri/target/release/bundle/nsis/KRB Explorer_x.x.x_x64-setup.exe`.

---

## License

MIT
