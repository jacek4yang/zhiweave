//! Wire-level identity for the standalone `ZhiWeave` product.

/// Human-readable protocol identity included in handshakes and health checks.
pub const PROTOCOL_ID: &str = "ZHIWEAVE/1";

/// First intentionally standalone protocol version.
pub const PROTOCOL_VERSION: u16 = 1;

#[cfg(test)]
mod tests {
    #[test]
    fn protocol_is_not_a_learning_loop_compatibility_alias() {
        assert_eq!(super::PROTOCOL_ID, "ZHIWEAVE/1");
        assert_eq!(super::PROTOCOL_VERSION, 1);
    }
}
