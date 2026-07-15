use serde::Serialize;
use serde_json::Value;
use std::cmp::Ordering;
use std::time::Duration;
use ureq::Error;

use crate::network;

const LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/svipm/cursor-i18n-zh/releases/latest";
pub const PROJECT_REPOSITORY_URL: &str = "https://github.com/svipm/cursor-i18n-zh";
pub const PROJECT_RELEASES_URL: &str = "https://github.com/svipm/cursor-i18n-zh/releases";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub current_ahead: bool,
    pub release_url: &'static str,
    pub published_at: Option<String>,
    pub message: String,
}

pub fn check_for_updates() -> Result<UpdateStatus, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let agent = network::platform_agent(Duration::from_secs(10));
    let mut response = agent
        .get(LATEST_RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "cursor-i18n-zh-workbench")
        .call()
        .map_err(github_error)?;
    let value = response
        .body_mut()
        .read_json::<Value>()
        .map_err(|error| format!("GitHub 版本响应格式错误: {error}"))?;
    let tag = value
        .get("tag_name")
        .and_then(Value::as_str)
        .ok_or_else(|| "GitHub 最新发行版缺少 tag_name".to_string())?;
    let latest = tag.trim().trim_start_matches(['v', 'V']).to_string();
    if parse_version(&latest).is_none() {
        return Err(format!("GitHub 最新版本号无法识别: {tag}"));
    }
    let ordering = compare_versions(&latest, &current)
        .ok_or_else(|| format!("无法比较版本号: {latest} 与 {current}"))?;
    let update_available = ordering == Ordering::Greater;
    let current_ahead = ordering == Ordering::Less;
    let message = if update_available {
        format!("发现新版本 v{latest}. 是否更新由你决定, 当前版本不会被强制替换")
    } else if ordering == Ordering::Less {
        format!("当前 v{current} 高于已发布的 v{latest}, 正在使用开发版本")
    } else {
        format!("当前 v{current} 已是最新版本")
    };
    Ok(UpdateStatus {
        current_version: current,
        latest_version: latest,
        update_available,
        current_ahead,
        release_url: PROJECT_RELEASES_URL,
        published_at: value
            .get("published_at")
            .and_then(Value::as_str)
            .map(str::to_string),
        message,
    })
}

fn github_error(error: Error) -> String {
    match error {
        Error::StatusCode(404) => "GitHub 尚未找到正式发行版".to_string(),
        Error::StatusCode(403 | 429) => "GitHub 版本检查暂时受限, 请稍后重试".to_string(),
        Error::StatusCode(code) => format!("GitHub 版本接口返回 HTTP {code}"),
        other => format!("连接 GitHub 检查版本失败: {other}"),
    }
}

fn parse_version(value: &str) -> Option<Vec<u64>> {
    let normalized = value
        .trim()
        .trim_start_matches(['v', 'V'])
        .split(['-', '+'])
        .next()?;
    let parts = normalized
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    (!parts.is_empty()).then_some(parts)
}

fn compare_versions(left: &str, right: &str) -> Option<Ordering> {
    let left = parse_version(left)?;
    let right = parse_version(right)?;
    let count = left.len().max(right.len());
    for index in 0..count {
        match left
            .get(index)
            .copied()
            .unwrap_or(0)
            .cmp(&right.get(index).copied().unwrap_or(0))
        {
            Ordering::Equal => {}
            ordering => return Some(ordering),
        }
    }
    Some(Ordering::Equal)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_release_versions_numerically() {
        assert_eq!(
            compare_versions("v0.3.10", "0.3.9"),
            Some(Ordering::Greater)
        );
        assert_eq!(compare_versions("0.3.4", "0.3.4"), Some(Ordering::Equal));
        assert_eq!(compare_versions("0.3.4", "0.4.0"), Some(Ordering::Less));
    }

    #[test]
    fn rejects_invalid_release_versions() {
        assert_eq!(parse_version("latest"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    #[ignore = "requires access to GitHub"]
    fn checks_github_with_platform_certificates() {
        let status = check_for_updates().expect("GitHub update check should succeed");
        assert!(!status.latest_version.is_empty());
    }
}
