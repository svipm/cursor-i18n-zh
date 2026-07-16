use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::network::platform_agent;

const CHECK_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Clone, Debug)]
pub(super) struct McpRuntimeConfig {
    pub name: String,
    pub transport: String,
    pub command: String,
    pub url: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub headers: BTreeMap<String, String>,
    pub enabled: bool,
    pub workspace: Option<PathBuf>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHealthResult {
    pub name: String,
    pub transport: String,
    pub status: String,
    pub summary: String,
    pub diagnostics: Vec<String>,
    pub latency_ms: u128,
    pub protocol_version: Option<String>,
    pub enabled: bool,
    pub checked_at_unix: u64,
}

pub(super) fn check(config: McpRuntimeConfig) -> McpHealthResult {
    let started = Instant::now();
    let result = if config.transport == "stdio" {
        check_stdio(&config)
    } else {
        check_remote(&config)
    };
    let (status, summary, diagnostics, protocol_version) = match result {
        Ok(outcome) => (
            outcome.status,
            outcome.summary,
            outcome.diagnostics,
            outcome.protocol_version,
        ),
        Err(error) => (
            "failed".to_string(),
            "连接失败".to_string(),
            vec![sanitize(&error, &secret_values(&config))],
            None,
        ),
    };
    McpHealthResult {
        name: config.name,
        transport: config.transport,
        status,
        summary,
        diagnostics,
        latency_ms: started.elapsed().as_millis(),
        protocol_version,
        enabled: config.enabled,
        checked_at_unix: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    }
}

struct HealthOutcome {
    status: String,
    summary: String,
    diagnostics: Vec<String>,
    protocol_version: Option<String>,
}

fn check_stdio(config: &McpRuntimeConfig) -> Result<HealthOutcome, String> {
    if config.command.trim().is_empty() {
        return Err("stdio MCP 没有配置启动命令".to_string());
    }
    let mut command = Command::new(&config.command);
    command
        .args(&config.args)
        .envs(&config.env)
        .env("NO_COLOR", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(workspace) = &config.workspace {
        command.current_dir(workspace);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 MCP 命令, 请检查运行环境和 PATH: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 MCP 标准输出".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 MCP 错误输出".to_string())?;
    let (stdout_tx, stdout_rx) = mpsc::channel();
    let (stderr_tx, stderr_rx) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = stdout_tx.send(line);
        }
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = stderr_tx.send(line);
        }
    });

    let request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": { "name": "i18n-workbench", "version": env!("CARGO_PKG_VERSION") }
        }
    });
    if let Some(stdin) = child.stdin.as_mut() {
        writeln!(stdin, "{request}")
            .map_err(|error| format!("无法发送 MCP 初始化请求: {error}"))?;
        stdin
            .flush()
            .map_err(|error| format!("无法刷新 MCP 初始化请求: {error}"))?;
    }

    let deadline = Instant::now() + CHECK_TIMEOUT;
    let mut stderr_lines = Vec::new();
    loop {
        stderr_lines.extend(stderr_rx.try_iter());
        match stdout_rx.recv_timeout(Duration::from_millis(100)) {
            Ok(line) => {
                if let Some(outcome) = parse_handshake_line(&line) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return outcome;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("无法读取 MCP 进程状态: {error}"))?
        {
            stderr_lines.extend(stderr_rx.try_iter());
            let detail = stderr_lines
                .into_iter()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join(" | ");
            return Err(if detail.trim().is_empty() {
                format!("MCP 进程在握手前退出: {status}")
            } else {
                format!("MCP 进程在握手前退出: {status}. {detail}")
            });
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            stderr_lines.extend(stderr_rx.try_iter());
            let detail = stderr_lines
                .into_iter()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join(" | ");
            return Err(if detail.trim().is_empty() {
                "MCP 初始化握手超时".to_string()
            } else {
                format!("MCP 初始化握手超时. {detail}")
            });
        }
    }
}

fn parse_handshake_line(line: &str) -> Option<Result<HealthOutcome, String>> {
    let value = serde_json::from_str::<Value>(line.trim()).ok()?;
    if value.get("id") != Some(&Value::from(1)) {
        return None;
    }
    if let Some(error) = value.get("error") {
        return Some(Err(format!(
            "MCP 初始化返回错误: {}",
            error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("未知协议错误")
        )));
    }
    let result = value.get("result")?;
    let protocol_version = result
        .get("protocolVersion")
        .and_then(Value::as_str)
        .map(str::to_string);
    Some(Ok(HealthOutcome {
        status: "healthy".to_string(),
        summary: "初始化握手成功".to_string(),
        diagnostics: vec!["stdio 进程已启动并返回 MCP initialize 结果".to_string()],
        protocol_version,
    }))
}

