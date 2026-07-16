use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::time::Duration;
use ureq::Error;

use crate::extensions::{
    self, ExtensionInventory, ExtensionQuery, McpLookupRequest, McpSaveRequest, SecretFieldInput,
};
use crate::network;

const CATALOG: &str = include_str!("../../resources/extension-market.json");

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketItem {
    pub id: String,
    pub kind: String,
    pub targets: Vec<String>,
    pub name: String,
    pub title: String,
    pub description: String,
    pub repository: String,
    #[serde(default)]
    pub transport: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub raw_url: Option<String>,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketItemStatus {
    #[serde(flatten)]
    pub item: MarketItem,
    pub installed: bool,
    pub installed_revision: Option<String>,
    pub latest_revision: Option<String>,
    pub update_available: bool,
    pub installable: bool,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketInstallResult {
    pub message: String,
    pub inventory: ExtensionInventory,
}

pub fn catalog_for(query: ExtensionQuery) -> Result<Vec<MarketItemStatus>, String> {
    let catalog = load_catalog()?;
    let inventory = extensions::inventory(query.clone())?;
    let mut revisions: BTreeMap<String, Option<String>> = BTreeMap::new();
    let mut result = Vec::new();
    for item in catalog.into_iter().filter(|item| {
        item.targets.iter().any(|target| target == &query.target)
            && !(item.kind == "prompt" && query.target == "cursor" && query.scope == "user")
    }) {
        let (installed, installed_revision) = installed_state(&inventory, &item);
        let latest_revision = if let Some(revision) = revisions.get(&item.repository) {
            revision.clone()
        } else {
            let revision = latest_github_revision(&item.repository).ok();
            revisions.insert(item.repository.clone(), revision.clone());
            revision
        };
        let (update_available, status) = revision_status(
            installed,
            installed_revision.as_deref(),
            latest_revision.as_deref(),
        );
        result.push(MarketItemStatus {
            item,
            installed,
            installed_revision,
            latest_revision,
            update_available,
            installable: true,
            status,
        });
    }
    let mut known = result
        .iter()
        .map(|entry| (entry.item.kind.clone(), entry.item.name.clone()))
        .collect::<BTreeSet<_>>();
    for (kind, name, title, description, repository, installed_revision) in inventory
        .mcp_servers
        .iter()
        .filter_map(|entry| {
            entry.repository.clone().map(|repository| {
                (
                    "mcp".to_string(),
                    entry.name.clone(),
                    entry.name.clone(),
                    format!("已安装的 {} MCP 服务", entry.transport.to_uppercase()),
                    repository,
                    entry.revision.clone(),
                )
            })
        })
        .chain(inventory.skills.iter().filter_map(|entry| {
            entry.repository.clone().map(|repository| {
                (
                    "skill".to_string(),
                    entry.id.clone(),
                    entry.name.clone(),
                    entry.description.clone(),
                    repository,
                    entry.revision.clone(),
                )
            })
        }))
        .chain(inventory.prompts.iter().filter_map(|entry| {
            entry.repository.clone().map(|repository| {
                (
                    "prompt".to_string(),
                    entry.id.clone(),
                    entry.name.clone(),
                    entry.description.clone(),
                    repository,
                    entry.revision.clone(),
                )
            })
        }))
    {
        if !known.insert((kind.clone(), name.clone())) {
            continue;
        }
        let latest_revision = if let Some(revision) = revisions.get(&repository) {
            revision.clone()
        } else {
            let revision = latest_github_revision(&repository).ok();
            revisions.insert(repository.clone(), revision.clone());
            revision
        };
        let (update_available, status) = revision_status(
            true,
            installed_revision.as_deref(),
            latest_revision.as_deref(),
        );
        result.push(MarketItemStatus {
            item: MarketItem {
                id: format!("installed:{kind}:{name}"),
                kind,
                targets: vec![query.target.clone()],
                name,
                title,
                description,
                repository,
                transport: String::new(),
                command: String::new(),
                url: String::new(),
                args: Vec::new(),
                raw_url: None,
                source_path: None,
                content: None,
            },
            installed: true,
            installed_revision,
            latest_revision,
            update_available,
            installable: false,
            status,
        });
    }
    Ok(result)
}

pub fn install(request: MarketRequest) -> Result<MarketInstallResult, String> {
    let item = load_catalog()?
        .into_iter()
        .find(|item| item.id == request.id)
        .ok_or_else(|| format!("市场项目不存在: {}", request.id))?;
    if !item
        .targets
        .iter()
        .any(|target| target == &request.query.target)
    {
        return Err(format!("{} 不支持当前目标", item.title));
    }
    let revision = latest_github_revision(&item.repository)?;
    let inventory = match item.kind.as_str() {
        "mcp" => install_mcp(&request.query, &item, &revision)?,
        "skill" => install_skill(&request.query, &item, &revision)?,
        "prompt" => install_prompt(&request.query, &item, &revision)?,
        other => return Err(format!("不支持的市场项目类型: {other}")),
    };
    Ok(MarketInstallResult {
        message: format!("{} 已安装或更新", item.title),
        inventory,
    })
}

pub fn is_safe_repository_url(url: &str) -> bool {
    extensions::normalize_repository_url(url).as_deref() == Some(url.trim_end_matches('/'))
}

fn revision_status(
    installed: bool,
    installed_revision: Option<&str>,
    latest_revision: Option<&str>,
) -> (bool, String) {
    if !installed {
        return (false, "未安装".to_string());
    }
    let Some(installed_revision) = installed_revision else {
        return (false, "版本未知".to_string());
    };
    let Some(latest_revision) = latest_revision else {
        return (false, "检查失败".to_string());
    };
    if installed_revision == latest_revision {
        (false, "已是最新".to_string())
    } else {
        (true, "有更新".to_string())
    }
}

fn load_catalog() -> Result<Vec<MarketItem>, String> {
    serde_json::from_str(CATALOG).map_err(|error| format!("扩展市场清单无效: {error}"))
}

fn installed_state(inventory: &ExtensionInventory, item: &MarketItem) -> (bool, Option<String>) {
    match item.kind.as_str() {
        "mcp" => inventory
            .mcp_servers
            .iter()
            .find(|entry| entry.name == item.name)
            .map(|entry| (true, entry.revision.clone()))
            .unwrap_or((false, None)),
        "skill" => inventory
            .skills
            .iter()
            .find(|entry| entry.id == item.name && !entry.built_in)
            .map(|entry| (true, entry.revision.clone()))
            .unwrap_or((false, None)),
        "prompt" => inventory
            .prompts
            .iter()
            .find(|entry| entry.id == item.name)
            .map(|entry| (true, entry.revision.clone()))
            .unwrap_or((false, None)),
        _ => (false, None),
    }
}

fn install_mcp(
    query: &ExtensionQuery,
    item: &MarketItem,
    revision: &str,
) -> Result<ExtensionInventory, String> {
    let existing = extensions::mcp_details(McpLookupRequest {
        query: query.clone(),
        name: item.name.clone(),
    })
    .ok();
    let workspace = query
        .workspace
        .clone()
        .or_else(|| {
            std::env::var_os("I18N_WORKBENCH_USER_HOME")
                .map(|value| value.to_string_lossy().into_owned())
        })
        .or_else(|| std::env::var_os("HOME").map(|value| value.to_string_lossy().into_owned()))
        .or_else(|| {
            std::env::var_os("USERPROFILE").map(|value| value.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| ".".to_string());
    let args = item
        .args
        .iter()
        .map(|argument| argument.replace("${workspace}", &workspace))
        .collect();
    extensions::save_mcp(McpSaveRequest {
        query: query.clone(),
        original_name: Some(item.name.clone()),
        name: item.name.clone(),
        transport: item.transport.clone(),
        command: item.command.clone(),
        url: item.url.clone(),
        args,
        env: existing
            .as_ref()
            .map(|details| {
                details
                    .env
                    .iter()
                    .map(|field| SecretFieldInput {
                        key: field.key.clone(),
                        value: field.value.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        headers: existing
            .as_ref()
            .map(|details| {
                details
                    .headers
                    .iter()
                    .map(|field| SecretFieldInput {
                        key: field.key.clone(),
                        value: field.value.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        enabled: existing
            .as_ref()
            .map(|details| details.enabled)
            .unwrap_or(true),
    })?;
    extensions::tag_mcp_origin(query.clone(), &item.name, &item.repository, revision)
}

fn install_skill(
    query: &ExtensionQuery,
    item: &MarketItem,
    revision: &str,
) -> Result<ExtensionInventory, String> {
    let mut files = if let Some(source_path) = item.source_path.as_deref() {
        fetch_repository_directory(&item.repository, source_path, revision)?
    } else {
        let raw_url = item
            .raw_url
            .as_deref()
            .ok_or_else(|| format!("{} 缺少 Skill 下载地址", item.title))?;
        vec![extensions::SkillBundleFile {
            relative_path: "SKILL.md".to_string(),
            data: fetch_text(raw_url)?.into_bytes(),
        }]
    };
    let skill_file = files
        .iter_mut()
        .find(|file| file.relative_path == "SKILL.md")
        .ok_or_else(|| format!("{} 的仓库目录缺少 SKILL.md", item.title))?;
    let content = String::from_utf8(skill_file.data.clone())
        .map_err(|_| format!("{} 的 SKILL.md 不是 UTF-8", item.title))?;
    skill_file.data = attach_origin(
        &content,
        &item.name,
        &item.description,
        &item.repository,
        revision,
    )
    .into_bytes();
    extensions::install_skill_bundle(query.clone(), &item.name, files)
}

fn install_prompt(
    query: &ExtensionQuery,
    item: &MarketItem,
    revision: &str,
) -> Result<ExtensionInventory, String> {
    let body = item
        .content
        .as_deref()
        .ok_or_else(|| format!("{} 缺少提示词内容", item.title))?;
    let content = attach_origin(
        body,
        &item.name,
        &item.description,
        &item.repository,
        revision,
    );
    extensions::install_market_prompt(query.clone(), &item.name, content)
}

fn attach_origin(
    content: &str,
    name: &str,
    description: &str,
    repository: &str,
    revision: &str,
) -> String {
    let (preserved, body) = if content.trim_start().starts_with("---") {
        let mut lines = content.lines();
        let _ = lines.next();
        let mut preserved = Vec::new();
        let mut body = Vec::new();
        let mut in_frontmatter = true;
        for line in lines {
            if in_frontmatter && line.trim() == "---" {
                in_frontmatter = false;
                continue;
            }
            if in_frontmatter {
                let key = line.split_once(':').map(|(key, _)| key.trim());
                if !matches!(
                    key,
                    Some("name" | "description" | "repository" | "revision")
                ) {
                    preserved.push(line);
                }
                continue;
            }
            body.push(line);
        }
        (preserved.join("\n"), body.join("\n"))
    } else {
        (String::new(), content.to_string())
    };
    let preserved = if preserved.is_empty() {
        String::new()
    } else {
        format!("{preserved}\n")
    };
    format!(
        "---\nname: {name}\ndescription: \"{}\"\n{preserved}repository: {repository}\nrevision: {revision}\n---\n\n{}\n",
        description.replace('"', "'"),
        body.trim()
    )
}

fn latest_github_revision(repository: &str) -> Result<String, String> {
    let repository = extensions::normalize_repository_url(repository)
        .ok_or_else(|| "GitHub 仓库地址无效".to_string())?;
    let slug = repository.trim_start_matches("https://github.com/");
    let url = format!("https://api.github.com/repos/{slug}/commits?per_page=1");
    let agent = network::platform_agent(Duration::from_secs(12));
    let mut response = agent
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "cursor-i18n-zh-workbench")
        .call()
        .map_err(github_error)?;
    let value = response
        .body_mut()
        .read_json::<Value>()
        .map_err(|error| format!("GitHub 提交响应格式错误: {error}"))?;
    value
        .as_array()
        .and_then(|items| items.first())
        .and_then(|item| item.get("sha"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "GitHub 仓库没有可识别的最新提交".to_string())
}

fn fetch_text(url: &str) -> Result<String, String> {
    if !url.starts_with("https://raw.githubusercontent.com/") {
        return Err("市场只允许从 GitHub Raw 下载 Skill".to_string());
    }
    let agent = network::platform_agent(Duration::from_secs(15));
    let mut response = agent
        .get(url)
        .header("User-Agent", "cursor-i18n-zh-workbench")
        .call()
        .map_err(github_error)?;
    response
        .body_mut()
        .read_to_string()
        .map_err(|error| format!("读取 Skill 下载内容失败: {error}"))
}

fn fetch_repository_directory(
    repository: &str,
    source_path: &str,
    revision: &str,
) -> Result<Vec<extensions::SkillBundleFile>, String> {
    const MAX_FILES: usize = 128;
    const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
    const MAX_TOTAL_BYTES: usize = 8 * 1024 * 1024;

    if source_path.is_empty()
        || source_path.starts_with('/')
        || source_path.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
    {
        return Err(format!("市场 Skill 仓库路径无效: {source_path}"));
    }
    let repository = extensions::normalize_repository_url(repository)
        .ok_or_else(|| "GitHub 仓库地址无效".to_string())?;
    let slug = repository.trim_start_matches("https://github.com/");
    let agent = network::platform_agent(Duration::from_secs(20));
    let mut pending = VecDeque::from([source_path.to_string()]);
    let mut result = Vec::new();
    let mut total_bytes = 0usize;
    while let Some(path) = pending.pop_front() {
        let url = format!("https://api.github.com/repos/{slug}/contents/{path}?ref={revision}");
        let mut response = agent
            .get(&url)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "cursor-i18n-zh-workbench")
            .call()
            .map_err(github_error)?;
        let value = response
            .body_mut()
            .read_json::<Value>()
            .map_err(|error| format!("GitHub Skill 目录响应格式错误: {error}"))?;
        let entries = value
            .as_array()
            .ok_or_else(|| format!("GitHub Skill 路径不是目录: {path}"))?;
        for entry in entries {
            let entry_type = entry
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let entry_path = entry
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| "GitHub Skill 目录项缺少 path".to_string())?;
            match entry_type {
                "dir" => pending.push_back(entry_path.to_string()),
                "file" => {
                    if result.len() >= MAX_FILES {
                        return Err(format!("市场 Skill 文件超过 {MAX_FILES} 个, 已拒绝安装"));
                    }
                    let size = entry.get("size").and_then(Value::as_u64).unwrap_or(0) as usize;
                    if size > MAX_FILE_BYTES {
                        return Err(format!("市场 Skill 单文件超过 2 MB: {entry_path}"));
                    }
                    let download_url = entry
                        .get("download_url")
                        .and_then(Value::as_str)
                        .ok_or_else(|| format!("GitHub Skill 文件缺少下载地址: {entry_path}"))?;
                    let data = fetch_bytes(&agent, download_url)?;
                    if data.len() > MAX_FILE_BYTES {
                        return Err(format!("市场 Skill 单文件超过 2 MB: {entry_path}"));
                    }
                    total_bytes = total_bytes.saturating_add(data.len());
                    if total_bytes > MAX_TOTAL_BYTES {
                        return Err("市场 Skill 总大小超过 8 MB, 已拒绝安装".to_string());
                    }
                    let relative = entry_path
                        .strip_prefix(source_path)
                        .and_then(|value| value.strip_prefix('/'))
                        .ok_or_else(|| format!("GitHub Skill 文件越出目录: {entry_path}"))?;
                    result.push(extensions::SkillBundleFile {
                        relative_path: relative.to_string(),
                        data,
                    });
                }
                _ => return Err(format!("市场 Skill 包含不支持的目录项: {entry_path}")),
            }
        }
    }
    Ok(result)
}

fn fetch_bytes(agent: &ureq::Agent, url: &str) -> Result<Vec<u8>, String> {
    if !url.starts_with("https://raw.githubusercontent.com/") {
        return Err("市场只允许从 GitHub Raw 下载 Skill 文件".to_string());
    }
    let mut response = agent
        .get(url)
        .header("User-Agent", "cursor-i18n-zh-workbench")
        .call()
        .map_err(github_error)?;
    response
        .body_mut()
        .read_to_vec()
        .map_err(|error| format!("读取 Skill 文件失败: {error}"))
}

fn github_error(error: Error) -> String {
    match error {
        Error::StatusCode(404) => "GitHub 市场资源不存在".to_string(),
        Error::StatusCode(403 | 429) => "GitHub 市场请求暂时受限, 请稍后重试".to_string(),
        Error::StatusCode(code) => format!("GitHub 市场接口返回 HTTP {code}"),
        other => format!("连接 GitHub 扩展市场失败: {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_a_targeted_curated_catalog() {
        let catalog = load_catalog().unwrap();
        assert!(catalog.iter().any(|item| item.kind == "mcp"));
        assert!(catalog.iter().any(|item| item.kind == "skill"));
        assert!(catalog.iter().any(|item| item.kind == "prompt"));
        assert!(catalog
            .iter()
            .all(|item| is_safe_repository_url(&item.repository)));
    }

    #[test]
    fn attaches_repository_and_revision_while_preserving_skill_metadata() {
        let content = attach_origin(
            "---\nname: old\nallowed-tools: Read, Write\n---\n\n# Body\n",
            "review",
            "Review code",
            "https://github.com/example/repo",
            "abc123",
        );
        assert!(content.contains("name: review"));
        assert!(content.contains("revision: abc123"));
        assert!(content.contains("allowed-tools: Read, Write"));
        assert!(content.contains("# Body"));
    }

    #[test]
    fn distinguishes_unknown_failed_current_and_outdated_revisions() {
        assert_eq!(
            revision_status(false, None, None),
            (false, "未安装".to_string())
        );
        assert_eq!(
            revision_status(true, None, Some("latest")),
            (false, "版本未知".to_string())
        );
        assert_eq!(
            revision_status(true, Some("installed"), None),
            (false, "检查失败".to_string())
        );
        assert_eq!(
            revision_status(true, Some("same"), Some("same")),
            (false, "已是最新".to_string())
        );
        assert_eq!(
            revision_status(true, Some("old"), Some("new")),
            (true, "有更新".to_string())
        );
    }

    #[test]
    #[ignore = "requires access to GitHub"]
    fn loads_market_revisions_from_github() {
        let items = catalog_for(ExtensionQuery {
            target: "cursor".to_string(),
            scope: "user".to_string(),
            workspace: None,
        })
        .unwrap();
        assert!(items.iter().any(|item| item.latest_revision.is_some()));
    }

    #[test]
    #[ignore = "requires access to GitHub"]
    fn downloads_complete_skill_directory_from_github() {
        let repository = "https://github.com/anthropics/skills";
        let revision = latest_github_revision(repository).unwrap();
        let files =
            fetch_repository_directory(repository, "skills/skill-creator", &revision).unwrap();
        assert!(files.iter().any(|file| file.relative_path == "SKILL.md"));
        assert!(files.len() > 1);
    }
}
