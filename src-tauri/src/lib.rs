// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
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