fn check_remote(config: &McpRuntimeConfig) -> Result<HealthOutcome, String> {
    if !(config.url.starts_with("https://") || config.url.starts_with("http://")) {
        return Err("远程 MCP URL 必须使用 http:// 或 https://".to_string());
    }
    let agent = platform_agent(CHECK_TIMEOUT);
    if config.transport == "sse" {
        let mut request = agent
            .get(&config.url)
            .header("Accept", "text/event-stream")
            .header("User-Agent", "cursor-i18n-zh-workbench");
        for (key, value) in &config.headers {
            request = request.header(key, value);
        }
        let response = request
            .call()
            .map_err(|error| format!("SSE 端点连接失败: {error}"))?;
        return Ok(HealthOutcome {
            status: "healthy".to_string(),
            summary: "SSE 端点可连接".to_string(),
            diagnostics: vec![format!("服务返回 HTTP {} 和事件流响应", response.status())],
            protocol_version: None,
        });
    }

    let payload = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": { "name": "i18n-workbench", "version": env!("CARGO_PKG_VERSION") }
        }
    });
    let mut request = agent
        .post(&config.url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .header("User-Agent", "cursor-i18n-zh-workbench");
    for (key, value) in &config.headers {
        request = request.header(key, value);
    }
    let mut response = request
        .send_json(payload)
        .map_err(|error| format!("HTTP MCP 初始化请求失败: {error}"))?;
    let status = response.status();
    let body = response
        .body_mut()
        .read_to_string()
        .map_err(|error| format!("无法读取 HTTP MCP 响应: {error}"))?;
    if let Some(line) = body
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with('{'))
    {
        if let Some(outcome) = parse_handshake_line(line) {
            return outcome;
        }
    }
    if body.contains("event:") || body.contains("data:") {
        return Ok(HealthOutcome {
            status: "healthy".to_string(),
            summary: "事件流握手成功".to_string(),
            diagnostics: vec![format!("服务返回 HTTP {status} 和 MCP 事件流")],
            protocol_version: None,
        });
    }
    Err(format!(
        "服务返回 HTTP {status}, 但没有有效的 MCP initialize 结果"
    ))
}

fn secret_values(config: &McpRuntimeConfig) -> Vec<&str> {
    let mut values = config
        .env
        .values()
        .chain(config.headers.values())
        .map(String::as_str)
        .filter(|value| value.len() >= 3)
        .collect::<Vec<_>>();
    if config.url.len() >= 3 {
        values.push(&config.url);
    }
    values
}

fn sanitize(value: &str, secrets: &[&str]) -> String {
    let mut result = value.replace('\r', " ").replace('\n', " ");
    for secret in secrets {
        result = result.replace(secret, "••••••");
    }
    if result.chars().count() > 500 {
        result = result.chars().take(500).collect::<String>() + "...";
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_successful_initialize_response() {
        let result = parse_handshake_line(
            r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(result.status, "healthy");
        assert_eq!(result.protocol_version.as_deref(), Some("2025-06-18"));
    }

    #[test]
    fn removes_secrets_from_diagnostics() {
        assert_eq!(
            sanitize("request failed with secret-token", &["secret-token"]),
            "request failed with ••••••"
        );
    }

    #[test]
    fn reports_a_missing_stdio_runtime_without_exposing_arguments() {
        let result = check(McpRuntimeConfig {
            name: "missing".to_string(),
            transport: "stdio".to_string(),
            command: "definitely-not-a-real-mcp-command".to_string(),
            url: String::new(),
            args: vec!["private-argument".to_string()],
            env: BTreeMap::new(),
            headers: BTreeMap::new(),
            enabled: true,
            workspace: None,
        });
        assert_eq!(result.status, "failed");
        assert!(!result.diagnostics.join(" ").contains("private-argument"));
    }

    #[test]
    fn completes_a_real_stdio_initialize_handshake() {
        let script = "process.stdin.once('data',()=>console.log(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-06-18'}})))";
        let result = check(McpRuntimeConfig {
            name: "fixture".to_string(),
            transport: "stdio".to_string(),
            command: "node".to_string(),
            url: String::new(),
            args: vec!["-e".to_string(), script.to_string()],
            env: BTreeMap::new(),
            headers: BTreeMap::new(),
            enabled: true,
            workspace: None,
        });
        assert_eq!(result.status, "healthy", "{:?}", result.diagnostics);
        assert_eq!(result.protocol_version.as_deref(), Some("2025-06-18"));
    }
}
