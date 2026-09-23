//! Installation, enablement, and state for community plugins.
//!
//! # Isolation
//!
//! Everything lives under `<app_data>/com_ext`, and enablement/grants/storage
//! live under a single device-global settings key.  The official loader keeps
//! its packages under `<app_data>/extensions` and its enablement in per-user
//! preferences, so the two systems cannot observe or corrupt each other.
//!
//! # Lifecycle
//!
//! Install is: validate the archive fully in memory, replace the plugin's
//! directory, then persist the integrity index and metadata.  Nothing is
//! written until the archive has passed every structural check.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use semver::Version;
use serde::{Deserialize, Serialize};

use super::manifest::ComExtManifest;
use super::package::{self, FileIndex};
use super::{COM_EXT_MANIFEST_FILENAME, MAX_STORAGE_TOTAL_BYTES, MAX_STORAGE_VALUE_BYTES};

/// Settings key holding the whole community plugin state blob.
const STATE_KEY: &str = "com_ext.state";

/// A plugin as the UI sees it.
#[derive(Debug, Clone, Serialize)]
pub struct ComExtInstallation {
    pub manifest: ComExtManifest,
    pub package_digest: String,
    pub installed_at: i64,
    pub enabled: bool,
    pub granted_capabilities: Vec<String>,
    pub disk_bytes: u64,
}

/// Persisted per-plugin metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstalledRecord {
    version: String,
    package_digest: String,
    installed_at: i64,
}

/// The complete device-global state of the community plugin system.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct ComExtState {
    #[serde(default)]
    installed: BTreeMap<String, InstalledRecord>,
    #[serde(default)]
    enabled: BTreeMap<String, bool>,
    #[serde(default)]
    granted: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    storage: BTreeMap<String, BTreeMap<String, String>>,
}

/// Community plugin store.
///
/// Holds a settings handle and two paths, so cloning is cheap; the application
/// keeps one instance in managed Tauri state.
#[derive(Clone)]
pub struct ComExtStore {
    settings: crate::db::settings::SettingsStore,
    root: PathBuf,
    client_version: Version,
}

impl ComExtStore {
    /// Create a store rooted at `<app_data_dir>/com_ext`.
    pub fn new(
        settings: crate::db::settings::SettingsStore,
        app_data_dir: &Path,
        client_version: &str,
    ) -> Self {
        Self {
            settings,
            root: app_data_dir.join("com_ext"),
            client_version: Version::parse(client_version).unwrap_or_else(|_| Version::new(0, 0, 0)),
        }
    }

    /// Root directory holding every community plugin.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The client version this store compares `min_client_version` against.
    pub fn client_version(&self) -> &Version {
        &self.client_version
    }

    // -- state ---------------------------------------------------------------

    fn load_state(&self) -> Result<ComExtState, String> {
        match self
            .settings
            .get(STATE_KEY)
            .map_err(|e| format!("Failed to read community plugin state: {e}"))?
        {
            Some(raw) => serde_json::from_str(&raw)
                .map_err(|e| format!("Community plugin state is corrupt: {e}")),
            None => Ok(ComExtState::default()),
        }
    }

    fn save_state(&self, state: &ComExtState) -> Result<(), String> {
        let encoded = serde_json::to_string(state)
            .map_err(|e| format!("Failed to encode community plugin state: {e}"))?;
        self.settings
            .set(STATE_KEY, &encoded)
            .map_err(|e| format!("Failed to persist community plugin state: {e}"))
    }

    // -- layout --------------------------------------------------------------

    fn packages_root(&self) -> PathBuf {
        self.root.join("packages")
    }

    fn plugin_dir(&self, plugin_id: &str) -> PathBuf {
        self.packages_root().join(plugin_id)
    }

    fn version_dir(&self, plugin_id: &str, version: &str) -> PathBuf {
        self.plugin_dir(plugin_id).join(version)
    }

    // -- queries -------------------------------------------------------------

