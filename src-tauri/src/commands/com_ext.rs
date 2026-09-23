// Community plugin (`com_ext`) management commands.
//
// These are deliberately separate from the official `extension_*` commands in
// `commands/extensions.rs`.  Different package format, different storage root,
// different state, different capability set: nothing is shared, so both
// interfaces can be active at the same time without either observing the other.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComExtOverviewDto {
    installed: Vec<cfms_service::com_ext::ComExtInstallation>,
    host_api_version: &'static str,
    capabilities: &'static [&'static str],
    package_extension: &'static str,
    /// Absolute path plugins are installed into, shown in the UI so a user can
    /// find them on disk.
    root: String,
}

#[tauri::command]
pub async fn get_com_ext_overview(
    state: tauri::State<'_, AppHandleState>,
) -> Result<ComExtOverviewDto, String> {
    let store = state.com_ext.clone();
    let root = store.root().display().to_string();
    let installed = tokio::task::spawn_blocking(move || store.list_installed())
        .await
        .map_err(|e| format!("Community plugin list task failed: {e}"))??;

    Ok(ComExtOverviewDto {
        installed,
        host_api_version: cfms_service::com_ext::COM_EXT_API_VERSION,
        capabilities: cfms_service::com_ext::COM_EXT_CAPABILITIES,
        package_extension: cfms_service::com_ext::COM_EXT_PACKAGE_EXTENSION,
        root,
    })
}

/// Install a `.cfmscomext` archive from a path chosen by the user.
///
/// The plugin is installed disabled; enabling is a separate command so the
/// capability prompt cannot be skipped.
#[tauri::command]
pub async fn import_com_ext_package(
    state: tauri::State<'_, AppHandleState>,
    path: String,
) -> Result<cfms_service::com_ext::ComExtInstallation, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = state;
        let _ = path;
        return Err("Installable community plugin packages are not available on mobile".into());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let package_path = std::path::PathBuf::from(path);
        let metadata = tokio::fs::metadata(&package_path)
            .await
            .map_err(|e| format!("Failed to inspect the plugin package: {e}"))?;
        if !metadata.is_file() {
            return Err("Community plugin packages must be files".into());
        }
        // Check the size before reading so an oversized file is never loaded.
        let limit = 32 * 1024 * 1024_u64;
        if metadata.len() > limit {
            return Err(format!(
                "Community plugin package is {} bytes, which exceeds the {limit} byte limit",
                metadata.len()
            ));
        }
        let package = tokio::fs::read(&package_path)
            .await
            .map_err(|e| format!("Failed to read the plugin package: {e}"))?;
        let store = state.com_ext.clone();
        tokio::task::spawn_blocking(move || store.install_package(&package))
            .await
            .map_err(|e| format!("Community plugin installation task failed: {e}"))?
    }
}

#[tauri::command]
pub async fn uninstall_com_ext_plugin(
    state: tauri::State<'_, AppHandleState>,
    plugin_id: String,
) -> Result<(), String> {
    let store = state.com_ext.clone();
    tokio::task::spawn_blocking(move || store.uninstall(&plugin_id))
        .await
        .map_err(|e| format!("Community plugin uninstall task failed: {e}"))?
}

/// Enable or disable a plugin.
///
/// Enabling approves exactly the capabilities the manifest declares; the store
/// derives the grant, so the caller cannot widen or narrow it.
#[tauri::command]
pub async fn set_com_ext_enabled(
    state: tauri::State<'_, AppHandleState>,
    plugin_id: String,
    enabled: bool,
) -> Result<(), String> {
    let store = state.com_ext.clone();
    tokio::task::spawn_blocking(move || store.set_enabled(&plugin_id, enabled))
        .await
        .map_err(|e| format!("Community plugin enable task failed: {e}"))?
}

#[tauri::command]
pub async fn read_com_ext_page(
    state: tauri::State<'_, AppHandleState>,
    plugin_id: String,
    page: String,
) -> Result<serde_json::Value, String> {
    let store = state.com_ext.clone();
    tokio::task::spawn_blocking(move || store.read_page(&plugin_id, &page))
        .await
        .map_err(|e| format!("Community plugin page task failed: {e}"))?
}

#[tauri::command]
pub async fn read_com_ext_workflow(
    state: tauri::State<'_, AppHandleState>,
    plugin_id: String,
    workflow: String,
) -> Result<serde_json::Value, String> {
    let store = state.com_ext.clone();
    tokio::task::spawn_blocking(move || store.read_workflow(&plugin_id, &workflow))
        .await
        .map_err(|e| format!("Community plugin workflow task failed: {e}"))?
}

/// Read a slot or hook contribution document.
///
/// `kind` is `slots` or `hooks`.
#[tauri::command]
pub async fn read_com_ext_contribution(
    state: tauri::State<'_, AppHandleState>,
    plugin_id: String,
    kind: String,
    id: String,
) -> Result<serde_json::Value, String> {
    let store = state.com_ext.clone();
    tokio::task::spawn_blocking(move || store.read_contribution(&plugin_id, &kind, &id))
        .await
        .map_err(|e| format!("Community plugin contribution task failed: {e}"))?
}

#[tauri::command]
pub async fn get_com_ext_storage(
    state: tauri::State<'_, AppHandleState>,
    plugin_id: String,
    key: String,
) -> Result<Option<String>, String> {
    let store = state.com_ext.clone();
    tokio::task::spawn_blocking(move || store.storage_get(&plugin_id, &key))
        .await
        .map_err(|e| format!("Community plugin storage read task failed: {e}"))?
}

#[tauri::command]
pub async fn set_com_ext_storage(
    state: tauri::State<'_, AppHandleState>,
    plugin_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let store = state.com_ext.clone();
    tokio::task::spawn_blocking(move || store.storage_set(&plugin_id, &key, &value))
        .await
        .map_err(|e| format!("Community plugin storage write task failed: {e}"))?
}

#[tauri::command]
pub async fn remove_com_ext_storage(
    state: tauri::State<'_, AppHandleState>,
    plugin_id: String,
    key: String,
) -> Result<(), String> {
    let store = state.com_ext.clone();
    tokio::task::spawn_blocking(move || store.storage_remove(&plugin_id, &key))
        .await
        .map_err(|e| format!("Community plugin storage delete task failed: {e}"))?
}

#[tauri::command]
pub async fn clear_com_ext_storage(
    state: tauri::State<'_, AppHandleState>,
    plugin_id: String,
) -> Result<(), String> {
    let store = state.com_ext.clone();
    tokio::task::spawn_blocking(move || store.storage_clear(&plugin_id))
        .await
        .map_err(|e| format!("Community plugin storage clear task failed: {e}"))?
}
