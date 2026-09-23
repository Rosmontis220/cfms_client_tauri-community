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

/// Regions a package may render one of its page documents into.
///
/// A slot contribution is a page document the host embeds in one of its own
/// screens, so these points name *where the document appears*. Points that name
/// a command rather than a region — a toolbar button, a context-menu entry, a
/// file row — belong to [`COM_EXT_ACTION_POINTS`] instead.
///
/// Sidebar entries and standalone pages are deliberately absent: they carry a
/// label and an order the host needs, so they have their own entrypoint lists.
pub const COM_EXT_SLOT_POINTS: &[&str] = &[
    "overview-section",
    "settings-section",
];

/// Host surfaces a package may add a command to.
///
/// An action contribution names a workflow rather than a document, so it runs
/// when the user picks it instead of rendering anywhere.
///
/// Per-row surfaces are deliberately absent. A row contribution needs one value
/// per visible file, and a declarative workflow cannot compute that: the
/// expression vocabulary has no way to map over a listing, and asking the host
/// once per row would put an IPC round trip on every row of a virtualised
/// table. Both points therefore fail validation here rather than being accepted
/// and then silently ignored.
pub const COM_EXT_ACTION_POINTS: &[&str] = &[
    "file-toolbar",
    "file-context-menu",
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

/// Longest accepted plugin identifier.
const MAX_ID_LEN: usize = 128;
/// Longest accepted entrypoint identifier.
const MAX_ENTRY_ID_LEN: usize = 64;
/// Longest accepted display name.
const MAX_NAME_LEN: usize = 64;
/// Longest accepted description.
const MAX_DESCRIPTION_LEN: usize = 512;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
    /// Scheduled and event-driven workflows. Not honoured yet: a non-empty
    /// list is rejected rather than accepted and ignored.
    #[serde(default)]
    pub background_triggers: Vec<ComExtBackgroundTrigger>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
    /// Wholesale replacements of host surfaces. Not honoured yet: a non-empty
    /// list is rejected rather than accepted and ignored.
    #[serde(default)]
    pub overrides: Vec<ComExtOverrideEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
pub struct ComExtPageEntry {
    pub id: String,
    pub label: String,
    /// Page id inside this package.
    pub page: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
pub struct ComExtActionEntry {
    pub id: String,
    pub label: String,
    /// Workflow id inside this package.
    pub workflow: String,
    /// Surface the action appears on; one of [`COM_EXT_ACTION_POINTS`].
    pub point: String,
    #[serde(default)]
    pub tone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComExtHookEntry {
    pub id: String,
    /// One of [`COM_EXT_HOOK_POINTS`].
    pub point: String,
    /// Workflow id inside this package.
    pub workflow: String,
}

/// A wholesale replacement of a host surface.
///
/// The shape is reserved but not honoured: [`validate_entrypoints`] refuses a
/// non-empty override list, so a package that declares one fails to install
/// rather than installing and doing nothing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComExtOverrideEntry {
    pub id: String,
    /// Surface kind, e.g. `page` or `component`.
    pub point: String,
    /// Host surface being replaced, e.g. `/home/chat`.
    pub target: String,
    /// Page document to render in its place.
    pub page: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
    // Ids are unique within a list, not across lists. A navigation entry and a
    // page are different surfaces reached different ways, so an author who
    // names both after the feature they describe is doing the obvious thing,
    // not making a mistake worth refusing.
    fn unique<'a>(
        ids: &mut std::collections::BTreeSet<&'a str>,
        id: &'a str,
    ) -> Result<(), String> {
        if ids.insert(id) {
            Ok(())
        } else {
            Err(format!("Duplicate entrypoint id \"{id}\""))
        }
    }

    let mut navigation = std::collections::BTreeSet::new();
    for entry in &entrypoints.navigation {
        validate_entry_id(&entry.id)?;
        validate_display_string(&entry.label, "navigation label", MAX_NAME_LEN)?;
        validate_entry_id(&entry.page)?;
        unique(&mut navigation, &entry.id)?;
    }

    let mut settings = std::collections::BTreeSet::new();
    for entry in &entrypoints.settings {
        validate_entry_id(&entry.id)?;
        validate_display_string(&entry.label, "settings label", MAX_NAME_LEN)?;
        validate_entry_id(&entry.page)?;
        unique(&mut settings, &entry.id)?;
    }

    let mut pages = std::collections::BTreeSet::new();
    for entry in &entrypoints.pages {
        validate_entry_id(&entry.id)?;
        validate_display_string(&entry.label, "page label", MAX_NAME_LEN)?;
        validate_entry_id(&entry.page)?;
        unique(&mut pages, &entry.id)?;
    }

    let mut slots = std::collections::BTreeSet::new();
    for entry in &entrypoints.slots {
        validate_entry_id(&entry.id)?;
        validate_entry_id(&entry.page)?;
        if !COM_EXT_SLOT_POINTS.contains(&entry.point.as_str()) {
            return Err(format!(
                "Unknown slot point \"{}\"; this host renders {}",
                entry.point,
                COM_EXT_SLOT_POINTS.join(", ")
            ));
        }
        unique(&mut slots, &entry.id)?;
    }

    let mut actions = std::collections::BTreeSet::new();
    for entry in &entrypoints.actions {
        validate_entry_id(&entry.id)?;
        validate_display_string(&entry.label, "action label", MAX_NAME_LEN)?;
        validate_entry_id(&entry.workflow)?;
        if !COM_EXT_ACTION_POINTS.contains(&entry.point.as_str()) {
            return Err(format!(
                "Unknown action point \"{}\"; this host renders {}",
                entry.point,
                COM_EXT_ACTION_POINTS.join(", ")
            ));
        }
        unique(&mut actions, &entry.id)?;
    }

    let mut hooks = std::collections::BTreeSet::new();
    for entry in &entrypoints.hooks {
        validate_entry_id(&entry.id)?;
        validate_entry_id(&entry.workflow)?;
        if !COM_EXT_HOOK_POINTS.contains(&entry.point.as_str()) {
            return Err(format!("Unknown hook point \"{}\"", entry.point));
        }
        unique(&mut hooks, &entry.id)?;
    }

    // Overrides replace a host surface rather than adding to it, and the host
    // has no seam for that yet. A declared override would silently do nothing,
    // so it is refused instead.
    if !entrypoints.overrides.is_empty() {
        return Err(format!(
            "Override contributions are not supported by this host version yet; found {}",
            entrypoints.overrides.len()
        ));
    }

    Ok(())
}

/// Refuse background triggers.
///
/// The host can describe a trigger but never runs one: there is no scheduler
/// and no host event bus behind them. Accepting them would leave a plugin doing
/// nothing on a schedule its author believed in, so they are refused outright
/// until that machinery exists. `onLogin` and `onLogout` are the hooks that do
/// run today.
fn validate_triggers(triggers: &[ComExtBackgroundTrigger]) -> Result<(), String> {
    if triggers.is_empty() {
        return Ok(());
    }
    Err(format!(
        "Background triggers are not supported by this host version yet; found {}. \
         Use the onLogin and onLogout hooks instead.",
        triggers.len()
    ))
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
