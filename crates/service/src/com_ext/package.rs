//! Archive handling for `.cfmscomext` packages.
//!
//! Community packages are unsigned, so this module is the only thing standing
//! between a malicious or merely buggy archive and the user's filesystem.  The
//! rules enforced here are structural, not cryptographic:
//!
//! - only allowlisted entry paths are accepted, and they must be relative and
//!   already normalized (no `..`, no absolute paths, no drive prefixes),
//! - symbolic links are rejected,
//! - duplicate paths are rejected,
//! - archive size, expanded size, per-file size, and entry count are all
//!   bounded *while streaming*, so a zip bomb cannot exhaust memory or disk,
//! - every file is read into memory and re-validated before anything is written
//!   to disk; the store writes only from the validated set.
//!
//! Nothing in this module is shared with [`crate::extensions`]; the official
//! loader keeps its own copy of these primitives.

use std::collections::BTreeMap;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::manifest::{self, ComExtManifest};
use super::{
    COM_EXT_MANIFEST_FILENAME, MAX_EXPANDED_BYTES, MAX_FILES, MAX_FILE_BYTES, MAX_JSON_BYTES,
    MAX_PACKAGE_BYTES,
};

/// A package that passed every structural check, held in memory.
pub struct ValidatedComExtPackage {
    pub manifest: ComExtManifest,
    pub files: BTreeMap<String, Vec<u8>>,
    /// SHA-256 of the package bytes as received.
    pub package_digest: String,
    pub expanded_bytes: u64,
}

// Hand-written so that a failing assertion reports the plugin's identity rather
// than dumping every contained file's bytes.
impl std::fmt::Debug for ValidatedComExtPackage {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ValidatedComExtPackage")
            .field("id", &self.manifest.id)
            .field("version", &self.manifest.version)
            .field("files", &self.files.len())
            .field("expanded_bytes", &self.expanded_bytes)
            .finish()
    }
}

impl ValidatedComExtPackage {
    /// Digest of a specific contained file, for tamper detection.
    pub fn file_digest(&self, path: &str) -> Option<String> {
        self.files.get(path).map(|bytes| hex::encode(Sha256::digest(bytes)))
    }

    /// Every file that must be written to disk, with its digest.
    pub fn file_index(&self) -> Vec<FileIndexEntry> {
        self.files
            .iter()
            .map(|(path, bytes)| FileIndexEntry {
                path: path.clone(),
                sha256: hex::encode(Sha256::digest(bytes)),
                size: bytes.len() as u64,
            })
            .collect()
    }
}

/// One entry of the on-disk integrity index.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileIndexEntry {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

/// The integrity index persisted next to an installed package.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileIndex {
    pub files: Vec<FileIndexEntry>,
}

