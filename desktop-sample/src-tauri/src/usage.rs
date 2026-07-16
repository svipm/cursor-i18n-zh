use base64::{engine::general_purpose::URL_SAFE, engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use ureq::Error;

use crate::network;

const USAGE_SUMMARY_URL: &str = "https://cursor.com/api/usage-summary";
const MODEL_USAGE_URL: &str = "https://api2.cursor.sh/auth/usage";

struct CursorCredentials {
    token: String,
    user_id: String,
    email: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub name: String,
    pub requests: u64,
    pub request_limit: u64,
    pub tokens: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageOverview {
    pub account_email: Option<String>,
    pub membership_type: String,
    pub plan_used: f64,
    pub plan_limit: f64,
    pub plan_remaining: f64,
    pub total_percent_used: f64,
    pub api_percent_used: f64,
    pub billing_cycle_start: Option<String>,
    pub billing_cycle_end: Option<String>,
    pub request_total: u64,
    pub token_total: u64,
    pub models: Vec<ModelUsage>,
    pub refreshed_at_unix: u64,
}

pub fn load_cursor_usage() -> Result<UsageOverview, String> {
    let credentials = read_cursor_credentials(&cursor_state_db_path())?;
    let agent = network::platform_agent(Duration::from_secs(15));

    let cookie = format!(
        "WorkosCursorSessionToken={}::{}",
        credentials.user_id, credentials.token
    );
    let summary = fetch_json(
        agent
            .get(USAGE_SUMMARY_URL)
            .header("Accept", "application/json")
            .header("Cookie", &cookie),
        "套餐用量",
    )?;
    let authorization = format!("Bearer {}", credentials.token);
    let model_usage = fetch_json(
        agent
            .get(MODEL_USAGE_URL)
            .header("Accept", "application/json")
            .header("Authorization", &authorization),
        "模型用量",
    )?;

    parse_usage(credentials.email, &summary, &model_usage)
}

fn cursor_state_db_path() -> PathBuf {
    cursor_user_data_root()
        .join("Cursor")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb")
}

#[cfg(target_os = "windows")]
fn cursor_user_data_root() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

#[cfg(target_os = "macos")]
fn cursor_user_data_root() -> PathBuf {
    std::env::var_os("I18N_WORKBENCH_USER_HOME")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .map(|home| home.join("Library/Application Support"))
        .unwrap_or_else(std::env::temp_dir)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn cursor_user_data_root() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".config"))
        })
        .unwrap_or_else(std::env::temp_dir)
}

fn read_cursor_credentials(path: &Path) -> Result<CursorCredentials, String> {
    if !path.is_file() {
        return Err(format!(
            "未找到 Cursor 登录数据库: {}. 请先登录 Cursor",
            path.display()
        ));
    }
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("无法只读打开 Cursor 登录数据库: {error}"))?;
    let token = read_state_value(&connection, "cursorAuth/accessToken")?
        .ok_or_else(|| "Cursor 尚未登录或登录令牌不存在".to_string())?;
    let token = normalize_state_value(&token);
    if token.is_empty() {
        return Err("Cursor 登录令牌为空, 请重新登录 Cursor".to_string());
    }
    let email = read_state_value(&connection, "cursorAuth/cachedEmail")?
        .map(|value| normalize_state_value(&value))
        .filter(|value| !value.is_empty());
    let subject = jwt_subject(&token)?;
    let user_id = subject
        .strip_prefix("auth0|")
        .unwrap_or(&subject)
        .to_string();
    if user_id.is_empty() {
        return Err("Cursor 登录令牌缺少用户标识, 请重新登录 Cursor".to_string());
    }
    Ok(CursorCredentials {
        token,
        user_id,
        email,
    })
}

fn read_state_value(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut statement = connection
        .prepare("SELECT value FROM ItemTable WHERE key = ?1 LIMIT 1")
        .map_err(|error| format!("读取 Cursor 登录状态失败: {error}"))?;
    match statement.query_row([key], |row| row.get::<_, String>(0)) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("读取 Cursor 登录状态失败: {error}")),
    }
}

fn normalize_state_value(value: &str) -> String {
    serde_json::from_str::<String>(value)
        .unwrap_or_else(|_| value.to_string())
        .trim()
        .to_string()
}

fn jwt_subject(token: &str) -> Result<String, String> {
    let payload = token
        .split('.')
        .nth(1)
        .ok_or_else(|| "Cursor 登录令牌格式无效, 请重新登录 Cursor".to_string())?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| URL_SAFE.decode(payload))
        .map_err(|_| "Cursor 登录令牌载荷无法解析, 请重新登录 Cursor".to_string())?;
    let value: Value = serde_json::from_slice(&decoded)
        .map_err(|_| "Cursor 登录令牌载荷格式无效, 请重新登录 Cursor".to_string())?;
    value
        .get("sub")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Cursor 登录令牌缺少用户标识, 请重新登录 Cursor".to_string())
}

