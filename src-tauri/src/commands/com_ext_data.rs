// Reusable data primitives for HTML community plugin pages.
use std::io::Read as _;
use std::path::{Path, PathBuf};
use tauri_plugin_opener::OpenerExt as _;

const COM_EXT_SERVER_TEXT_LIMIT: u64 = 8 * 1024 * 1024;
const COM_EXT_LOCAL_TEXT_LIMIT: u64 = 4 * 1024 * 1024;

fn required_bridge_string<'a>(
    arguments: &'a serde_json::Value,
    key: &str,
) -> Result<&'a str, String> {
    arguments
        .get(key)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("Community plugin call requires {key}"))
}

fn read_text_file(path: &Path, limit: u64) -> Result<serde_json::Value, String> {
    let size = std::fs::metadata(path)
        .map_err(|e| format!("Failed to inspect {}: {e}", path.display()))?
        .len();
    let file =
        std::fs::File::open(path).map_err(|e| format!("Failed to open {}: {e}", path.display()))?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let truncated = bytes.len() as u64 > limit;
    bytes.truncate(limit as usize);
    Ok(
        serde_json::json!({ "content": String::from_utf8_lossy(&bytes), "size": size, "truncated": truncated }),
    )
}

fn read_com_ext_local_text(path: &str) -> Result<serde_json::Value, String> {
    read_text_file(Path::new(path), COM_EXT_LOCAL_TEXT_LIMIT)
}

fn write_com_ext_local_text(path: &str, content: &str) -> Result<serde_json::Value, String> {
    std::fs::write(path, content).map_err(|e| format!("Failed to write {path}: {e}"))?;
    Ok(serde_json::json!({ "saved": true }))
}

fn open_com_ext_local_path(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    if !Path::new(path).exists() {
        return Err(format!("File not found: {path}"));
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("Failed to open {path}: {e}"))
}

fn sorted_local_entries(directory: &Path) -> Vec<PathBuf> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(directory)
        .map(|reader| {
            reader
                .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                .collect()
        })
        .unwrap_or_default();
    entries.sort();
    entries
}

fn local_attachment_kind(name: &str) -> &'static str {
    let extension = Path::new(name)
        .extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" => "image",
        "mp3" | "wav" | "ogg" | "m4a" | "flac" | "aac" => "audio",
        _ => "other",
    }
}

// Chatbox-compatible local folder scan; also useful for any folder of grouped
// text records and attachments. The generic recursive scanner is local.folder.scan.
fn scan_com_ext_local_chatbox(dir: &str) -> Result<serde_json::Value, String> {
    let picked = PathBuf::from(dir);
    let root = if picked.join(".runtime").join("chatbox").is_dir() {
        picked.join(".runtime").join("chatbox")
    } else {
        picked
    };
    if !root.is_dir() {
        return Err(format!("Folder not found: {}", root.display()));
    }
    let mut rooms = Vec::new();
    for room in sorted_local_entries(&root) {
        if !room.is_dir() {
            continue;
        }
        let id = room
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        if id.is_empty() || id.starts_with('.') {
            continue;
        }
        let mut files = Vec::new();
        for path in sorted_local_entries(&room) {
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            if name.is_empty() || name.starts_with('.') {
                continue;
            }
            let size = path.metadata().map(|metadata| metadata.len()).unwrap_or(0);
            let is_text = path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("txt"));
            let (content, truncated) = if is_text {
                let data = read_text_file(&path, COM_EXT_LOCAL_TEXT_LIMIT)?;
                (
                    Some(data["content"].clone()),
                    data["truncated"].as_bool().unwrap_or(false),
                )
            } else {
                (None, false)
            };
            files.push(serde_json::json!({
                "name": name, "path": path.to_string_lossy(),
                "kind": if is_text { "text" } else { local_attachment_kind(&name) },
                "size": size, "content": content, "truncated": truncated,
            }));
        }
        rooms.push(serde_json::json!({ "id": id, "files": files }));
    }
    Ok(serde_json::Value::Array(rooms))
}

