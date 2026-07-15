use std::time::Duration;
use ureq::tls::{RootCerts, TlsConfig};
use ureq::Agent;

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
