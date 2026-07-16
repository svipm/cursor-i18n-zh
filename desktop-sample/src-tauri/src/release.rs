use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::fs::{self, File};
use std::io::{Read, Write};
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
    pub cached: bool,
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

pub fn download_latest_update(
    mut progress: impl FnMut(u8, String),
) -> Result<UpdateDownloadResult, String> {
    progress(3, "正在读取 GitHub 最新发行版".to_string());
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
    progress(10, "正在下载并解析 SHA256 校验清单".to_string());
    let checksum_text = download_bytes(&agent, &checksum_url, 1024 * 1024)?;
    let checksum_text =
        String::from_utf8(checksum_text).map_err(|_| "发行版 SHA256 文件不是 UTF-8".to_string())?;
    let expected = checksum_for(&checksum_text, &asset_name)?;
    let root = local_app_data().join("updates").join(format!("v{version}"));
    fs::create_dir_all(&root)
        .map_err(|error| format!("无法创建更新目录 {}: {error}", root.display()))?;
    let path = root.join(&asset_name);
    const UPDATE_LIMIT: u64 = 250 * 1024 * 1024;
    if path.is_file() {
        progress(15, "正在校验本地更新缓存".to_string());
        if let Ok(actual) = sha256_file(&path, UPDATE_LIMIT) {
            if actual.eq_ignore_ascii_case(&expected) {
                progress(100, "本地更新缓存已通过 SHA256 校验".to_string());
                return Ok(UpdateDownloadResult {
                    version,
                    path: path.display().to_string(),
                    sha256: actual,
                    cached: true,
                });
            }
        }
    }
    let temp = root.join(format!(".{asset_name}.tmp"));
    progress(20, "正在流式下载更新包".to_string());
    let actual = download_file(
        &agent,
        &asset_url,
        &temp,
        UPDATE_LIMIT,
        |downloaded, total| {
            let percent = total
                .filter(|total| *total > 0)
                .map(|total| 20_u8.saturating_add(((downloaded.min(total) * 70) / total) as u8))
                .unwrap_or(45);
            progress(
                percent.min(90),
                format!("已下载 {:.1} MB", downloaded as f64 / 1024.0 / 1024.0),
            );
        },
    )?;
    progress(93, "正在核对更新包 SHA256".to_string());
    if !actual.eq_ignore_ascii_case(&expected) {
        let _ = fs::remove_file(&temp);
        return Err(format!(
            "更新包 SHA256 校验失败, 期望 {expected}, 实际 {actual}"
        ));
    }
    progress(97, "正在原子提交已校验更新包".to_string());
    commit_download(&temp, &path)?;
    progress(100, "更新包已准备完成".to_string());
    Ok(UpdateDownloadResult {
        version,
        path: path.display().to_string(),
        sha256: actual,
        cached: false,
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

fn download_file(
    agent: &ureq::Agent,
    url: &str,
    path: &Path,
    limit: u64,
    mut progress: impl FnMut(u64, Option<u64>),
) -> Result<String, String> {
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("无法清理旧更新临时文件 {}: {error}", path.display()))?;
    }
    let result = (|| {
        let mut response = network::with_retry(|| {
            agent
                .get(url)
                .header("User-Agent", "cursor-i18n-zh-workbench")
                .call()
        })
        .map_err(github_error)?;
        let content_length = response
            .headers()
            .get("content-length")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value <= limit);
        let mut reader = response
            .body_mut()
            .with_config()
            .limit(limit.saturating_add(1))
            .reader();
        let mut file = File::create(path)
            .map_err(|error| format!("无法创建更新临时文件 {}: {error}", path.display()))?;
        let mut hasher = Sha256::new();
        let mut total = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = reader
                .read(&mut buffer)
                .map_err(|error| format!("读取更新资源失败: {error}"))?;
            if count == 0 {
                break;
            }
            total = total.saturating_add(count as u64);
            if total > limit {
                return Err(format!("更新资源超过大小限制: {} MB", limit / 1024 / 1024));
            }
            hasher.update(&buffer[..count]);
            file.write_all(&buffer[..count])
                .map_err(|error| format!("写入更新临时文件失败: {error}"))?;
            progress(total, content_length);
        }
        file.sync_all()
            .map_err(|error| format!("同步更新临时文件失败: {error}"))?;
        Ok(digest_hex(hasher.finalize()))
    })();
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