fn fetch_json(
    request: ureq::RequestBuilder<ureq::typestate::WithoutBody>,
    label: &str,
) -> Result<Value, String> {
    let mut response = request
        .call()
        .map_err(|error| request_error(label, error))?;
    response
        .body_mut()
        .read_json::<Value>()
        .map_err(|error| format!("Cursor {label}响应格式错误: {error}"))
}

fn request_error(label: &str, error: Error) -> String {
    match error {
        Error::StatusCode(401 | 403) => {
            format!("Cursor 登录已过期, 无法读取{label}. 请重新登录 Cursor")
        }
        Error::StatusCode(code) => format!("Cursor {label}接口返回 HTTP {code}"),
        other => format!("连接 Cursor {label}接口失败: {other}"),
    }
}

fn parse_usage(
    account_email: Option<String>,
    summary: &Value,
    model_usage: &Value,
) -> Result<UsageOverview, String> {
    let plan = summary
        .pointer("/individualUsage/plan")
        .and_then(Value::as_object)
        .ok_or_else(|| "Cursor 套餐用量响应缺少 individualUsage.plan".to_string())?;
    let mut models = model_usage
        .as_object()
        .into_iter()
        .flat_map(|object| object.iter())
        .filter_map(|(name, value)| {
            let details = value.as_object()?;
            let requests = value_u64(details.get("numRequests"));
            let request_limit = value_u64(details.get("maxRequestUsage"));
            let tokens = value_u64(details.get("numTokens"));
            ((requests + request_limit + tokens) > 0).then(|| ModelUsage {
                name: name.clone(),
                requests,
                request_limit,
                tokens,
            })
        })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| {
        right
            .requests
            .cmp(&left.requests)
            .then_with(|| right.tokens.cmp(&left.tokens))
            .then_with(|| left.name.cmp(&right.name))
    });
    let request_total = models.iter().map(|model| model.requests).sum();
    let token_total = models.iter().map(|model| model.tokens).sum();
    Ok(UsageOverview {
        account_email,
        membership_type: summary
            .get("membershipType")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        plan_used: value_f64(plan.get("used")),
        plan_limit: value_f64(plan.get("limit")),
        plan_remaining: value_f64(plan.get("remaining")),
        total_percent_used: value_f64(plan.get("totalPercentUsed")),
        api_percent_used: value_f64(plan.get("apiPercentUsed")),
        billing_cycle_start: summary
            .get("billingCycleStart")
            .and_then(Value::as_str)
            .map(str::to_string),
        billing_cycle_end: summary
            .get("billingCycleEnd")
            .and_then(Value::as_str)
            .map(str::to_string),
        request_total,
        token_total,
        models,
        refreshed_at_unix: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    })
}

fn value_f64(value: Option<&Value>) -> f64 {
    value
        .and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
        })
        .unwrap_or(0.0)
}

fn value_u64(value: Option<&Value>) -> u64 {
    value
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_f64().map(|number| number.max(0.0) as u64))
                .or_else(|| value.as_str().and_then(|text| text.parse::<u64>().ok()))
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;

    #[test]
    fn extracts_cursor_user_id_without_exposing_token() {
        let payload = URL_SAFE_NO_PAD.encode(br#"{"sub":"auth0|user_123"}"#);
        let token = format!("header.{payload}.signature");
        assert_eq!(jwt_subject(&token).unwrap(), "auth0|user_123");
    }

    #[test]
    fn parses_plan_and_model_usage() {
        let summary = serde_json::json!({
            "membershipType": "pro",
            "billingCycleStart": "2026-07-01T00:00:00Z",
            "billingCycleEnd": "2026-08-01T00:00:00Z",
            "individualUsage": {
                "plan": {
                    "used": 120,
                    "limit": 500,
                    "remaining": 380,
                    "totalPercentUsed": 24,
                    "apiPercentUsed": 3
                }
            }
        });
        let models = serde_json::json!({
            "gpt-test": {"numRequests": 12, "maxRequestUsage": 100, "numTokens": 3456},
            "startOfMonth": "2026-07-01"
        });
        let usage = parse_usage(Some("user@example.com".to_string()), &summary, &models).unwrap();
        assert_eq!(usage.membership_type, "pro");
        assert_eq!(usage.request_total, 12);
        assert_eq!(usage.token_total, 3456);
        assert_eq!(usage.models.len(), 1);
    }
}