    /// Every installed plugin, newest install first.
    pub fn list_installed(&self) -> Result<Vec<ComExtInstallation>, String> {
        let state = self.load_state()?;
        let mut installations = Vec::new();

        for (plugin_id, record) in &state.installed {
            let version_dir = self.version_dir(plugin_id, &record.version);
            let manifest_path = version_dir.join(COM_EXT_MANIFEST_FILENAME);
            let Ok(bytes) = fs::read(&manifest_path) else {
                // The directory is gone, so the record is stale. Skip it rather
                // than failing the whole listing.
                continue;
            };
            let Ok(manifest) = serde_json::from_slice::<ComExtManifest>(&bytes) else {
                continue;
            };
            installations.push(ComExtInstallation {
                manifest,
                package_digest: record.package_digest.clone(),
                installed_at: record.installed_at,
                enabled: state.enabled.get(plugin_id).copied().unwrap_or(false),
                granted_capabilities: state.granted.get(plugin_id).cloned().unwrap_or_default(),
                disk_bytes: directory_size(&version_dir),
            });
        }

        installations.sort_by(|left, right| {
            right
                .installed_at
                .cmp(&left.installed_at)
                .then_with(|| left.manifest.id.cmp(&right.manifest.id))
        });
        Ok(installations)
    }

    /// One installed plugin, if present.
    pub fn get_installed(&self, plugin_id: &str) -> Result<Option<ComExtInstallation>, String> {
        Ok(self
            .list_installed()?
            .into_iter()
            .find(|installation| installation.manifest.id == plugin_id))
    }

    // -- mutations -----------------------------------------------------------

