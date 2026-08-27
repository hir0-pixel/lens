// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

struct PtySession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    generation: u32,
}

#[derive(Default)]
struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnTerminalArgs {
    session_id: String,
    cwd: String,
    shell: String,
    generation: u32,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResizeTerminalArgs {
    session_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloseTerminalArgs {
    session_id: String,
    generation: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalData {
    session_id: String,
    data: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectTreeEntry {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<ProjectTreeEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitProjectChange {
    path: String,
    status: String,
    additions: u32,
    deletions: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitProjectDiff {
    patch: String,
}

const MAX_PROJECT_TREE_DEPTH: usize = 8;
const MAX_PROJECT_TREE_ENTRIES: usize = 5_000;

fn should_skip_project_entry(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | "build" | "coverage" | ".next"
    )
}

fn read_project_tree(
    path: &Path,
    depth: usize,
    remaining: &mut usize,
) -> Result<ProjectTreeEntry, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    let is_dir = metadata.is_dir();
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_else(|| path.to_str().unwrap_or("Project"))
        .to_string();

    let mut children = Vec::new();
    if is_dir && depth < MAX_PROJECT_TREE_DEPTH && *remaining > 0 {
        let mut entries: Vec<(String, PathBuf, bool)> = std::fs::read_dir(path)
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let entry_name = entry.file_name().to_string_lossy().into_owned();
                if should_skip_project_entry(&entry_name) {
                    return None;
                }
                let is_directory = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
                Some((entry_name, entry.path(), is_directory))
            })
            .collect();

        entries.sort_by(|left, right| {
            right
                .2
                .cmp(&left.2)
                .then_with(|| left.0.to_lowercase().cmp(&right.0.to_lowercase()))
        });

        for (_, entry_path, _) in entries {
            if *remaining == 0 {
                break;
            }
            *remaining -= 1;
            if let Ok(entry) = read_project_tree(&entry_path, depth + 1, remaining) {
                children.push(entry);
            }
        }
    }

    Ok(ProjectTreeEntry {
        name,
        path: path.to_string_lossy().into_owned(),
        is_dir,
        children,
    })
}

#[tauri::command]
fn project_file_tree(root: String) -> Result<ProjectTreeEntry, String> {
    let root_path = PathBuf::from(root);
    if !root_path.is_dir() {
        return Err("The selected project folder is unavailable.".to_string());
    }
    let mut remaining = MAX_PROJECT_TREE_ENTRIES;
    read_project_tree(&root_path, 0, &mut remaining)
}

fn git_change_status(index_status: char, worktree_status: char) -> &'static str {
    if index_status == '?' && worktree_status == '?' {
        "untracked"
    } else if index_status == 'U'
        || worktree_status == 'U'
        || (index_status == 'A' && worktree_status == 'A')
        || (index_status == 'D' && worktree_status == 'D')
    {
        "conflict"
    } else if index_status == 'A' || worktree_status == 'A' {
        "added"
    } else if index_status == 'D' || worktree_status == 'D' {
        "deleted"
    } else if index_status == 'R' || worktree_status == 'R' || index_status == 'C' || worktree_status == 'C' {
        "renamed"
    } else {
        "modified"
    }
}

fn count_file_lines(path: &Path) -> u32 {
    let Ok(contents) = std::fs::read(path) else {
        return 0;
    };
    if contents.is_empty() {
        return 0;
    }
    let lines = contents.iter().filter(|byte| **byte == b'\n').count() as u32;
    if contents.last() == Some(&b'\n') { lines } else { lines + 1 }
}

/// Resolve the repository worktree because Git porcelain paths are emitted relative
/// to it, even when Lens was opened on a nested project folder.
fn git_worktree_root(root: &Path) -> Result<PathBuf, String> {
    let output = Command::new("git")
        .current_dir(root)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|error| format!("Unable to locate the Git worktree: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let worktree = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let path = PathBuf::from(worktree);
    if path.is_dir() {
        Ok(path)
    } else {
        Err("The selected project is not inside an available Git worktree.".to_string())
    }
}

#[tauri::command]
fn git_project_changes(root: String) -> Result<Vec<GitProjectChange>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("The selected project folder is unavailable.".to_string());
    }

    let worktree_root = git_worktree_root(&root_path)?;
    let status_output = Command::new("git")
        .current_dir(&worktree_root)
        .args(["status", "--porcelain=v1", "-z", "--untracked-files=all"])
        .output()
        .map_err(|error| format!("Unable to run Git: {error}"))?;
    if !status_output.status.success() {
        return Err(String::from_utf8_lossy(&status_output.stderr).trim().to_string());
    }

    let mut diff_stats: HashMap<String, (u32, u32)> = HashMap::new();
    let diff_output = Command::new("git")
        .current_dir(&worktree_root)
        .args(["diff", "--numstat", "HEAD", "--"])
        .output()
        .map_err(|error| format!("Unable to read Git diff: {error}"))?;
    if diff_output.status.success() {
        for line in String::from_utf8_lossy(&diff_output.stdout).lines() {
            let mut fields = line.splitn(3, '\t');
            let additions = fields.next().and_then(|value| value.parse().ok()).unwrap_or(0);
            let deletions = fields.next().and_then(|value| value.parse().ok()).unwrap_or(0);
            if let Some(path) = fields.next() {
                diff_stats.insert(path.to_string(), (additions, deletions));
            }
        }
    }

    let records: Vec<&[u8]> = status_output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .collect();
    let mut changes = Vec::new();
    let mut index = 0;
    while index < records.len() {
        let record = records[index];
        if record.len() < 4 {
            index += 1;
            continue;
        }
        let index_status = record[0] as char;
        let worktree_status = record[1] as char;
        let path = String::from_utf8_lossy(&record[3..]).into_owned();
        let status = git_change_status(index_status, worktree_status);
        let (mut additions, deletions) = diff_stats.get(&path).copied().unwrap_or((0, 0));
        if status == "untracked" {
            additions = count_file_lines(&worktree_root.join(&path));
        }

        // A mode-only, binary, or empty-file status has no textual patch to review.
        // Keep this list aligned with the diff viewer: only show files with line changes.
        if additions > 0 || deletions > 0 {
            changes.push(GitProjectChange {
                path,
                status: status.to_string(),
                additions,
                deletions,
            });
        }

        // Rename/copy records contain an additional NUL-delimited original path.
        index += if matches!(index_status, 'R' | 'C') || matches!(worktree_status, 'R' | 'C') {
            2
        } else {
            1
        };
    }
    changes.sort_by(|left, right| left.path.to_lowercase().cmp(&right.path.to_lowercase()));
    Ok(changes)
}