fn sha256_file(path: &Path, limit: u64) -> Result<String, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("无法读取更新包信息 {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > limit {
        return Err("缓存更新包不是安全的普通文件或超过大小限制".to_string());
    }
    let mut file = File::open(path)
        .map_err(|error| format!("无法读取缓存更新包 {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("读取缓存更新包失败: {error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(digest_hex(hasher.finalize()))
}

fn commit_download(temp: &Path, path: &Path) -> Result<(), String> {
    let temp_metadata = fs::symlink_metadata(temp)
        .map_err(|error| format!("更新临时文件不存在 {}: {error}", temp.display()))?;
    if temp_metadata.file_type().is_symlink() || !temp_metadata.is_file() {
        return Err("更新临时路径必须是普通文件".to_string());
    }
    let backup = path.with_file_name(format!(
        ".{}.previous",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("update")
    ));
    if backup.exists() {
        fs::remove_file(&backup)
            .map_err(|error| format!("无法清理更新备份 {}: {error}", backup.display()))?;
    }
    if path.exists() {
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("无法读取旧更新包 {}: {error}", path.display()))?;
        if !metadata.is_file() && !metadata.file_type().is_symlink() {
            return Err("旧更新缓存路径不是普通文件".to_string());
        }
        fs::rename(path, &backup)
            .map_err(|error| format!("无法暂存旧更新包 {}: {error}", path.display()))?;
    }
    if let Err(error) = fs::rename(temp, path) {
        let rollback = if backup.exists() {
            fs::rename(&backup, path).map_err(|rollback_error| rollback_error.to_string())
        } else {
            Ok(())
        };
        return Err(match rollback {
            Ok(()) => format!("无法提交更新包 {}: {error}", path.display()),
            Err(rollback_error) => format!(
                "无法提交更新包 {}: {error}; 同时恢复旧更新包失败: {rollback_error}",
                path.display()
            ),
        });
    }
    if backup.exists() {
        let _ = fs::remove_file(&backup);
    }
    Ok(())
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

fn digest_hex(data: impl AsRef<[u8]>) -> String {
    data.as_ref()
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
    use std::net::TcpListener;

    fn serve_once(body: &'static [u8]) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(body).unwrap();
        });
        (format!("http://{address}/asset"), handle)
    }

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
    fn hashes_and_atomically_replaces_cached_updates() {
        let root = std::env::temp_dir().join(format!(
            "i18n-workbench-release-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let path = root.join("update.zip");
        let temp = root.join(".update.zip.tmp");
        fs::write(&path, b"old").unwrap();
        fs::write(&temp, b"new-package").unwrap();
        commit_download(&temp, &path).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new-package");
        assert_eq!(
            sha256_file(&path, 1024).unwrap(),
            digest_hex(Sha256::digest(b"new-package"))
        );
        assert!(!root.join(".update.zip.previous").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn streams_update_files_and_enforces_the_size_limit() {
        let root = std::env::temp_dir().join(format!(
            "i18n-workbench-release-stream-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let agent = network::platform_agent(Duration::from_secs(5));

        let (url, server) = serve_once(b"streamed-update");
        let path = root.join("streamed.tmp");
        let mut samples = Vec::new();
        let hash = download_file(&agent, &url, &path, 1024, |downloaded, total| {
            samples.push((downloaded, total));
        })
        .unwrap();
        server.join().unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"streamed-update");
        assert_eq!(hash, digest_hex(Sha256::digest(b"streamed-update")));
        assert_eq!(samples.last(), Some(&(15, Some(15))));

        let (url, server) = serve_once(b"too-large");
        let oversized = root.join("oversized.tmp");
        let error = download_file(&agent, &url, &oversized, 4, |_, _| {}).unwrap_err();
        server.join().unwrap();
        assert!(error.contains("超过大小限制"));
        assert!(!oversized.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    #[ignore = "requires access to GitHub"]
    fn checks_github_with_platform_certificates() {
        let status = check_for_updates().expect("GitHub update check should succeed");
        assert!(!status.latest_version.is_empty());
    }
}