/// Parse and validate package bytes without touching the filesystem.
///
/// Returns a validated in-memory representation, or a human-readable reason the
/// package was rejected.  Callers must not write anything to disk unless this
/// returns `Ok`.
pub fn validate_package(package: &[u8]) -> Result<ValidatedComExtPackage, String> {
    if package.is_empty() {
        return Err("Plugin package is empty".into());
    }
    if package.len() > MAX_PACKAGE_BYTES {
        return Err(format!(
            "Plugin package is {} bytes, which exceeds the {} byte limit",
            package.len(),
            MAX_PACKAGE_BYTES
        ));
    }

    let package_digest = hex::encode(Sha256::digest(package));
    let mut archive = zip::ZipArchive::new(Cursor::new(package))
        .map_err(|e| format!("Not a valid .cfmscomext archive: {e}"))?;

    if archive.len() > MAX_FILES {
        return Err(format!(
            "Plugin package contains {} entries, which exceeds the {MAX_FILES} entry limit",
            archive.len()
        ));
    }

    let mut files: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let mut expanded_bytes: u64 = 0;
    let mut total_compressed: u64 = 0;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Failed to read plugin archive entry: {e}"))?;

        if entry.is_dir() {
            continue;
        }

        // Reject symlinks: an archive must not be able to point outside itself.
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Plugin packages cannot contain symbolic links".into());
        }

        // `enclosed_name` already rejects traversal and absolute paths, but we
        // re-derive the normalized form ourselves so the allowlist below sees a
        // single canonical spelling.
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "Plugin package contains an unsafe path".to_string())?;
        let relative = normalized_relative_path(&enclosed)?;

        // A renamed official package is the most likely user mistake here, so
        // name it precisely instead of reporting a generic forbidden file.
        if relative == "manifest.json" {
            return Err(format!(
                "Not a community package: it contains manifest.json, which is the official \
                 .cfmsext format. Community packages use {COM_EXT_MANIFEST_FILENAME}"
            ));
        }
        if relative == "META-INF/signature.ed25519" {
            return Err(
                "Not a community package: it contains an official signature envelope".into(),
            );
        }

        validate_package_path(&relative)?;

        let per_file_limit = if relative.ends_with(".json") {
            MAX_JSON_BYTES
        } else {
            MAX_FILE_BYTES
        };
        if entry.size() > per_file_limit {
            return Err(format!(
                "Plugin file \"{relative}\" is {} bytes, which exceeds its {per_file_limit} byte limit",
                entry.size()
            ));
        }

        expanded_bytes = expanded_bytes
            .checked_add(entry.size())
            .ok_or_else(|| "Plugin expanded size overflowed".to_string())?;
        if expanded_bytes > MAX_EXPANDED_BYTES {
            return Err(format!(
                "Plugin package expands beyond the {MAX_EXPANDED_BYTES} byte limit"
            ));
        }

        total_compressed = total_compressed
            .checked_add(entry.compressed_size())
            .ok_or_else(|| "Plugin compressed size overflowed".to_string())?;

        if files.contains_key(&relative) {
            return Err(format!(
                "Plugin package contains duplicate path \"{relative}\""
            ));
        }

        // Cap the read at the declared size: a lying header cannot make us
        // allocate beyond the limit we already checked.
        let declared = entry.size();
        let mut contents = Vec::with_capacity(declared.min(per_file_limit) as usize);
        let mut limited = (&mut entry).take(declared.saturating_add(1));
        limited
            .read_to_end(&mut contents)
            .map_err(|e| format!("Failed to read plugin file \"{relative}\": {e}"))?;
        if contents.len() as u64 != declared {
            return Err(format!(
                "Plugin file \"{relative}\" is truncated or misreported by its archive header"
            ));
        }

        files.insert(relative, contents);
    }

    if files.is_empty() {
        return Err("Plugin package contains no files".into());
    }

    // The manifest doubles as the format marker.
    let manifest_bytes = files.get(COM_EXT_MANIFEST_FILENAME).ok_or_else(|| {
        format!(
            "Not a community package: it has no {COM_EXT_MANIFEST_FILENAME}. \
             Official .cfmsext packages declare manifest.json instead"
        )
    })?;
    let manifest: ComExtManifest = serde_json::from_slice(manifest_bytes)
        .map_err(|e| format!("Invalid plugin manifest: {e}"))?;
    manifest::validate_manifest(&manifest)?;

    // Referenced entrypoints must actually be present. A page id resolves to a
    // self-contained HTML application or to a declarative document, never both:
    // an author who leaves both behind has two answers to the same question.
    for (entry_id, page) in manifest::referenced_pages(&manifest) {
        let html_path = format!("pages/{page}.html");
        let json_path = format!("pages/{page}.json");
        match (files.get(&html_path), files.get(&json_path)) {
            (Some(_), Some(_)) => {
                return Err(format!(
                    "Entrypoint \"{entry_id}\" is ambiguous: \"{html_path}\" and \"{json_path}\" \
                     both exist. Keep one."
                ));
            }
            (None, Some(bytes)) => ensure_json_object(bytes, &json_path)?,
            (Some(_), None) => {}
            (None, None) => {
                return Err(format!(
                    "Entrypoint \"{entry_id}\" references missing page: neither \"{html_path}\" \
                     nor \"{json_path}\" is present"
                ));
            }
        }
    }
    for (entry_id, workflow) in manifest::referenced_workflows(&manifest) {
        let path = format!("workflows/{workflow}.json");
        let bytes = files.get(&path).ok_or_else(|| {
            format!("Entrypoint \"{entry_id}\" references missing workflow \"{path}\"")
        })?;
        ensure_json_object(bytes, &path)?;
    }

    Ok(ValidatedComExtPackage {
        manifest,
        files,
        package_digest,
        expanded_bytes,
    })
}

