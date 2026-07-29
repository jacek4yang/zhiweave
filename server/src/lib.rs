//! Minimal standalone server boundary for the cross-platform spike.

use axum::{Json, Router, routing::get};
use serde::Serialize;
use zhiweave_application::system_status;

/// Public health response. It contains no vault or device data.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    /// Product identity.
    pub product: &'static str,
    /// Standalone protocol identity.
    pub protocol: &'static str,
    /// Service readiness.
    pub status: &'static str,
}

/// Creates the HTTP router.
pub fn router() -> Router {
    Router::new().route("/health", get(health))
}

async fn health() -> Json<Health> {
    let identity = system_status();
    Json(Health {
        product: identity.product,
        protocol: identity.protocol,
        status: "architecture-spike",
    })
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn health_exposes_only_standalone_build_identity() {
        let response = super::router()
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), 4_096).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["protocol"], "ZHIWEAVE/1");
        assert_eq!(value["status"], "architecture-spike");
        assert!(value.get("vault").is_none());
    }
}