    /// Validate and install a `.cfmscomext` archive.
    ///
    /// Replaces any previously installed version of the same plugin.  The
    /// plugin is installed **disabled**; enabling is a separate, explicit step.
    pub fn install_package(&self, package_bytes: &[u8]) -> Result<ComExtInstallation, String> {
        let validated = package::validate_package(package_bytes)?;
        let manifest = validated.manifest.clone();

        if !manifest.min_client_version.is_empty() {
            let minimum = Version::parse(&manifest.min_client_version)
                .map_err(|e| format!("Invalid min_client_version: {e}"))?;
            if self.client_version < minimum {
                return Err(format!(
                    "Plugin \"{}\" requires client version {} or newer, but this build is {}",
                    manifest.name, minimum, self.client_version
                ));
            }
        }

        let plugin_dir = self.plugin_dir(&manifest.id);
        let version_dir = self.version_dir(&manifest.id, &manifest.version);

        // Replace any existing version. Removing the whole plugin directory
        // keeps a single active version and avoids leaving stale files behind
        // that a later read could pick up.
        if plugin_dir.exists() {
            fs::remove_dir_all(&plugin_dir).map_err(|e| {
                format!(
                    "Failed to replace the existing installation of \"{}\": {e}",
                    manifest.id
                )
            })?;
        }
        fs::create_dir_all(&version_dir)
            .map_err(|e| format!("Failed to create the plugin directory: {e}"))?;

        for (relative, contents) in &validated.files {
            let target = package::safe_join(&version_dir, relative)?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create \"{}\": {e}", parent.display()))?;
            }
            fs::write(&target, contents)
                .map_err(|e| format!("Failed to write \"{}\": {e}", target.display()))?;
        }

        // Persist the integrity index so later reads can detect edits on disk.
        let index = FileIndex {
            files: validated.file_index(),
        };
        let index_path = version_dir.join("META-INF").join("files.json");
        if let Some(parent) = index_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create the plugin index directory: {e}"))?;
        }
        let encoded = serde_json::to_vec_pretty(&index)
            .map_err(|e| format!("Failed to encode the plugin file index: {e}"))?;
        fs::write(&index_path, encoded)
            .map_err(|e| format!("Failed to write the plugin file index: {e}"))?;

        let mut state = self.load_state()?;
        state.installed.insert(
            manifest.id.clone(),
            InstalledRecord {
                version: manifest.version.clone(),
                package_digest: validated.package_digest.clone(),
                installed_at: unix_now(),
            },
        );
        // A fresh install starts disabled and drops any previous grant: a new
        // version must re-request its capabilities.
        state.enabled.insert(manifest.id.clone(), false);
        state.granted.remove(&manifest.id);
        self.save_state(&state)?;

        Ok(ComExtInstallation {
            manifest,
            package_digest: validated.package_digest,
            installed_at: unix_now(),
            enabled: false,
            granted_capabilities: Vec::new(),
            disk_bytes: directory_size(&version_dir),
        })
    }

    /// Remove a plugin and all of its state.
    pub fn uninstall(&self, plugin_id: &str) -> Result<(), String> {
        let mut state = self.load_state()?;
        state.installed.remove(plugin_id);
        state.enabled.remove(plugin_id);
        state.granted.remove(plugin_id);
        state.storage.remove(plugin_id);

        let plugin_dir = self.plugin_dir(plugin_id);
        if plugin_dir.exists() {
            fs::remove_dir_all(&plugin_dir)
                .map_err(|e| format!("Failed to remove plugin files: {e}"))?;
        }
        self.save_state(&state)
    }

    /// Enable or disable a plugin.
    ///
    /// Enabling approves **exactly** the capability set the manifest declares,
    /// which is the set the user is shown before confirming.  The grant is
    /// derived here rather than passed in, so a plugin can never end up holding
    /// a capability it did not declare, and can never be enabled while missing
    /// one it did.
    pub fn set_enabled(&self, plugin_id: &str, enabled: bool) -> Result<(), String> {
        let installation = self
            .get_installed(plugin_id)?
            .ok_or_else(|| format!("Plugin \"{plugin_id}\" is not installed"))?;

        let mut state = self.load_state()?;
        state.enabled.insert(plugin_id.to_string(), enabled);
        if enabled {
            state.granted.insert(
                plugin_id.to_string(),
                installation.manifest.requested_capabilities.clone(),
            );
        } else {
            // Disabling revokes the grant; re-enabling asks again.
            state.granted.remove(plugin_id);
        }
        self.save_state(&state)
    }

    // -- document access -----------------------------------------------------

    /// Read a page document from an enabled plugin.
    pub fn read_page(&self, plugin_id: &str, page: &str) -> Result<serde_json::Value, String> {
        self.read_document(plugin_id, &format!("pages/{page}.json"))
    }

    /// Read a workflow document from an enabled plugin.
    pub fn read_workflow(
        &self,
        plugin_id: &str,
        workflow: &str,
    ) -> Result<serde_json::Value, String> {
        self.read_document(plugin_id, &format!("workflows/{workflow}.json"))
    }

    /// Read a contribution document (slot or hook) from an enabled plugin.
    pub fn read_contribution(
        &self,
        plugin_id: &str,
        kind: &str,
        id: &str,
    ) -> Result<serde_json::Value, String> {
        if kind != "slots" && kind != "hooks" {
            return Err(format!("Unknown contribution kind \"{kind}\""));
        }
        super::manifest::validate_entry_id(id)?;
        self.read_document(plugin_id, &format!("{kind}/{id}.json"))
    }

    fn read_document(&self, plugin_id: &str, relative: &str) -> Result<serde_json::Value, String> {
        super::manifest::validate_plugin_id(plugin_id)?;
        let installation = self
            .get_installed(plugin_id)?
            .ok_or_else(|| format!("Plugin \"{plugin_id}\" is not installed"))?;
        if !installation.enabled {
            return Err(format!("Plugin \"{plugin_id}\" is not enabled"));
        }

        let version_dir = self.version_dir(plugin_id, &installation.manifest.version);
        let index_path = version_dir.join("META-INF").join("files.json");
        let index_bytes = fs::read(&index_path)
            .map_err(|e| format!("Plugin \"{plugin_id}\" is missing its file index: {e}"))?;
        let index: FileIndex = serde_json::from_slice(&index_bytes)
            .map_err(|e| format!("Plugin \"{plugin_id}\" has an invalid file index: {e}"))?;

        // Re-read the whole installed set so an on-disk edit is caught before
        // the document is handed to the renderer.
        let mut files = BTreeMap::new();
        for entry in &index.files {
            let path = package::safe_join(&version_dir, &entry.path)?;
            let bytes = fs::read(&path)
                .map_err(|e| format!("Plugin \"{plugin_id}\" is missing \"{}\": {e}", entry.path))?;
            files.insert(entry.path.clone(), bytes);
        }
        package::verify_installed_files(&files, &index)?;

        let bytes = files
            .get(relative)
            .ok_or_else(|| format!("Plugin \"{plugin_id}\" has no document \"{relative}\""))?;
        serde_json::from_slice(bytes)
            .map_err(|e| format!("Plugin document \"{relative}\" is not valid JSON: {e}"))
    }

    // -- plugin storage ------------------------------------------------------

    /// Read a value from a plugin's private key-value store.
    pub fn storage_get(&self, plugin_id: &str, key: &str) -> Result<Option<String>, String> {
        validate_storage_key(key)?;
        let state = self.load_state()?;
        Ok(state
            .storage
            .get(plugin_id)
            .and_then(|entries| entries.get(key))
            .cloned())
    }

    /// Write a value into a plugin's private key-value store.
    pub fn storage_set(&self, plugin_id: &str, key: &str, value: &str) -> Result<(), String> {
        validate_storage_key(key)?;
        if value.len() > MAX_STORAGE_VALUE_BYTES {
            return Err(format!(
                "Value for \"{key}\" is {} bytes, which exceeds the {MAX_STORAGE_VALUE_BYTES} byte limit",
                value.len()
            ));
        }

        let mut state = self.load_state()?;
        let entries = state.storage.entry(plugin_id.to_string()).or_default();

        let existing_without_key: usize = entries
            .iter()
            .filter(|(existing, _)| existing.as_str() != key)
            .map(|(_, existing)| existing.len())
            .sum();
        if existing_without_key + value.len() > MAX_STORAGE_TOTAL_BYTES {
            return Err(format!(
                "Plugin \"{plugin_id}\" would exceed its {MAX_STORAGE_TOTAL_BYTES} byte storage budget"
            ));
        }

        entries.insert(key.to_string(), value.to_string());
        self.save_state(&state)
    }

    /// Remove a value from a plugin's private store.
    pub fn storage_remove(&self, plugin_id: &str, key: &str) -> Result<(), String> {
        validate_storage_key(key)?;
        let mut state = self.load_state()?;
        if let Some(entries) = state.storage.get_mut(plugin_id) {
            entries.remove(key);
        }
        self.save_state(&state)
    }

    /// Drop every key a plugin stored.
    pub fn storage_clear(&self, plugin_id: &str) -> Result<(), String> {
        let mut state = self.load_state()?;
        state.storage.remove(plugin_id);
        self.save_state(&state)
    }
}

