use std::net::SocketAddr;

use anyhow::{Context, Result};

#[tokio::main]
async fn main() -> Result<()> {
    let address: SocketAddr = std::env::var("ZHIWEAVE_LISTEN")
        .unwrap_or_else(|_| "127.0.0.1:8787".to_owned())
        .parse()
        .context("ZHIWEAVE_LISTEN must be an IP socket address")?;
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .with_context(|| format!("could not bind {address}"))?;
    println!("ZhiWeave architecture-spike server listening on {address}");
    axum::serve(listener, zhiweave_server::router())
        .await
        .context("server stopped unexpectedly")
}
