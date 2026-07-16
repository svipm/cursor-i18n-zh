use std::time::Duration;
use ureq::tls::{RootCerts, TlsConfig};
use ureq::{Agent, Error};

pub fn platform_agent(timeout: Duration) -> Agent {
    Agent::config_builder()
        .timeout_global(Some(timeout))
        .tls_config(
            TlsConfig::builder()
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .build()
        .into()
}

pub fn with_retry<T>(mut operation: impl FnMut() -> Result<T, Error>) -> Result<T, Error> {
    for attempt in 0..3 {
        match operation() {
            Ok(value) => return Ok(value),
            Err(error) if attempt < 2 && is_retryable(&error) => {
                std::thread::sleep(Duration::from_millis(if attempt == 0 { 250 } else { 750 }));
            }
            Err(error) => return Err(error),
        }
    }
    unreachable!("retry loop always returns")
}

fn is_retryable(error: &Error) -> bool {
    matches!(
        error,
        Error::StatusCode(500 | 502 | 503 | 504)
            | Error::Io(_)
            | Error::Timeout(_)
            | Error::HostNotFound
            | Error::ConnectionFailed
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_transient_server_errors() {
        let mut attempts = 0;
        let value = with_retry(|| {
            attempts += 1;
            if attempts < 3 {
                Err(Error::StatusCode(502))
            } else {
                Ok("ok")
            }
        })
        .unwrap();
        assert_eq!(value, "ok");
        assert_eq!(attempts, 3);
    }

    #[test]
    fn does_not_retry_permanent_client_errors() {
        let mut attempts = 0;
        let error = with_retry::<()>(|| {
            attempts += 1;
            Err(Error::StatusCode(404))
        })
        .unwrap_err();
        assert!(matches!(error, Error::StatusCode(404)));
        assert_eq!(attempts, 1);
    }
}
