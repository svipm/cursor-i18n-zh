use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use ureq::Error;

use crate::adapters::local_app_data;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadResult {
    pub version: String,
    pub path: String,
    pub sha256: String,
}

pub fn check_for_updates() -> Result<UpdateStatus, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let agent = network::platform_agent(Duration::from_secs(10));
    let mut response = network::with_retry(|| {
        agent
            .get(LATEST_RELEASE_API)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "cursor-i18n-zh-workbench")
            .call()
    })
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

pub fn download_latest_update() -> Result<UpdateDownloadResult, String> {
    let agent = network::platform_agent(Duration::from_secs(60));
    let release = fetch_latest_release(&agent)?;
    let tag = release
        .get("tag_name")
        .and_then(Value::as_str)
        .ok_or_else(|| "GitHub 最新发行版缺少 tag_name".to_string())?;
    let version = tag.trim().trim_start_matches(['v', 'V']).to_string();
    if compare_versions(&version, env!("CARGO_PKG_VERSION")) != Some(Ordering::Greater) {
        return Err("当前没有需要下载的新版本".to_string());
    }
    let asset_name = if cfg!(target_os = "macos") {
        format!("localization-workbench-v{version}-macos.dmg")
    } else {
        format!("localization-workbench-v{version}-windows.zip")
    };
    let checksum_name = if cfg!(target_os = "macos") {
        "SHA256SUMS-macos.txt"
    } else {
        "SHA256SUMS.txt"
    };
    let asset_url = release_asset_url(&release, &asset_name)?;
    let checksum_url = release_asset_url(&release, checksum_name)?;
    let checksum_text = download_bytes(&agent, &checksum_url, 1024 * 1024)?;
    let checksum_text =
        String::from_utf8(checksum_text).map_err(|_| "发行版 SHA256 文件不是 UTF-8".to_string())?;
    let expected = checksum_for(&checksum_text, &asset_name)?;
    let data = download_bytes(&agent, &asset_url, 250 * 1024 * 1024)?;
    let actual = sha256_hex(&data);
    if !actual.eq_ignore_ascii_case(&expected) {
        return Err(format!(
            "更新包 SHA256 校验失败, 期望 {expected}, 实际 {actual}"
        ));
    }
    let root = local_app_data().join("updates").join(format!("v{version}"));
    fs::create_dir_all(&root)
        .map_err(|error| format!("无法创建更新目录 {}: {error}", root.display()))?;
    let path = root.join(&asset_name);
    let temp = root.join(format!(".{asset_name}.tmp"));
    fs::write(&temp, data)
        .map_err(|error| format!("无法写入更新包 {}: {error}", temp.display()))?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("无法覆盖旧更新包 {}: {error}", path.display()))?;
    }
    fs::rename(&temp, &path)
        .map_err(|error| format!("无法提交更新包 {}: {error}", path.display()))?;
    Ok(UpdateDownloadResult {
        version,
        path: path.display().to_string(),
        sha256: actual,
    })
}

pub fn validate_update_path(path: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(local_app_data().join("updates"))
        .map_err(|error| format!("更新目录不存在: {error}"))?;
    let path = fs::canonicalize(path)
        .map_err(|error| format!("更新包路径无效 {}: {error}", path.display()))?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err("更新包路径不在工作台更新目录中".to_string());
    }
    Ok(path)
}

fn fetch_latest_release(agent: &ureq::Agent) -> Result<Value, String> {
    let mut response = network::with_retry(|| {
        agent
            .get(LATEST_RELEASE_API)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "cursor-i18n-zh-workbench")
            .call()
    })
    .map_err(github_error)?;
    response
        .body_mut()
        .read_json::<Value>()
        .map_err(|error| format!("GitHub 版本响应格式错误: {error}"))
}

fn release_asset_url(release: &Value, name: &str) -> Result<String, String> {
    release
        .get("assets")
        .and_then(Value::as_array)
        .and_then(|assets| {
            assets.iter().find_map(|asset| {
                (asset.get("name").and_then(Value::as_str) == Some(name))
                    .then(|| asset.get("browser_download_url").and_then(Value::as_str))
                    .flatten()
            })
        })
        .filter(|url| url.starts_with("https://github.com/svipm/cursor-i18n-zh/releases/download/"))
        .map(str::to_string)
        .ok_or_else(|| format!("发行版缺少更新资源: {name}"))
}

fn download_bytes(agent: &ureq::Agent, url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let mut response = network::with_retry(|| {
        agent
            .get(url)
            .header("User-Agent", "cursor-i18n-zh-workbench")
            .call()
    })
    .map_err(github_error)?;
    let data = response
        .body_mut()
        .with_config()
        .limit((limit.saturating_add(1)) as u64)
        .read_to_vec()
        .map_err(|error| format!("读取更新资源失败: {error}"))?;
    if data.len() > limit {
        return Err(format!("更新资源超过大小限制: {} MB", limit / 1024 / 1024));
    }
    Ok(data)
}

fn checksum_for(content: &str, name: &str) -> Result<String, String> {
    content
        .lines()
        .filter_map(|line| line.split_once("  "))
        .find(|(_, file)| file.trim_start_matches('*').trim() == name)
        .map(|(checksum, _)| checksum.trim().to_string())
        .filter(|checksum| {
            checksum.len() == 64 && checksum.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
        .ok_or_else(|| format!("SHA256 文件缺少更新资源记录: {name}"))
}

fn sha256_hex(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
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
    fn selects_only_expected_release_assets_and_checksums() {
        let release = serde_json::json!({
            "assets": [{
                "name": "package.zip",
                "browser_download_url": "https://github.com/svipm/cursor-i18n-zh/releases/download/v1.0.0/package.zip"
            }]
        });
        assert!(release_asset_url(&release, "package.zip").is_ok());
        assert_eq!(
            checksum_for(
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  package.zip\n",
                "package.zip"
            )
            .unwrap(),
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        );
    }

    #[test]
    #[ignore = "requires access to GitHub"]
    fn checks_github_with_platform_certificates() {
        let status = check_for_updates().expect("GitHub update check should succeed");
        assert!(!status.latest_version.is_empty());
    }
}
