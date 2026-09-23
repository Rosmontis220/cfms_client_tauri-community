//! `com_ext.json` — the community package manifest, and its validation.
//!
//! The manifest is both the package's metadata and its **format marker**: the
//! `format` field must equal [`COM_EXT_FORMAT`], which is what makes a renamed
//! official `.cfmsext` package fail fast instead of being loaded under the
//! wrong rules.

use semver::Version;
use serde::{Deserialize, Serialize};

use super::{
    COM_EXT_API_VERSION, COM_EXT_CAPABILITIES, COM_EXT_FORMAT,
};

/// UI extension points a package may contribute to.
pub const COM_EXT_SLOT_POINTS: &[&str] = &[
    "navigation",
    "settings-section",
    "page",
    "file-row-trailing",
    "file-row-status",
    "file-toolbar",
    "file-context-menu",
    "overview-section",
];

/// Flow hooks a package may attach to.
///
/// `beforeDocumentOpen` is the only *intercepting* hook: the host waits for its
/// result and honours `allow` / `deny` / `handled`.
pub const COM_EXT_HOOK_POINTS: &[&str] = &[
    "beforeDocumentOpen",
    "afterDownloadEnqueue",
    "onLogin",
    "onLogout",
];

/// Core surfaces a package may override wholesale.
///
/// Overrides replace a host page or component rather than adding to it, so they
/// are the most invasive contribution the interface offers.
pub const COM_EXT_OVERRIDE_POINTS: &[&str] = &["page", "component"];

