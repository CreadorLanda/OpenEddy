// Open Eddy — a janela do Eddy ligada ao núcleo Python.

mod backend;
mod tray;

use std::process::Command;

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};

use backend::{Backend, BackendInfo};

/// URL + token do núcleo; `None` enquanto ele ainda está subindo (aí a janela
/// espera o evento `backend-ready`).
#[tauri::command]
fn backend(state: State<Backend>) -> Option<BackendInfo> {
    state.info.lock().unwrap().clone()
}

/// Abre links só http(s), no navegador padrão.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("só links http(s)".into());
    }
    Command::new("xdg-open").arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

pub fn show(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("eddy") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// A janela principal. Popups só do puter.com (o login abre um, e precisa do
/// `window.opener` para devolver a sessão); qualquer outro link vai pro navegador.
fn main_window(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, "eddy", WebviewUrl::App("index.html".into()))
        .title("Open Eddy")
        .inner_size(760.0, 820.0)
        .min_inner_size(420.0, 560.0)
        .center()
        .on_new_window(|url, _features| {
            let puter = url
                .host_str()
                .is_some_and(|h| h == "puter.com" || h.ends_with(".puter.com"));
            if puter && url.scheme() == "https" {
                return NewWindowResponse::Allow;
            }
            if matches!(url.scheme(), "http" | "https") {
                let _ = Command::new("xdg-open").arg(url.as_str()).spawn();
            }
            NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

pub fn run() {
    // O DMABUF do WebKitGTK deixa a janela em branco em várias placas.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app)))
        .manage(Backend::default())
        .invoke_handler(tauri::generate_handler![backend, open_url])
        .setup(|app| {
            backend::start(app.handle());
            main_window(app.handle())?;
            if let Err(err) = tray::build(app.handle()) {
                eprintln!("[open-eddy] bandeja indisponível: {err}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Open Eddy");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            backend::stop(app);
        }
    });
}