/// Re-validate an installed directory against its recorded index.
///
/// Called before serving a page or workflow, so edits made directly on disk are
/// detected rather than executed.
pub fn verify_installed_files(
    files: &BTreeMap<String, Vec<u8>>,
    index: &FileIndex,
) -> Result<(), String> {
    if index.files.len() != files.len() {
        return Err("Installed plugin file index does not match its contents".into());
    }
    for entry in &index.files {
        validate_package_path(&entry.path)?;
        let contents = files
            .get(&entry.path)
            .ok_or_else(|| format!("Installed plugin is missing \"{}\"", entry.path))?;
        if contents.len() as u64 != entry.size {
            return Err(format!(
                "Installed plugin file \"{}\" changed size since installation",
                entry.path
            ));
        }
        let digest = hex::encode(Sha256::digest(contents));
        if digest != entry.sha256 {
            return Err(format!(
                "Installed plugin file \"{}\" was modified after installation",
                entry.path
            ));
        }
    }
    Ok(())
}

/// Allowlist of permitted archive entry paths.
fn validate_package_path(path: &str) -> Result<(), String> {
    let allowed = path == COM_EXT_MANIFEST_FILENAME
        || path == "META-INF/files.json"
        || (path.starts_with("pages/") && (path.ends_with(".json") || path.ends_with(".html")))
        || (path.starts_with("workflows/") && path.ends_with(".json"))
        || (path.starts_with("slots/") && path.ends_with(".json"))
        || (path.starts_with("hooks/") && path.ends_with(".json"))
        || (path.starts_with("assets/")
            && matches!(
                Path::new(path)
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(str::to_ascii_lowercase)
                    .as_deref(),
                Some("png" | "jpg" | "jpeg" | "webp" | "gif" | "ico")
            ));
    if !allowed {
        return Err(format!(
            "Plugin package contains forbidden file \"{path}\""
        ));
    }
    Ok(())
}

/// Reject absolute, non-normalized, or empty paths.
fn normalized_relative_path(path: &Path) -> Result<String, String> {
    if path.as_os_str().is_empty() {
        return Err("Plugin package contains an empty path".into());
    }
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!(
            "Plugin package path \"{}\" must be relative and normalized",
            path.display()
        ));
    }
    Ok(path
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

/// Convert a validated relative path into a path under `base`, proving that the
/// result stays inside `base`.
pub fn safe_join(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let normalized = normalized_relative_path(Path::new(relative))?;
    let target = base.join(normalized.replace('/', std::path::MAIN_SEPARATOR_STR));
    ensure_within(&target, base)?;
    Ok(target)
}

/// Prove that `path` is strictly inside `base` after lexical normalization.
pub fn ensure_within(path: &Path, base: &Path) -> Result<(), String> {
    let path = absolute_lexical(path)?;
    let base = absolute_lexical(base)?;
    if !path.starts_with(&base) || path == base {
        return Err(format!(
            "Plugin path \"{}\" escapes its storage root",
            path.display()
        ));
    }
    Ok(())
}

/// Make a path absolute and resolve `.` / `..` lexically, without touching disk.
fn absolute_lexical(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("Failed to resolve the current directory: {e}"))?
            .join(path)
    };
    let mut result = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !result.pop() {
                    return Err("Plugin path escapes the filesystem root".into());
                }
            }
            other => result.push(other.as_os_str()),
        }
    }
    Ok(result)
}