#[tauri::command]
fn git_project_diff(root: String, path: String) -> Result<GitProjectDiff, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("The selected project folder is unavailable.".to_string());
    }

    let worktree_root = git_worktree_root(&root_path)?;
    // Porcelain status paths are relative to the Git worktree, not necessarily to
    // the Lens project folder. Run the diff from that same root.
    let tracked_diff = Command::new("git")
        .current_dir(&worktree_root)
        .args(["diff", "--no-ext-diff", "--unified=3", "HEAD", "--", &path])
        .output()
        .map_err(|error| format!("Unable to read Git diff: {error}"))?;
    if tracked_diff.status.success() && !tracked_diff.stdout.is_empty() {
        return Ok(GitProjectDiff {
            patch: String::from_utf8_lossy(&tracked_diff.stdout).into_owned(),
        });
    }

    // Untracked files are absent from `git diff HEAD`; compare them to /dev/null.
    let absolute_path = worktree_root.join(&path);
    if absolute_path.is_file() {
        let untracked_diff = Command::new("git")
            .args([
                "diff",
                "--no-index",
                "--no-ext-diff",
                "--unified=3",
                "--",
                "/dev/null",
                absolute_path.to_string_lossy().as_ref(),
            ])
            .output()
            .map_err(|error| format!("Unable to read untracked file diff: {error}"))?;
        // `git diff --no-index` returns 1 when differences are present.
        if untracked_diff.status.success() || untracked_diff.status.code() == Some(1) {
            return Ok(GitProjectDiff {
                patch: String::from_utf8_lossy(&untracked_diff.stdout).into_owned(),
            });
        }
    }

    Ok(GitProjectDiff { patch: String::new() })
}