fn validate_storage_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 128 {
        return Err("Storage key must be between 1 and 128 bytes".into());
    }
    if !key
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' || ch == ':')
    {
        return Err(format!("Storage key \"{key}\" contains invalid characters"));
    }
    Ok(())
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0_u64;
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            total = total.saturating_add(directory_size(&entry.path()));
        } else {
            total = total.saturating_add(metadata.len());
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    fn store() -> (ComExtStore, tempfile::TempDir) {
        let directory = tempfile::tempdir().unwrap();
        let settings = crate::db::settings::SettingsStore::new(crate::db::open_in_memory().unwrap());
        (
            ComExtStore::new(settings, directory.path(), "0.51.1"),
            directory,
        )
    }

    fn package_manifest(id: &str, capabilities: &str) -> String {
        format!(
            r#"{{
                "format": "cfmscomext",
                "schema_version": 1,
                "id": "{id}",
                "name": "Test Plugin",
                "description": "Used by store tests",
                "publisher": "tests",
                "version": "1.0.0",
                "com_ext_api": "1.0.0",
                "min_client_version": "0.51.1",
                "requested_capabilities": [{capabilities}],
                "entrypoints": {{
                    "pages": [{{ "id": "home", "label": "Home", "page": "home" }}]
                }},
                "background_triggers": []
            }}"#
        )
    }

    /// Build a package whose manifest is patched by `mutate` before zipping.
    fn package_with_manifest(
        id: &str,
        capabilities: &str,
        mutate: impl Fn(String) -> String,
    ) -> Vec<u8> {
        let manifest = mutate(package_manifest(id, capabilities));
        let mut buffer = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(Cursor::new(&mut buffer));
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file("com_ext.json", options).unwrap();
            writer.write_all(manifest.as_bytes()).unwrap();
            writer.start_file("pages/home.json", options).unwrap();
            writer
                .write_all(br#"{"schema_version":1,"title":"Home","blocks":[]}"#)
                .unwrap();
            writer.finish().unwrap();
        }
        buffer
    }

    fn package(id: &str, capabilities: &str) -> Vec<u8> {
        package_with_manifest(id, capabilities, |manifest| manifest)
    }

    #[test]
    fn installs_and_lists_a_plugin() {
        let (store, _directory) = store();
        let installed = store
            .install_package(&package("org.example.test", r#""files.list""#))
            .expect("install should succeed");

        assert_eq!(installed.manifest.id, "org.example.test");
        assert!(!installed.enabled, "a fresh install must be disabled");

        let listed = store.list_installed().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].manifest.id, "org.example.test");
    }

    #[test]
    fn writes_package_files_under_its_own_root() {
        let (store, directory) = store();
        store
            .install_package(&package("org.example.test", r#""files.list""#))
            .unwrap();

        let installed_dir = store.version_dir("org.example.test", "1.0.0");
        assert!(installed_dir.join("com_ext.json").is_file());
        assert!(installed_dir.join("pages").join("home.json").is_file());
        assert!(installed_dir.join("META-INF").join("files.json").is_file());
        assert!(
            installed_dir.starts_with(directory.path().join("com_ext")),
            "packages must live under <app_data>/com_ext"
        );
    }

    #[test]
    fn enabling_grants_exactly_the_declared_capabilities() {
        let (store, _directory) = store();
        store
            .install_package(&package(
                "org.example.test",
                r#""files.list","tasks.read""#,
            ))
            .unwrap();

        store.set_enabled("org.example.test", true).unwrap();
        let installation = store.get_installed("org.example.test").unwrap().unwrap();
        assert!(installation.enabled);
        assert_eq!(
            installation.granted_capabilities,
            vec!["files.list".to_string(), "tasks.read".to_string()],
            "the grant must mirror the manifest exactly"
        );
    }

    #[test]
    fn disabling_revokes_the_grant() {
        let (store, _directory) = store();
        store
            .install_package(&package("org.example.test", r#""files.list""#))
            .unwrap();
        store.set_enabled("org.example.test", true).unwrap();
        store.set_enabled("org.example.test", false).unwrap();

        let installation = store.get_installed("org.example.test").unwrap().unwrap();
        assert!(!installation.enabled);
        assert!(
            installation.granted_capabilities.is_empty(),
            "disabling must revoke the grant"
        );
    }

    #[test]
    fn reads_documents_only_while_enabled() {
        let (store, _directory) = store();
        store
            .install_package(&package("org.example.test", r#""files.list""#))
            .unwrap();

        let error = store
            .read_page("org.example.test", "home")
            .expect_err("a disabled plugin must not serve pages");
        assert!(error.contains("not enabled"), "got: {error}");

        store.set_enabled("org.example.test", true).unwrap();
        let page = store.read_page("org.example.test", "home").unwrap();
        assert_eq!(page["title"], "Home");
    }

    #[test]
    fn detects_a_page_edited_on_disk() {
        let (store, _directory) = store();
        store
            .install_package(&package("org.example.test", r#""files.list""#))
            .unwrap();
        store.set_enabled("org.example.test", true).unwrap();

        let page_path = store
            .version_dir("org.example.test", "1.0.0")
            .join("pages")
            .join("home.json");
        // Same byte length as the original, so only the digest can catch it.
        fs::write(
            &page_path,
            br#"{"schema_version":1,"title":"Evil","blocks":[]}"#,
        )
        .unwrap();

        let error = store
            .read_page("org.example.test", "home")
            .expect_err("on-disk edits must be caught");
        assert!(error.contains("modified after installation"), "got: {error}");
    }

    #[test]
    fn uninstall_removes_files_and_state() {
        let (store, _directory) = store();
        store
            .install_package(&package("org.example.test", r#""files.list""#))
            .unwrap();
        store.storage_set("org.example.test", "k", "v").unwrap();

        store.uninstall("org.example.test").unwrap();
        assert!(store.list_installed().unwrap().is_empty());
        assert!(!store.plugin_dir("org.example.test").exists());
        assert_eq!(store.storage_get("org.example.test", "k").unwrap(), None);
    }

    #[test]
    fn reinstalling_drops_the_previous_grant() {
        let (store, _directory) = store();
        store
            .install_package(&package("org.example.test", r#""files.list""#))
            .unwrap();
        store.set_enabled("org.example.test", true).unwrap();

        store
            .install_package(&package("org.example.test", r#""files.list""#))
            .unwrap();

        let installation = store.get_installed("org.example.test").unwrap().unwrap();
        assert!(
            !installation.enabled,
            "a new version must require approval again"
        );
        assert!(installation.granted_capabilities.is_empty());
    }

    #[test]
    fn rejects_a_plugin_that_requires_a_newer_client() {
        let (store, _directory) = store();
        let bytes = package_with_manifest("org.example.test", r#""files.list""#, |manifest| {
            manifest.replace("\"0.51.1\"", "\"99.0.0\"")
        });

        let error = store
            .install_package(&bytes)
            .expect_err("must refuse a plugin needing a newer client");
        assert!(error.contains("requires client version"), "got: {error}");
        assert!(error.contains("99.0.0"), "got: {error}");
    }

    #[test]
    fn accepts_a_plugin_with_an_empty_min_client_version() {
        let (store, _directory) = store();
        let bytes = package_with_manifest("org.example.test", r#""files.list""#, |manifest| {
            manifest.replace("\"0.51.1\"", "\"\"")
        });
        store
            .install_package(&bytes)
            .expect("an unversioned requirement should install");
    }

    #[test]
    fn storage_is_private_per_plugin_and_quota_bounded() {
        let (store, _directory) = store();
        store
            .install_package(&package("org.example.test", r#""files.list""#))
            .unwrap();
        store
            .install_package(&package("org.example.other", r#""files.list""#))
            .unwrap();

        store
            .storage_set("org.example.test", "shared", "from-test")
            .unwrap();
        assert_eq!(
            store.storage_get("org.example.test", "shared").unwrap(),
            Some("from-test".to_string())
        );
        assert_eq!(
            store.storage_get("org.example.other", "shared").unwrap(),
            None,
            "plugins must not see each other's storage"
        );

        let oversize = "x".repeat(MAX_STORAGE_VALUE_BYTES + 1);
        let error = store
            .storage_set("org.example.test", "big", &oversize)
            .expect_err("must refuse an oversize value");
        assert!(error.contains("exceeds"), "got: {error}");

        let error = store
            .storage_set("org.example.test", "bad key!", "v")
            .expect_err("must refuse an invalid key");
        assert!(error.contains("invalid characters"), "got: {error}");
    }

    #[test]
    fn storage_remove_and_clear_are_scoped_to_one_plugin() {
        let (store, _directory) = store();
        store.storage_set("org.example.test", "a", "1").unwrap();
        store.storage_set("org.example.test", "b", "2").unwrap();
        store.storage_set("org.example.other", "a", "1").unwrap();

        store.storage_remove("org.example.test", "a").unwrap();
        assert_eq!(store.storage_get("org.example.test", "a").unwrap(), None);
        assert_eq!(
            store.storage_get("org.example.test", "b").unwrap(),
            Some("2".to_string())
        );

        store.storage_clear("org.example.test").unwrap();
        assert_eq!(store.storage_get("org.example.test", "b").unwrap(), None);
        assert_eq!(
            store.storage_get("org.example.other", "a").unwrap(),
            Some("1".to_string()),
            "clearing one plugin must not touch another"
        );
    }

    #[test]
    fn unknown_plugin_lookups_are_reported_not_silently_empty() {
        let (store, _directory) = store();
        assert!(store.get_installed("org.example.absent").unwrap().is_none());
        let error = store
            .read_page("org.example.absent", "home")
            .expect_err("must be reported");
        assert!(error.contains("not installed"), "got: {error}");
        let error = store
            .set_enabled("org.example.absent", true)
            .expect_err("must be reported");
        assert!(error.contains("not installed"), "got: {error}");
    }

    #[test]
    fn rejects_a_path_traversing_plugin_id() {
        let (store, _directory) = store();
        let error = store
            .read_page("../../../etc", "home")
            .expect_err("must be rejected");
        assert!(
            error.contains("invalid characters") || error.contains("reverse-domain"),
            "got: {error}"
        );
    }

    // -- coexistence with the official interface -----------------------------

    #[test]
    fn installs_beside_the_official_extension_store_without_interference() {
        let directory = tempfile::tempdir().unwrap();
        let settings = crate::db::settings::SettingsStore::new(crate::db::open_in_memory().unwrap());

        let community = ComExtStore::new(settings.clone(), directory.path(), "0.51.1");
        let official =
            crate::extensions::ExtensionStore::new(settings.clone(), directory.path(), "0.51.1");

        // The two systems must never share a storage root.
        assert_eq!(community.root(), directory.path().join("com_ext"));
        assert_ne!(community.root(), directory.path().join("extensions"));

        // The official store reads its own table plus its compiled-in bundled
        // extensions, so it is not necessarily empty. What matters is that the
        // community install changes nothing about it.
        let official_before = official.list_installed().unwrap();
        community
            .install_package(&package("org.example.test", r#""files.list""#))
            .unwrap();
        community.set_enabled("org.example.test", true).unwrap();
        let official_after = official.list_installed().unwrap();

        assert_eq!(
            official_before.len(),
            official_after.len(),
            "a community install must not change the official extension listing"
        );
        assert!(
            official_after
                .iter()
                .all(|installation| installation.manifest.id != "org.example.test"),
            "a community plugin must not surface in the official extension store"
        );
        assert_eq!(community.list_installed().unwrap().len(), 1);

        // Community state is written under its own settings key, leaving the
        // official tables and preference keys alone.
        assert!(
            settings.get("com_ext.state").unwrap().is_some(),
            "community state must persist under its own key"
        );
        assert!(
            settings.get("extensions").unwrap().is_none(),
            "the community store must not write the official preferences key"
        );

        // Nothing was written under the official packages root.
        assert!(
            !directory
                .path()
                .join("extensions")
                .join("packages")
                .exists(),
            "the community install must not touch the official packages directory"
        );
    }

    #[test]
    fn ignores_files_left_in_the_official_extensions_root() {
        let directory = tempfile::tempdir().unwrap();
        let settings = crate::db::settings::SettingsStore::new(crate::db::open_in_memory().unwrap());
        let community = ComExtStore::new(settings, directory.path(), "0.51.1");

        // Simulate an official installation on disk.
        let official_package = directory
            .path()
            .join("extensions")
            .join("packages")
            .join("org.example.official")
            .join("1.0.0");
        fs::create_dir_all(&official_package).unwrap();
        fs::write(
            official_package.join("manifest.json"),
            br#"{"id":"org.example.official"}"#,
        )
        .unwrap();

        assert!(
            community.list_installed().unwrap().is_empty(),
            "the community store must not enumerate the official packages root"
        );
        let error = community
            .read_page("org.example.official", "home")
            .expect_err("official packages are not community plugins");
        assert!(error.contains("not installed"), "got: {error}");
    }
}