fn com_ext_local_document_state(
    root: &Path,
    relative_path: &str,
    expected_hash: Option<&str>,
    expected_size: Option<u64>,
) -> Result<serde_json::Value, String> {
    use sha2::Digest as _;
    let path = resolve_download_subdirectory(root.to_path_buf(), relative_path)?;
    let exists_locally = path.is_file();
    let size = if exists_locally {
        Some(
            std::fs::metadata(&path)
                .map_err(|e| format!("Failed to inspect local document: {e}"))?
                .len(),
        )
    } else {
        None
    };
    let local_hash = if exists_locally && expected_hash.is_some() {
        let mut file = std::fs::File::open(&path)
            .map_err(|e| format!("Failed to open local document: {e}"))?;
        let mut digest = sha2::Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = file
                .read(&mut buffer)
                .map_err(|e| format!("Failed to hash local document: {e}"))?;
            if count == 0 {
                break;
            }
            digest.update(&buffer[..count]);
        }
        Some(hex::encode(digest.finalize()))
    } else {
        None
    };
    let is_current = exists_locally
        && expected_hash.is_some_and(|expected| {
            local_hash
                .as_deref()
                .is_some_and(|actual| actual.eq_ignore_ascii_case(expected))
        })
        && expected_size.is_none_or(|expected| size == Some(expected));
    Ok(serde_json::json!({
        "existsLocally": exists_locally, "isCurrent": is_current,
        "localHash": local_hash, "relativePath": relative_path, "size": size,
    }))
}

async fn read_com_ext_server_text(
    state: &AppHandleState,
    document_id: &str,
) -> Result<serde_json::Value, String> {
    let temp =
        tempfile::tempdir().map_err(|e| format!("Failed to create temporary directory: {e}"))?;
    let destination = temp.path().join("document.txt");
    let response = server_action_response(
        state,
        "get_document",
        serde_json::json!({ "document_id": document_id }),
    )
    .await?;
    if response.code != 200 {
        return Err(format_server_response_error(&response));
    }
    let task_id = response.data["task_data"]["task_id"]
        .as_str()
        .ok_or_else(|| "Server response missing task_id".to_string())?;
    let connection = create_transfer_connection(&state.inner)
        .await
        .map_err(|e| format!("Transfer connection failed: {e}"))?;
    let progress = |_phase: cfms_core::DownloadPhase,
                    _progress: f64,
                    _message: &str,
                    _current: u64,
                    _total: u64| {};
    let max_chunk_size = state
        .inner
        .download_max_chunk_size
        .load(std::sync::atomic::Ordering::Relaxed) as u32;
    let result = cfms_transfer::download::receive(
        &connection,
        task_id,
        &destination,
        max_chunk_size,
        &progress,
    )
    .await;
    connection.close().await;
    result.map_err(|e| format!("Document download failed: {e}"))?;
    read_text_file(&destination, COM_EXT_SERVER_TEXT_LIMIT)
}

#[cfg(test)]
mod com_ext_data_tests {
    use super::*;

    #[test]
    fn local_document_needs_matching_hash_to_be_current() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("file.txt"), "hello").unwrap();
        let absent = com_ext_local_document_state(root.path(), "file.txt", None, Some(5)).unwrap();
        assert_eq!(absent["existsLocally"], true);
        assert_eq!(absent["isCurrent"], false);
        let matching = com_ext_local_document_state(
            root.path(),
            "file.txt",
            Some("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"),
            Some(5),
        )
        .unwrap();
        assert_eq!(matching["isCurrent"], true);
        assert!(com_ext_local_document_state(root.path(), "../outside", None, None).is_err());
    }

    #[test]
    fn required_data_fields_are_checked() {
        assert!(required_bridge_string(&serde_json::json!({}), "path").is_err());
        assert_eq!(
            required_bridge_string(&serde_json::json!({ "path": "/" }), "path").unwrap(),
            "/"
        );
    }
}