/// Require a contained document to be a JSON object.
fn ensure_json_object(bytes: &[u8], path: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|e| format!("Plugin document \"{path}\" is not valid JSON: {e}"))?;
    if !value.is_object() {
        return Err(format!("Plugin document \"{path}\" must be a JSON object"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// `entrypoints_extra` is spliced *inside* the `entrypoints` object, so
    /// tests can add slots, hooks, or overrides without hand-writing the whole
    /// manifest.
    fn manifest_json(id: &str, entrypoints_extra: &str) -> String {
        format!(
            r#"{{
                "format": "cfmscomext",
                "schema_version": 1,
                "id": "{id}",
                "name": "Test Plugin",
                "description": "A plugin used by tests",
                "publisher": "tests",
                "version": "1.0.0",
                "com_ext_api": "1.0.0",
                "min_client_version": "0.51.1",
                "requested_capabilities": ["files.list"],
                "entrypoints": {{
                    "pages": [{{ "id": "home", "label": "Home", "page": "home" }}]
                    {entrypoints_extra}
                }},
                "background_triggers": []
            }}"#
        )
    }

    fn build(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buffer = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(Cursor::new(&mut buffer));
            let options = zip::write::SimpleFileOptions::default();
            for (name, contents) in entries {
                writer.start_file(*name, options).unwrap();
                writer.write_all(contents).unwrap();
            }
            writer.finish().unwrap();
        }
        buffer
    }

    fn valid_package() -> Vec<u8> {
        build(&[
            (
                "com_ext.json",
                manifest_json("org.example.test", "").as_bytes(),
            ),
            ("pages/home.json", br#"{"schema_version":1,"title":"Home","blocks":[]}"#),
        ])
    }

    #[test]
    fn accepts_a_well_formed_package() {
        let validated = validate_package(&valid_package()).expect("package should be valid");
        assert_eq!(validated.manifest.id, "org.example.test");
        assert_eq!(validated.files.len(), 2);
    }

    #[test]
    fn accepts_a_page_shipped_as_a_self_contained_application() {
        let package = build(&[
            (
                "com_ext.json",
                manifest_json("org.example.test", "").as_bytes(),
            ),
            (
                "pages/home.html",
                b"<!doctype html><p>hi</p><script>2+2</script>",
            ),
        ]);

        let validated = validate_package(&package).expect("an html page should be accepted");
        assert!(validated.files.contains_key("pages/home.html"));
    }

    #[test]
    fn rejects_a_page_shipped_as_both_html_and_json() {
        let package = build(&[
            (
                "com_ext.json",
                manifest_json("org.example.test", "").as_bytes(),
            ),
            ("pages/home.html", b"<p>hi</p>"),
            ("pages/home.json", br#"{"schema_version":1,"blocks":[]}"#),
        ]);

        let error = validate_package(&package).expect_err("two answers for one page id must fail");
        assert!(error.contains("ambiguous"), "got: {error}");
    }

    #[test]
    fn rejects_a_page_present_in_neither_form() {
        let package = build(&[(
            "com_ext.json",
            manifest_json("org.example.test", "").as_bytes(),
        )]);

        let error = validate_package(&package).expect_err("a missing page must fail");
        assert!(error.contains("neither"), "got: {error}");
    }

    #[test]
    fn rejects_a_loose_script_next_to_a_page() {
        // A page is one self-contained file. A plugin that needs code puts it
        // inside its HTML, so a stray .js beside the page is a packaging
        // mistake worth naming rather than silently ignoring.
        let package = build(&[
            (
                "com_ext.json",
                manifest_json("org.example.test", "").as_bytes(),
            ),
            ("pages/home.json", br#"{"schema_version":1,"blocks":[]}"#),
            ("pages/home.js", b"alert(1)"),
        ]);

        let error = validate_package(&package).expect_err("a loose script must be refused");
        assert!(error.contains("forbidden"), "got: {error}");
    }

    #[test]
    fn allows_one_id_to_name_a_page_and_the_navigation_entry_that_opens_it() {
        // `pages` already declares an entry with id "home", so reusing it on the
        // navigation list is exactly the collision that used to be refused.
        let package = build(&[
            (
                "com_ext.json",
                manifest_json(
                    "org.example.test",
                    r#", "navigation": [{ "id": "home", "label": "Home", "page": "home" }]"#,
                )
                .as_bytes(),
            ),
            ("pages/home.html", b"<p>body</p>"),
        ]);

        validate_package(&package).expect("the same id on two surfaces should be accepted");
    }

    #[test]
    fn rejects_the_same_id_twice_on_one_surface() {
        let package = build(&[
            (
                "com_ext.json",
                manifest_json(
                    "org.example.test",
                    r#", "navigation": [
                        { "id": "tools", "label": "Tools", "page": "home" },
                        { "id": "tools", "label": "Again", "page": "home" }
                    ]"#,
                )
                .as_bytes(),
            ),
            ("pages/home.html", b"<p>body</p>"),
        ]);

        let error = validate_package(&package).expect_err("a repeated id must be refused");
        assert!(error.contains("Duplicate entrypoint id"), "got: {error}");
    }

    /// End-to-end check of the Node packer against the host's own validator.
    ///
    /// The packer and this crate are two independent implementations of one
    /// format, so the only test that means anything is this one: the host
    /// reading a real archive the packer wrote. Run `pnpm plugin:build tools`
    /// to produce the artifact.
    #[test]
    fn accepts_a_package_the_node_packer_produced() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("dist-plugins")
            .join("tools.cfmscomext");

        let Ok(bytes) = std::fs::read(&path) else {
            eprintln!(
                "skipped: {} is absent. Run `pnpm plugin:build tools` to produce it.",
                path.display()
            );
            return;
        };

        let validated = validate_package(&bytes)
            .unwrap_or_else(|e| panic!("the host refused a package its own packer wrote: {e}"));

        assert_eq!(validated.manifest.id, "org.cfms.tools");
        assert!(
            validated.files.contains_key("pages/tools.html"),
            "the packed plugin must carry its page"
        );
    }

    #[test]
    fn rejects_an_official_manifest_name() {
        // A renamed .cfmsext package must fail with a clear format error.
        let package = build(&[
            ("manifest.json", br#"{"id":"org.example.official"}"#),
        ]);
        let error = validate_package(&package).expect_err("must be rejected");
        assert!(error.contains("Not a community package"), "got: {error}");
    }

    #[test]
    fn rejects_a_foreign_format_marker() {
        let package = build(&[
            ("com_ext.json", manifest_json("org.example.test", "").replace("cfmscomext", "cfmsext").as_bytes()),
            ("pages/home.json", br#"{"schema_version":1,"title":"Home","blocks":[]}"#),
        ]);
        let error = validate_package(&package).expect_err("must be rejected");
        assert!(error.contains("Not a community package"), "got: {error}");
    }

    #[test]
    fn rejects_forbidden_paths() {
        let package = build(&[
            ("com_ext.json", manifest_json("org.example.test", "").as_bytes()),
            ("native.dll", b"binary payload"),
        ]);
        let error = validate_package(&package).expect_err("must be rejected");
        assert!(error.contains("forbidden file"), "got: {error}");
    }

    #[test]
    fn rejects_traversal_paths() {
        let mut buffer = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(Cursor::new(&mut buffer));
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file("com_ext.json", options).unwrap();
            writer
                .write_all(manifest_json("org.example.test", "").as_bytes())
                .unwrap();
            // Written verbatim; `enclosed_name` must refuse it.
            writer.start_file("../../escape.json", options).unwrap();
            writer.write_all(b"{}").unwrap();
            writer.finish().unwrap();
        }
        let error = validate_package(&buffer).expect_err("must be rejected");
        assert!(error.contains("unsafe path"), "got: {error}");
    }

    #[test]
    fn rejects_missing_referenced_page() {
        let package = build(&[(
            "com_ext.json",
            manifest_json("org.example.test", "").as_bytes(),
        )]);
        let error = validate_package(&package).expect_err("must be rejected");
        assert!(error.contains("missing page"), "got: {error}");
    }

    #[test]
    fn rejects_unknown_capability() {
        let manifest = manifest_json("org.example.test", "").replace(
            r#"["files.list"]"#,
            r#"["files.list","files.write"]"#,
        );
        let package = build(&[
            ("com_ext.json", manifest.as_bytes()),
            ("pages/home.json", br#"{"schema_version":1,"title":"Home","blocks":[]}"#),
        ]);
        let error = validate_package(&package).expect_err("must be rejected");
        assert!(error.contains("unknown capability"), "got: {error}");
    }

    #[test]
    fn rejects_unknown_slot_point() {
        let package = build(&[
            ("com_ext.json", manifest_json("org.example.test", "").as_bytes()),
            ("pages/home.json", br#"{"schema_version":1,"title":"Home","blocks":[]}"#),
        ]);
        // Sanity: the valid baseline still loads, so the failure below is
        // attributable to the slot point alone.
        assert!(validate_package(&package).is_ok());

        let bad = build(&[
            (
                "com_ext.json",
                manifest_json(
                    "org.example.test",
                    r#", "slots": [{"id":"x","point":"no-such-point","page":"home"}]"#,
                )
                .as_bytes(),
            ),
            ("pages/home.json", br#"{"schema_version":1,"title":"Home","blocks":[]}"#),
        ]);
        let error = validate_package(&bad).expect_err("must be rejected");
        assert!(error.contains("Unknown slot point"), "got: {error}");
    }

    /// The refusal must name what the host *does* render, so a plugin author
    /// learns where their contribution can go instead of only that it failed.
    #[test]
    fn unknown_slot_point_lists_the_supported_points() {
        let package = build(&[
            (
                "com_ext.json",
                manifest_json(
                    "org.example.test",
                    r#", "slots": [{"id":"x","point":"file-row-trailing","page":"home"}]"#,
                )
                .as_bytes(),
            ),
            ("pages/home.json", br#"{"schema_version":1,"title":"Home","blocks":[]}"#),
        ]);

        let error = validate_package(&package).expect_err("must be rejected");

        assert!(error.contains("overview-section"), "got: {error}");
        assert!(error.contains("settings-section"), "got: {error}");
    }

    #[test]
    fn rejects_unknown_action_point() {
        let package = build(&[
            (
                "com_ext.json",
                manifest_json(
                    "org.example.test",
                    r#", "actions": [{"id":"x","label":"X","workflow":"w","point":"no-such-surface"}]"#,
                )
                .as_bytes(),
            ),
            ("pages/home.json", br#"{"schema_version":1,"title":"Home","blocks":[]}"#),
            (
                "workflows/w.json",
                br#"{"schema_version":1,"steps":[{"type":"result"}]}"#,
            ),
        ]);

        let error = validate_package(&package).expect_err("must be rejected");

        assert!(error.contains("Unknown action point"), "got: {error}");
        assert!(error.contains("file-toolbar"), "got: {error}");
    }

    /// A slot renders a document and an action runs a workflow, so the two
    /// vocabularies must not overlap: a toolbar action is not a valid slot.
    #[test]
    fn rejects_an_action_point_used_as_a_slot() {
        let package = build(&[
            (
                "com_ext.json",
                manifest_json(
                    "org.example.test",
                    r#", "slots": [{"id":"x","point":"file-toolbar","page":"home"}]"#,
                )
                .as_bytes(),
            ),
            ("pages/home.json", br#"{"schema_version":1,"title":"Home","blocks":[]}"#),
        ]);

        let error = validate_package(&package).expect_err("must be rejected");

        assert!(error.contains("Unknown slot point"), "got: {error}");
    }

    /// Not implemented yet, so accepted-and-ignored is the wrong answer: a
    /// plugin must not install believing a schedule it will never get.
    #[test]
    fn refuses_background_triggers_that_the_host_cannot_run() {
        let manifest = manifest_json("org.example.test", "").replace(
            r#""background_triggers": []"#,
            r#""background_triggers": [{"type":"interval","workflow":"w","minutes":30}]"#,
        );
        let package = build(&[
            ("com_ext.json", manifest.as_bytes()),
            ("pages/home.json", br#"{"schema_version":1,"title":"Home","blocks":[]}"#),
            (
                "workflows/w.json",
                br#"{"schema_version":1,"steps":[{"type":"result"}]}"#,
            ),
        ]);

        let error = validate_package(&package).expect_err("must be rejected");

        assert!(error.contains("Background triggers"), "got: {error}");
        assert!(error.contains("onLogin"), "got: {error}");
    }

    #[test]
    fn refuses_override_contributions() {
        let package = build(&[
            (
                "com_ext.json",
                manifest_json(
                    "org.example.test",
                    r#", "overrides": [{"id":"x","point":"page","target":"/home/chat","page":"home"}]"#,
                )
                .as_bytes(),
            ),
            ("pages/home.json", br#"{"schema_version":1,"title":"Home","blocks":[]}"#),
        ]);

        let error = validate_package(&package).expect_err("must be rejected");

        assert!(error.contains("Override"), "got: {error}");
    }

    /// A mistyped key used to be dropped by serde, so the plugin installed with
    /// the contribution missing and no hint as to why.
    #[test]
    fn rejects_an_unknown_manifest_field() {
        let manifest = manifest_json("org.example.test", "")
            .replace(r#""publisher": "tests","#, r#""publisher": "tests", "publiser": "typo","#);
        let package = build(&[
            ("com_ext.json", manifest.as_bytes()),
            ("pages/home.json", br#"{"schema_version":1,"title":"Home","blocks":[]}"#),
        ]);

        let error = validate_package(&package).expect_err("must be rejected");

        assert!(error.contains("publiser"), "got: {error}");
    }

    #[test]
    fn rejects_an_unknown_entrypoint_list() {
        let package = build(&[
            (
                "com_ext.json",
                manifest_json(
                    "org.example.test",
                    r#", "slot": [{"id":"x","point":"overview-section","page":"home"}]"#,
                )
                .as_bytes(),
            ),
            ("pages/home.json", br#"{"schema_version":1,"title":"Home","blocks":[]}"#),
        ]);

        let error = validate_package(&package).expect_err("must be rejected");

        assert!(error.contains("slot"), "got: {error}");
    }

    #[test]
    fn rejects_an_empty_archive() {
        let error = validate_package(&[]).expect_err("must be rejected");
        assert!(error.contains("empty"), "got: {error}");
    }

    #[test]
    fn installed_file_tampering_is_detected() {
        let validated = validate_package(&valid_package()).expect("package should be valid");
        let index = FileIndex {
            files: validated.file_index(),
        };
        assert!(verify_installed_files(&validated.files, &index).is_ok());

        // Same byte length as the original, so only the digest can catch this.
        let tampered_contents = br#"{"schema_version":1,"title":"Evil","blocks":[]}"#;
        assert_eq!(
            tampered_contents.len(),
            validated.files["pages/home.json"].len(),
            "the tamper must preserve length to exercise the digest check"
        );
        let mut tampered = validated.files.clone();
        tampered.insert("pages/home.json".into(), tampered_contents.to_vec());
        let error = verify_installed_files(&tampered, &index).expect_err("must be detected");
        assert!(error.contains("modified after installation"), "got: {error}");
    }

    #[test]
    fn installed_file_removal_is_detected() {
        let validated = validate_package(&valid_package()).expect("package should be valid");
        let index = FileIndex {
            files: validated.file_index(),
        };
        let mut removed = validated.files.clone();
        removed.remove("pages/home.json");
        let error = verify_installed_files(&removed, &index).expect_err("must be detected");
        assert!(error.contains("does not match its contents"), "got: {error}");
    }

    #[test]
    fn safe_join_refuses_to_escape() {
        let base = std::env::temp_dir().join("com_ext_safe_join_test");
        assert!(safe_join(&base, "pages/home.json").is_ok());
        assert!(safe_join(&base, "../escape.json").is_err());
        assert!(safe_join(&base, "/etc/passwd").is_err());
    }
}
