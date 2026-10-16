// O núcleo Python (open-eddy/core/server.py): sobe junto com o app, morre junto.
//
// O núcleo escolhe uma porta livre e a anuncia na primeira linha da saída; o
// token de sessão sai daqui, então nenhum outro processo fala com ele.

use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
pub struct BackendInfo {
    pub url: String,
    pub token: String,
}

#[derive(Default)]
pub struct Backend {
    child: Mutex<Option<Child>>,
    pub info: Mutex<Option<BackendInfo>>,
}

/// open-eddy/ — onde ficam core/, .venv/, bin/ollama, kokoro/.
/// `EDDY_HOME` ganha; senão, a pasta do código-fonte (o app roda deste checkout).
pub fn home() -> PathBuf {
    if let Ok(dir) = std::env::var("EDDY_HOME") {
        return PathBuf::from(dir);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn token() -> String {
    let mut buf = [0u8; 24];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        let _ = f.read_exact(&mut buf);
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn start(app: &AppHandle) {
    let home = home();
    let python = home.join(".venv/bin/python");
    let python = if python.exists() { python } else { PathBuf::from("python3") };
    let token = token();

    let spawned = Command::new(&python)
        .arg(home.join("core/server.py"))
        .current_dir(&home)
        .env("EDDY_PORT", "0")
        .env("EDDY_TOKEN", &token)
        .env("EDDY_WATCH_STDIN", "1")
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn();

    let mut child = match spawned {
        Ok(c) => c,
        Err(err) => {
            eprintln!("[eddy] não consegui iniciar o núcleo ({}): {err}", python.display());
            let _ = app.emit("backend-error", err.to_string());
            return;
        }
    };

    let stdout = child.stdout.take();
    *app.state::<Backend>().child.lock().unwrap() = Some(child);

    let Some(stdout) = stdout else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(port) = line.strip_prefix("EDDY_LISTENING ") {
                let info = BackendInfo {
                    url: format!("http://127.0.0.1:{}", port.trim()),
                    token: token.clone(),
                };
                *app.state::<Backend>().info.lock().unwrap() = Some(info.clone());
                let _ = app.emit("backend-ready", info);
            } else {
                println!("[core] {line}");
            }
        }
        let _ = app.emit("backend-error", "o núcleo do Eddy parou");
    });
}

pub fn stop(app: &AppHandle) {
    if let Some(mut child) = app.state::<Backend>().child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}
