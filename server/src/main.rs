use gifgg_server::{app::App, config::Config, listener};
use std::{net::SocketAddr, path::PathBuf};

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = terminate.recv() => {},
        }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c()
        .await
        .expect("install shutdown handler");
}

fn parse_port(value: &str) -> Option<u16> {
    value.trim().parse::<u16>().ok().filter(|port| *port != 0)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().len() != 1 {
        return Err("usage: gifgg-server".into());
    }
    let config = Config::from_env()?;
    // A deployed binary can have public/ beside it. In the source checkout,
    // resolve assets relative to the source.
    let beside_binary = std::env::current_exe()?
        .parent()
        .ok_or("missing executable directory")?
        .join("public");
    let public_dir = if beside_binary.is_dir() {
        beside_binary
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../public")
    };
    let app = App::new(config, public_dir)?.router();
    let port = parse_port(&std::env::var("PORT").unwrap_or_else(|_| "3000".into()))
        .ok_or("PORT must be an integer between 1 and 65535")?;
    let listener = tokio::net::TcpListener::from_std(listener::bind(port)?)?;
    println!("gif.gg listening on http://localhost:{port}/");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown())
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_accepts_decimal_integers_in_bounds() {
        for value in ["3000", " 3000 ", "+3000", "03000"] {
            assert_eq!(parse_port(value), Some(3000), "{value}");
        }
        assert_eq!(parse_port("1"), Some(1));
        assert_eq!(parse_port("65535"), Some(65535));
        for value in [
            "",
            "0",
            "65536",
            "-1",
            "1.5",
            "NaN",
            "Infinity",
            "port",
            "3e3",
            "3000.0",
            "0xBB8",
            "0o5670",
            "0b101110111000",
        ] {
            assert_eq!(parse_port(value), None, "{value}");
        }
    }
}
