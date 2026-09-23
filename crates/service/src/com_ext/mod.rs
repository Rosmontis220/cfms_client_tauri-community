//! Community plugin system — the `com_ext` interface.
//!
//! This is a **parallel** plugin surface to the official [`crate::extensions`]
//! one.  The two are deliberately independent and share no state:
//!
//! | | official | community |
//! |---|---|---|
//! | package | `.cfmsext` | `.cfmscomext` |
//! | manifest | `manifest.json` | `com_ext.json` |
//! | storage root | `<app_data>/extensions` | `<app_data>/com_ext` |
//! | enable state | per-user preferences | device-global settings key |
//! | trust | ed25519 signature + trusted keys | none |
//!
//! Nothing here reads or writes anything under [`crate::extensions`], so the
//! official interface keeps working exactly as upstream ships it and official
//! packages stay installable alongside community ones.
//!
//! # Trust model
//!
//! Community packages are **not** signed and there is no catalog, revocation
//! list, or trusted-key allowlist.  That is a deliberate product decision for a
//! distribution limited to a known group of users.
//!
//! What is *not* relaxed is structural safety, because those failures corrupt a
//! user's machine rather than merely trusting the wrong author:
//!
//! - ZIP entry paths must pass a strict allowlist and can never escape the
//!   package's own storage directory (ZIP-slip),
//! - symbolic links are rejected outright,
//! - archive, expanded, per-file, and file-count limits are enforced while
//!   reading, so a crafted archive cannot exhaust memory or disk,
//! - declarative documents are re-validated on every read.
//!
//! # Package layout
//!
//! ```text
//! plugin.cfmscomext (ZIP)
//! ├── com_ext.json          manifest (also the format marker)
//! ├── pages/<id>.json       declarative pages
//! ├── workflows/<id>.json   declarative workflows
//! ├── slots/<id>.json       UI slot contributions
//! └── hooks/<id>.json       flow hook contributions
//! ```

mod manifest;
mod package;
mod store;

pub use manifest::{
    ComExtActionEntry, ComExtBackgroundTrigger, ComExtEntrypoints, ComExtHookEntry,
    ComExtManifest, ComExtNavigationEntry, ComExtOverrideEntry, ComExtPageEntry, ComExtSlotEntry,
};
pub use package::ValidatedComExtPackage;
pub use store::{ComExtInstallation, ComExtPageSource, ComExtStore};

/// Version of the host API this build implements.
///
/// Packages declare the version they were written against in
/// [`ComExtManifest::com_ext_api`]; the loader rejects packages that ask for a
/// newer major line than the host can honour.
pub const COM_EXT_API_VERSION: &str = "1.0.0";

/// Package file extension, without the leading dot.
pub const COM_EXT_PACKAGE_EXTENSION: &str = "cfmscomext";

/// Name of the manifest entry inside a package.
///
/// Deliberately different from the official `manifest.json`: a `.cfmsext`
/// package that someone renames to `.cfmscomext` then fails immediately with a
/// clear "not a community package" error instead of being half-installed under
/// the wrong format's rules.
pub const COM_EXT_MANIFEST_FILENAME: &str = "com_ext.json";

/// The only `format` value a community manifest may declare.
pub const COM_EXT_FORMAT: &str = "cfmscomext";

/// Path of the on-disk integrity index inside an installed package.
///
/// The index never describes itself. Its own digest would have to change the
/// moment it was written, so there is no value it could record and still be
/// correct; both the packer and the host therefore leave this path out, and
/// every comparison between an index and a file set must exclude it too.
pub const COM_EXT_FILES_INDEX_PATH: &str = "META-INF/files.json";

/// Capabilities a community package may request.
///
/// This list is owned by this module and evolves independently of the official
/// [`crate::extensions`] capability set.
pub const COM_EXT_CAPABILITIES: &[&str] = &[
    "files.list",
    "files.metadata.read",
    "files.search",
    "files.open",
    "tasks.read",
    "transfers.download.enqueue",
    "account.summary.read",
    "events.subscribe",
    "ui.notify",
    "ui.confirm",
    "storage.read",
    "storage.write",
];

/// Largest accepted package file, before decompression.
pub(crate) const MAX_PACKAGE_BYTES: usize = 32 * 1024 * 1024;
/// Largest total size a package may expand to.
pub(crate) const MAX_EXPANDED_BYTES: u64 = 64 * 1024 * 1024;
/// Largest single non-JSON file.
pub(crate) const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
/// Largest single JSON document.
pub(crate) const MAX_JSON_BYTES: u64 = 4 * 1024 * 1024;
/// Largest number of entries in a package.
pub(crate) const MAX_FILES: usize = 512;
/// Largest value a plugin may store under a single storage key.
pub const MAX_STORAGE_VALUE_BYTES: usize = 256 * 1024;
/// Largest total storage a single plugin may occupy.
pub const MAX_STORAGE_TOTAL_BYTES: usize = 4 * 1024 * 1024;
