use socket2::{Domain, Protocol, Socket, Type};
use std::{
    io,
    net::{SocketAddr, TcpListener},
};

pub fn bind(port: u16) -> io::Result<TcpListener> {
    with_ipv4_fallback(port, || bind_address(SocketAddr::from(([0u16; 8], port))))
}

fn with_ipv4_fallback(
    port: u16,
    dual_stack: impl FnOnce() -> io::Result<TcpListener>,
) -> io::Result<TcpListener> {
    match dual_stack() {
        Ok(listener) => Ok(listener),
        // A conflicting listener should still prevent startup, rather than
        // silently splitting IPv4 and IPv6 traffic between different processes.
        Err(error) if error.kind() == io::ErrorKind::AddrInUse => Err(error),
        Err(_) => bind_address(SocketAddr::from(([0, 0, 0, 0], port))),
    }
}

fn bind_address(address: SocketAddr) -> io::Result<TcpListener> {
    let domain = if address.is_ipv6() {
        Domain::IPV6
    } else {
        Domain::IPV4
    };
    let socket = Socket::new(domain, Type::STREAM, Some(Protocol::TCP))?;
    if address.is_ipv6() {
        // Override IPV6_V6ONLY explicitly instead of relying on host defaults.
        socket.set_only_v6(false)?;
    }
    #[cfg(unix)]
    socket.set_reuse_address(true)?;
    socket.set_nonblocking(true)?;
    socket.bind(&address.into())?;
    socket.listen(1024)?;
    Ok(socket.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{net::TcpStream, time::Duration};

    fn connect(listener: &TcpListener, address: SocketAddr) {
        let _client = TcpStream::connect_timeout(&address, Duration::from_secs(1)).unwrap();
        let (_stream, peer) = listener.accept().unwrap();
        assert!(peer.ip().is_loopback() || peer.ip().to_canonical().is_loopback());
    }

    #[test]
    fn accepts_ipv4_and_ipv6_when_available() {
        let listener = bind(0).unwrap();
        let address = listener.local_addr().unwrap();
        connect(
            &listener,
            SocketAddr::from(([127, 0, 0, 1], address.port())),
        );
        if address.is_ipv6() {
            assert!(!socket2::SockRef::from(&listener).only_v6().unwrap());
            connect(
                &listener,
                SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], address.port())),
            );
        }
    }

    #[test]
    fn accepts_ipv4_when_ipv6_is_unavailable() {
        let listener = with_ipv4_fallback(0, || {
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "IPv6 unavailable",
            ))
        })
        .unwrap();
        let address = listener.local_addr().unwrap();
        assert!(address.is_ipv4());
        connect(
            &listener,
            SocketAddr::from(([127, 0, 0, 1], address.port())),
        );
    }

    #[test]
    fn does_not_mask_an_occupied_port() {
        let error =
            with_ipv4_fallback(0, || Err(io::Error::from(io::ErrorKind::AddrInUse))).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AddrInUse);
    }
}