/// Longest accepted plugin identifier.
const MAX_ID_LEN: usize = 128;
/// Longest accepted entrypoint identifier.
const MAX_ENTRY_ID_LEN: usize = 64;
/// Longest accepted display name.
const MAX_NAME_LEN: usize = 64;
/// Longest accepted description.
const MAX_DESCRIPTION_LEN: usize = 512;
/// Bounds on a periodic background trigger.
const MIN_INTERVAL_MINUTES: u32 = 1;
const MAX_INTERVAL_MINUTES: u32 = 24 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComExtManifest {
    /// Must be [`COM_EXT_FORMAT`].
    pub format: String,
    /// Manifest schema revision; currently only `1` is understood.
    pub schema_version: u32,
    /// Reverse-domain identifier, e.g. `org.example.tools`.
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub publisher: String,
    /// Package version, semver.
    pub version: String,
    /// Host API line the package was written against, semver.
    pub com_ext_api: String,
    /// Lowest client version this package supports, semver. Empty means any.
    #[serde(default)]
    pub min_client_version: String,
    #[serde(default)]
    pub requested_capabilities: Vec<String>,
    #[serde(default)]
    pub entrypoints: ComExtEntrypoints,
    #[serde(default)]
    pub background_triggers: Vec<ComExtBackgroundTrigger>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ComExtEntrypoints {
    /// Entries added to the app's main navigation.
    #[serde(default)]
    pub navigation: Vec<ComExtNavigationEntry>,
    /// Entries added to the settings index.
    #[serde(default)]
    pub settings: Vec<ComExtPageEntry>,
    /// Standalone pages, reachable at `/home/com-ext/<id>/<page>`.
    #[serde(default)]
    pub pages: Vec<ComExtPageEntry>,
    /// Contributions into host UI slots.
    #[serde(default)]
    pub slots: Vec<ComExtSlotEntry>,
    /// Actions the host exposes on selected objects.
    #[serde(default)]
    pub actions: Vec<ComExtActionEntry>,
    /// Flow hooks.
    #[serde(default)]
    pub hooks: Vec<ComExtHookEntry>,
    /// Wholesale replacements of host surfaces.
    #[serde(default)]
    pub overrides: Vec<ComExtOverrideEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComExtNavigationEntry {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub icon: String,
    /// Page id inside this package.
    pub page: String,
    /// Optional ordering hint; lower sorts first.
    #[serde(default)]
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComExtPageEntry {
    pub id: String,
    pub label: String,
    /// Page id inside this package.
    pub page: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComExtSlotEntry {
    pub id: String,
    /// One of [`COM_EXT_SLOT_POINTS`].
    pub point: String,
    /// Page document describing what to render.
    pub page: String,
    /// Optional ordering hint; lower sorts first.
    #[serde(default)]
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComExtActionEntry {
    pub id: String,
    pub label: String,
    /// Workflow id inside this package.
    pub workflow: String,
    /// Slot the action appears in; one of [`COM_EXT_SLOT_POINTS`].
    #[serde(default)]
    pub point: String,
    #[serde(default)]
    pub tone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComExtHookEntry {
    pub id: String,
    /// One of [`COM_EXT_HOOK_POINTS`].
    pub point: String,
    /// Workflow id inside this package.
    pub workflow: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComExtOverrideEntry {
    pub id: String,
    /// One of [`COM_EXT_OVERRIDE_POINTS`].
    pub point: String,
    /// Host surface being replaced, e.g. `/home/chat`.
    pub target: String,
    /// Page document to render in its place.
    pub page: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ComExtBackgroundTrigger {
    /// Runs once when the plugin is enabled.
    OnEnable { workflow: String },
    /// Runs once per sign-in.
    OnLogin { workflow: String },
    /// Runs every `minutes`.
    Interval { workflow: String, minutes: u32 },
    /// Runs when the named host event fires.
    Event { workflow: String, event: String },
}

impl ComExtBackgroundTrigger {
    /// The workflow this trigger invokes.
    pub fn workflow(&self) -> &str {
        match self {
            Self::OnEnable { workflow }
            | Self::OnLogin { workflow }
            | Self::Interval { workflow, .. }
            | Self::Event { workflow, .. } => workflow,
        }
    }
}

/// Every page document id the manifest references, paired with its entry id.
pub fn referenced_pages(manifest: &ComExtManifest) -> Vec<(&str, &str)> {
    let mut out = Vec::new();
    for entry in &manifest.entrypoints.navigation {
        out.push((entry.id.as_str(), entry.page.as_str()));
    }
    for entry in &manifest.entrypoints.settings {
        out.push((entry.id.as_str(), entry.page.as_str()));
    }
    for entry in &manifest.entrypoints.pages {
        out.push((entry.id.as_str(), entry.page.as_str()));
    }
    for entry in &manifest.entrypoints.slots {
        out.push((entry.id.as_str(), entry.page.as_str()));
    }
    for entry in &manifest.entrypoints.overrides {
        out.push((entry.id.as_str(), entry.page.as_str()));
    }
    out
}

/// Every workflow document id the manifest references.
pub fn referenced_workflows(manifest: &ComExtManifest) -> Vec<(&str, &str)> {
    let mut out = Vec::new();
    for entry in &manifest.entrypoints.actions {
        out.push((entry.id.as_str(), entry.workflow.as_str()));
    }
    for entry in &manifest.entrypoints.hooks {
        out.push((entry.id.as_str(), entry.workflow.as_str()));
    }
    for trigger in &manifest.background_triggers {
        out.push(("background", trigger.workflow()));
    }
    out
}

/// Validate a manifest against the host's rules.
pub fn validate_manifest(manifest: &ComExtManifest) -> Result<(), String> {
    if manifest.format != COM_EXT_FORMAT {
        return Err(format!(
            "Not a community package: format must be \"{COM_EXT_FORMAT}\", found \"{}\"",
            manifest.format
        ));
    }
    if manifest.schema_version != 1 {
        return Err(format!(
            "Unsupported com_ext manifest schema version {}",
            manifest.schema_version
        ));
    }
    validate_plugin_id(&manifest.id)?;
    validate_display_string(&manifest.name, "name", MAX_NAME_LEN)?;
    validate_display_string(&manifest.description, "description", MAX_DESCRIPTION_LEN)?;
    validate_display_string(&manifest.publisher, "publisher", MAX_NAME_LEN)?;

    Version::parse(&manifest.version)
        .map_err(|e| format!("Invalid package version \"{}\": {e}", manifest.version))?;

    let api = Version::parse(&manifest.com_ext_api)
        .map_err(|e| format!("Invalid com_ext_api \"{}\": {e}", manifest.com_ext_api))?;
    let host = Version::parse(COM_EXT_API_VERSION)
        .map_err(|e| format!("Host API version is not valid semver: {e}"))?;
    if api.major > host.major {
        return Err(format!(
            "Package requires com_ext API {} but this build implements {}",
            manifest.com_ext_api, COM_EXT_API_VERSION
        ));
    }

    if !manifest.min_client_version.is_empty() {
        Version::parse(&manifest.min_client_version).map_err(|e| {
            format!(
                "Invalid min_client_version \"{}\": {e}",
                manifest.min_client_version
            )
        })?;
    }

    validate_capabilities(&manifest.requested_capabilities)?;
    validate_entrypoints(&manifest.entrypoints)?;
    validate_triggers(&manifest.background_triggers)?;
    Ok(())
}

fn validate_capabilities(capabilities: &[String]) -> Result<(), String> {
    let mut seen = std::collections::BTreeSet::new();
    for capability in capabilities {
        if !COM_EXT_CAPABILITIES.contains(&capability.as_str()) {
            return Err(format!(
                "Package requests unknown capability \"{capability}\""
            ));
        }
        if !seen.insert(capability.as_str()) {
            return Err(format!("Package requests capability \"{capability}\" twice"));
        }
    }
    Ok(())
}

fn validate_entrypoints(entrypoints: &ComExtEntrypoints) -> Result<(), String> {
    let mut ids = std::collections::BTreeSet::new();

    for entry in &entrypoints.navigation {
        validate_entry_id(&entry.id)?;
        validate_display_string(&entry.label, "navigation label", MAX_NAME_LEN)?;
        validate_entry_id(&entry.page)?;
        if !ids.insert(entry.id.as_str()) {
            return Err(format!("Duplicate entrypoint id \"{}\"", entry.id));
        }
    }
    for entry in &entrypoints.settings {
        validate_entry_id(&entry.id)?;
        validate_display_string(&entry.label, "settings label", MAX_NAME_LEN)?;
        validate_entry_id(&entry.page)?;
        if !ids.insert(entry.id.as_str()) {
            return Err(format!("Duplicate entrypoint id \"{}\"", entry.id));
        }
    }
    for entry in &entrypoints.pages {
        validate_entry_id(&entry.id)?;
        validate_display_string(&entry.label, "page label", MAX_NAME_LEN)?;
        validate_entry_id(&entry.page)?;
        if !ids.insert(entry.id.as_str()) {
            return Err(format!("Duplicate entrypoint id \"{}\"", entry.id));
        }
    }
    for entry in &entrypoints.slots {
        validate_entry_id(&entry.id)?;
        validate_entry_id(&entry.page)?;
        if !COM_EXT_SLOT_POINTS.contains(&entry.point.as_str()) {
            return Err(format!("Unknown slot point \"{}\"", entry.point));
        }
        if !ids.insert(entry.id.as_str()) {
            return Err(format!("Duplicate entrypoint id \"{}\"", entry.id));
        }
    }
    for entry in &entrypoints.actions {
        validate_entry_id(&entry.id)?;
        validate_display_string(&entry.label, "action label", MAX_NAME_LEN)?;
        validate_entry_id(&entry.workflow)?;
        if !entry.point.is_empty() && !COM_EXT_SLOT_POINTS.contains(&entry.point.as_str()) {
            return Err(format!("Unknown action point \"{}\"", entry.point));
        }
        if !ids.insert(entry.id.as_str()) {
            return Err(format!("Duplicate entrypoint id \"{}\"", entry.id));
        }
    }
    for entry in &entrypoints.hooks {
        validate_entry_id(&entry.id)?;
        validate_entry_id(&entry.workflow)?;
        if !COM_EXT_HOOK_POINTS.contains(&entry.point.as_str()) {
            return Err(format!("Unknown hook point \"{}\"", entry.point));
        }
        if !ids.insert(entry.id.as_str()) {
            return Err(format!("Duplicate entrypoint id \"{}\"", entry.id));
        }
    }
    for entry in &entrypoints.overrides {
        validate_entry_id(&entry.id)?;
        validate_entry_id(&entry.page)?;
        if !COM_EXT_OVERRIDE_POINTS.contains(&entry.point.as_str()) {
            return Err(format!("Unknown override point \"{}\"", entry.point));
        }
        if entry.target.is_empty() || entry.target.len() > 128 {
            return Err(format!("Invalid override target \"{}\"", entry.target));
        }
        if !ids.insert(entry.id.as_str()) {
            return Err(format!("Duplicate entrypoint id \"{}\"", entry.id));
        }
    }

    Ok(())
}

fn validate_triggers(triggers: &[ComExtBackgroundTrigger]) -> Result<(), String> {
    for trigger in triggers {
        validate_entry_id(trigger.workflow())?;
        if let ComExtBackgroundTrigger::Interval { minutes, .. } = trigger {
            if *minutes < MIN_INTERVAL_MINUTES || *minutes > MAX_INTERVAL_MINUTES {
                return Err(format!(
                    "Interval trigger must be between {MIN_INTERVAL_MINUTES} and \
                     {MAX_INTERVAL_MINUTES} minutes, found {minutes}"
                ));
            }
        }
        if let ComExtBackgroundTrigger::Event { event, .. } = trigger {
            if event.is_empty() || event.len() > 64 {
                return Err(format!("Invalid event name \"{event}\""));
            }
        }
    }
    Ok(())
}

fn validate_display_string(value: &str, label: &str, max: usize) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("Package {label} must not be empty"));
    }
    if value.len() > max {
        return Err(format!("Package {label} exceeds {max} bytes"));
    }
    if value.chars().any(|ch| ch.is_control()) {
        return Err(format!("Package {label} contains control characters"));
    }
    Ok(())
}

/// Reverse-domain plugin identifier: lowercase, digits and dashes per segment.
pub fn validate_plugin_id(value: &str) -> Result<(), String> {
    if value.len() < 3 || value.len() > MAX_ID_LEN || !value.contains('.') {
        return Err("Plugin id must be a reverse-domain identifier".into());
    }
    let valid = value.split('.').all(|part| {
        !part.is_empty()
            && part.len() <= 63
            && part
                .chars()
                .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
            && !part.starts_with('-')
            && !part.ends_with('-')
    });
    if !valid {
        return Err(format!("Plugin id \"{value}\" contains invalid characters"));
    }
    Ok(())
}

/// Entrypoint identifiers: lowercase letters, digits, dash, underscore.
pub fn validate_entry_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_ENTRY_ID_LEN
        || !value
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '_')
    {
        return Err(format!("Invalid entrypoint id \"{value}\""));
    }
    Ok(())
}
