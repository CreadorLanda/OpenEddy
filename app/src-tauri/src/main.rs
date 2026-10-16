// Evita o console extra no Windows; no Linux não muda nada.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    open_eddy_lib::run()
}