fn clamp_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(20, 400),
        rows: rows.clamp(5, 200),
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[tauri::command]
fn terminal_spawn(
    app: AppHandle,
    manager: State<'_, PtyManager>,
    args: SpawnTerminalArgs,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(clamp_size(args.cols, args.rows)).map_err(|e| e.to_string())?;

    let program = if cfg!(windows) {
        if args.shell == "cmd" { "cmd.exe" } else { "powershell.exe" }
    } else if args.shell == "zsh" {
        "zsh"
    } else {
        "bash"
    };
    let mut command = CommandBuilder::new(program);
    if cfg!(windows) && args.shell != "cmd" {
        command.arg("-NoLogo");
    }
    if !args.cwd.is_empty() && args.cwd != "~" {
        command.cwd(&args.cwd);
    } else if cfg!(windows) {
        if let Ok(home) = std::env::var("USERPROFILE") {
            command.cwd(home);
        }
    }

    let child = Arc::new(Mutex::new(
        pair.slave.spawn_command(command).map_err(|e| e.to_string())?,
    ));
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = Arc::new(Mutex::new(pair.master.take_writer().map_err(|e| e.to_string())?));
    let master = Arc::new(Mutex::new(pair.master));
    let previous = manager.sessions.lock().map_err(|e| e.to_string())?.insert(
        args.session_id.clone(),
        PtySession { writer, master, child, generation: args.generation },
    );
    if let Some(previous) = previous {
        let _ = previous.child.lock().map_err(|e| e.to_string())?.kill();
    }

    let session_id = args.session_id;
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    let data = String::from_utf8_lossy(&buffer[..count]).into_owned();
                    let _ = app.emit("terminal://data", TerminalData {
                        session_id: session_id.clone(),
                        data,
                    });
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn terminal_close(manager: State<'_, PtyManager>, args: CloseTerminalArgs) -> Result<(), String> {
    let mut sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    let should_close = sessions
        .get(&args.session_id)
        .is_some_and(|session| session.generation == args.generation);
    let session = if should_close {
        sessions.remove(&args.session_id)
    } else {
        None
    };

    if let Some(session) = session {
        session.child.lock().map_err(|e| e.to_string())?
            .kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn terminal_write(
    manager: State<'_, PtyManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&session_id).ok_or("Terminal session not found")?;
    let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
    writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn terminal_resize(
    manager: State<'_, PtyManager>,
    args: ResizeTerminalArgs,
) -> Result<(), String> {
    let sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&args.session_id).ok_or("Terminal session not found")?;
    let result = session
        .master
        .lock()
        .map_err(|e| e.to_string())?
        .resize(clamp_size(args.cols, args.rows))
        .map_err(|e| e.to_string());
    result
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn git_clone(url: String, dest: String) -> Result<String, String> {
    let dest_path = Path::new(&dest);
    if dest_path.exists() {
        return Err(format!("Destination already exists: {dest}"));
    }
    let output = Command::new("git")
        .args(["clone", &url, &dest])
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;
    if output.status.success() {
        Ok(dest)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(stderr.trim().to_string())
    }
}

#[tauri::command]
fn port_is_open(port: u16) -> bool {
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    TcpStream::connect_timeout(&addr, Duration::from_millis(120)).is_ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PtyManager::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            path_exists,
            project_file_tree,
            git_project_changes,
            git_project_diff,
            git_clone,
            port_is_open,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
