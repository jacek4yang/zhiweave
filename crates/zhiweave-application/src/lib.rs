//! Application use cases shared by every `ZhiWeave` client.

use serde::Serialize;
use zhiweave_protocol::{PROTOCOL_ID, PROTOCOL_VERSION};

/// Read-only status returned to the cross-platform shell.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    /// Product display name.
    pub product: &'static str,
    /// New standalone protocol identity.
    pub protocol: &'static str,
    /// Numeric protocol version.
    pub protocol_version: u16,
    /// Honest maturity label.
    pub stage: &'static str,
    /// Whether any Obsidian runtime is involved.
    pub obsidian_dependency: bool,
}

/// Returns immutable build identity for the first vertical slice.
#[must_use]
pub const fn system_status() -> SystemStatus {
    SystemStatus {
        product: "知织 / ZhiWeave",
        protocol: PROTOCOL_ID,
        protocol_version: PROTOCOL_VERSION,
        stage: "cross-platform architecture spike",
        obsidian_dependency: false,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn standalone_product_has_no_obsidian_dependency() {
        let status = super::system_status();
        assert_eq!(status.protocol, "ZHIWEAVE/1");
        assert!(!status.obsidian_dependency);
    }
}
