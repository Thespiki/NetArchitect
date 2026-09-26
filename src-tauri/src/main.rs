// Application de bureau : une fenêtre qui charge le jeu web embarqué (dist/).
// Pas de console sous Windows en version publiée.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("impossible de lancer NetArchitect");
}
