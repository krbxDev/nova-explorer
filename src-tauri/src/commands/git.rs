use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use tauri::command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub files: HashMap<String, String>, // path -> status (M, A, D, ?, !)
    pub root: Option<String>,
}

#[command]
pub async fn get_git_status(path: String) -> Result<GitStatus, String> {
    tokio::task::spawn_blocking(move || {
        get_git_status_impl(&path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn get_git_status_impl(path: &str) -> Result<GitStatus, String> {
    // Check if this is a git repo
    let root_output = {
        let mut cmd = Command::new("git");
        cmd.args(["-C", path, "rev-parse", "--show-toplevel"]);
        #[cfg(windows)] cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.output()
    };

    let root = match root_output {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        }
        _ => return Ok(GitStatus { is_repo: false, branch: None, files: HashMap::new(), root: None }),
    };

    // Get branch
    let branch = {
        let mut cmd = Command::new("git");
        cmd.args(["-C", path, "branch", "--show-current"]);
        #[cfg(windows)] cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.output().ok().and_then(|o| if o.status.success() {
            Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
        } else { None })
    };

    // Get status --porcelain
    let status_output = {
        let mut cmd = Command::new("git");
        cmd.args(["-C", &root, "status", "--porcelain", "-u"]);
        #[cfg(windows)] cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.output().map_err(|e| e.to_string())?
    };

    let mut files: HashMap<String, String> = HashMap::new();
    if status_output.status.success() {
        let stdout = String::from_utf8_lossy(&status_output.stdout);
        for line in stdout.lines() {
            if line.len() < 4 { continue; }
            let xy = &line[..2];
            let file_path = line[3..].trim();
            let status = if &xy[..1] != " " && &xy[..1] != "?" {
                xy[..1].to_string()
            } else if &xy[1..] != " " {
                xy[1..].to_string()
            } else {
                "?".to_string()
            };
            let full = format!("{}\\{}", root.replace('/', "\\"), file_path.replace('/', "\\"));
            files.insert(full, status);
        }
    }

    Ok(GitStatus {
        is_repo: true,
        branch,
        files,
        root: Some(root),
    })
}
