use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::adapters::{local_app_data, restore_user_ownership};

const REDACTED_VALUE: &str = "••••••";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionQuery {
    pub target: String,
    pub scope: String,
    pub workspace: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInventory {
    pub target: String,
    pub target_label: String,
    pub scope: String,
    pub workspace: Option<String>,
    pub mcp_config_path: String,
    pub skill_root: String,
    pub prompt_root: String,
    pub mcp_servers: Vec<McpServerSummary>,
    pub skills: Vec<SkillSummary>,
    pub prompts: Vec<PromptSummary>,
    pub active_mcp_count: usize,
    pub enabled_skill_count: usize,
    pub enabled_prompt_count: usize,
    pub prompt_editable: bool,
    pub prompt_note: String,
    pub note: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerSummary {
    pub name: String,
    pub transport: String,
    pub endpoint: String,
    pub enabled: bool,
    pub env_keys: Vec<String>,
    pub header_keys: Vec<String>,
    pub args_count: usize,
    pub source: String,
    pub repository: Option<String>,
    pub revision: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretField {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerDetails {
    pub name: String,
    pub transport: String,
    pub command: String,
    pub url: String,
    pub args: Vec<String>,
    pub env: Vec<SecretField>,
    pub headers: Vec<SecretField>,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub built_in: bool,
    pub source: String,
    pub path: String,
    pub repository: Option<String>,
    pub revision: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub source: String,
    pub path: String,
    pub repository: Option<String>,
    pub revision: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDetails {
    pub name: String,
    pub content: String,
    pub enabled: bool,
    pub built_in: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptDetails {
    pub name: String,
    pub content: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpLookupRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSaveRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub original_name: Option<String>,
    pub name: String,
    pub transport: String,
    pub command: String,
    pub url: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<SecretFieldInput>,
    #[serde(default)]
    pub headers: Vec<SecretFieldInput>,
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretFieldInput {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToggleRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub name: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillLookupRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub name: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSaveRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub original_name: Option<String>,
    pub name: String,
    pub content: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillToggleRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub name: String,
    pub enabled: bool,
}

pub struct SkillBundleFile {
    pub relative_path: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptLookupRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub name: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptSaveRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub original_name: Option<String>,
    pub name: String,
    pub content: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptToggleRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub name: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionMutationResult {
    pub message: String,
    pub inventory: ExtensionInventory,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Target {
    Cursor,
    ClaudeCode,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Scope {
    User,
    Project,
}

#[derive(Debug)]
struct ExtensionPaths {
    target: Target,
    scope: Scope,
    workspace: Option<PathBuf>,
    mcp_config: PathBuf,
    mcp_disabled: PathBuf,
    skill_root: PathBuf,
    skill_disabled_root: PathBuf,
    prompt_root: PathBuf,
    prompt_disabled_root: PathBuf,
    read_only_skill_roots: Vec<(PathBuf, String)>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct ExtensionRegistry {
    #[serde(default)]
    mcp: BTreeMap<String, RegistryOrigin>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct RegistryOrigin {
    repository: String,
    revision: String,
}

pub fn inventory(query: ExtensionQuery) -> Result<ExtensionInventory, String> {
    inventory_with_home(query, &home_dir()?)
}

pub fn mcp_details(request: McpLookupRequest) -> Result<McpServerDetails, String> {
    let paths = resolve_paths(&request.query, &home_dir()?)?;
    validate_mcp_name(&request.name)?;
    let active = load_document(&paths.mcp_config)?;
    let disabled = load_document(&paths.mcp_disabled)?;
    if let Some(value) = server_map(&active).get(&request.name) {
        return Ok(details_from_value(&request.name, value, true));
    }
    if let Some(value) = server_map(&disabled).get(&request.name) {
        return Ok(details_from_value(&request.name, value, false));
    }
    Err(format!("未找到 MCP 服务: {}", request.name))
}

pub fn save_mcp(request: McpSaveRequest) -> Result<ExtensionMutationResult, String> {
    let home = home_dir()?;
    let query = request.query.clone();
    let original_name = request.original_name.clone();
    let name = request.name.clone();
    let result = save_mcp_with_home(request, &home);
    if result.is_ok() {
        if let Some(original_name) = original_name.filter(|original| original != &name) {
            migrate_mcp_origin(&query, &home, &original_name, &name);
        }
    }
    repair_extension_ownership(&query, &home);
    result
}

fn save_mcp_with_home(
    request: McpSaveRequest,
    home: &Path,
) -> Result<ExtensionMutationResult, String> {
    let paths = resolve_paths(&request.query, &home)?;
    validate_mcp_name(&request.name)?;
    validate_transport(&request)?;
    let mut active = load_document(&paths.mcp_config)?;
    let mut disabled = load_document(&paths.mcp_disabled)?;
    let original_name = request
        .original_name
        .as_deref()
        .unwrap_or(request.name.as_str());
    validate_mcp_name(original_name)?;
    let existing = remove_server(&mut active, original_name)
        .or_else(|| remove_server(&mut disabled, original_name));
    if request.name != original_name
        && (server_map(&active).contains_key(&request.name)
            || server_map(&disabled).contains_key(&request.name))
    {
        return Err(format!("MCP 名称已存在: {}", request.name));
    }
    let value = build_server_value(existing.as_ref(), &request)?;
    let target_document = if request.enabled {
        &mut active
    } else {
        &mut disabled
    };
    server_map_mut(target_document)?.insert(request.name.clone(), value);
    commit_documents(&[
        (&paths.mcp_config, &active),
        (&paths.mcp_disabled, &disabled),
    ])?;
    let inventory = inventory_with_home(request.query, &home)?;
    Ok(ExtensionMutationResult {
        message: format!("MCP 服务 {} 已保存", request.name),
        inventory,
    })
}

pub fn toggle_mcp(request: McpToggleRequest) -> Result<ExtensionMutationResult, String> {
    let home = home_dir()?;
    let query = request.query.clone();
    let result = toggle_mcp_with_home(request, &home);
    repair_extension_ownership(&query, &home);
    result
}

fn toggle_mcp_with_home(
    request: McpToggleRequest,
    home: &Path,
) -> Result<ExtensionMutationResult, String> {
    let paths = resolve_paths(&request.query, &home)?;
    validate_mcp_name(&request.name)?;
    let mut active = load_document(&paths.mcp_config)?;
    let mut disabled = load_document(&paths.mcp_disabled)?;
    let value = if request.enabled {
        remove_server(&mut disabled, &request.name)
            .ok_or_else(|| format!("未找到已停用的 MCP 服务: {}", request.name))?
    } else {
        remove_server(&mut active, &request.name)
            .ok_or_else(|| format!("未找到已启用的 MCP 服务: {}", request.name))?
    };
    let destination = if request.enabled {
        &mut active
    } else {
        &mut disabled
    };
    server_map_mut(destination)?.insert(request.name.clone(), value);
    commit_documents(&[
        (&paths.mcp_config, &active),
        (&paths.mcp_disabled, &disabled),
    ])?;
    let inventory = inventory_with_home(request.query, &home)?;
    Ok(ExtensionMutationResult {
        message: format!(
            "MCP 服务 {} 已{}",
            request.name,
            if request.enabled { "启用" } else { "停用" }
        ),
        inventory,
    })
}

pub fn delete_mcp(request: McpLookupRequest) -> Result<ExtensionMutationResult, String> {
    let home = home_dir()?;
    let query = request.query.clone();
    let name = request.name.clone();
    let result = delete_mcp_with_home(request, &home);
    if result.is_ok() {
        remove_mcp_origin(&query, &home, &name);
    }
    repair_extension_ownership(&query, &home);
    result
}

pub fn tag_mcp_origin(
    query: ExtensionQuery,
    name: &str,
    repository: &str,
    revision: &str,
) -> Result<ExtensionInventory, String> {
    let home = home_dir()?;
    let paths = resolve_paths(&query, &home)?;
    validate_mcp_name(name)?;
    let repository = normalize_repository_url(repository)
        .ok_or_else(|| "市场项目 GitHub 仓库地址无效".to_string())?;
    let active = load_document(&paths.mcp_config)?;
    let disabled = load_document(&paths.mcp_disabled)?;
    if !server_map(&active).contains_key(name) && !server_map(&disabled).contains_key(name) {
        return Err(format!("未找到要标记来源的 MCP 服务: {name}"));
    }
    let mut registry = load_registry(&paths);
    registry.mcp.insert(
        name.to_string(),
        RegistryOrigin {
            repository,
            revision: revision.to_string(),
        },
    );
    save_registry(&paths, &registry)?;
    repair_extension_ownership(&query, &home);
    inventory_with_home(query, &home)
}

fn delete_mcp_with_home(
    request: McpLookupRequest,
    home: &Path,
) -> Result<ExtensionMutationResult, String> {
    let paths = resolve_paths(&request.query, &home)?;
    validate_mcp_name(&request.name)?;
    let mut active = load_document(&paths.mcp_config)?;
    let mut disabled = load_document(&paths.mcp_disabled)?;
    let removed = remove_server(&mut active, &request.name)
        .or_else(|| remove_server(&mut disabled, &request.name));
    if removed.is_none() {
        return Err(format!("未找到 MCP 服务: {}", request.name));
    }
    commit_documents(&[
        (&paths.mcp_config, &active),
        (&paths.mcp_disabled, &disabled),
    ])?;
    let inventory = inventory_with_home(request.query, &home)?;
    Ok(ExtensionMutationResult {
        message: format!("MCP 服务 {} 已删除, 原配置已备份", request.name),
        inventory,
    })
}

pub fn skill_details(request: SkillLookupRequest) -> Result<SkillDetails, String> {
    let paths = resolve_paths(&request.query, &home_dir()?)?;
    validate_skill_name(&request.name, "Skill 名称")?;
    let root = if request.enabled {
        &paths.skill_root
    } else {
        &paths.skill_disabled_root
    };
    let path = root.join(&request.name).join("SKILL.md");
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取 {}: {error}", path.display()))?;
    Ok(SkillDetails {
        name: request.name,
        content,
        enabled: request.enabled,
        built_in: false,
    })
}

pub fn save_skill(request: SkillSaveRequest) -> Result<ExtensionMutationResult, String> {
    let home = home_dir()?;
    let query = request.query.clone();
    let result = save_skill_with_home(request, &home);
    repair_extension_ownership(&query, &home);
    result
}

pub fn install_skill_bundle(
    query: ExtensionQuery,
    name: &str,
    files: Vec<SkillBundleFile>,
) -> Result<ExtensionInventory, String> {
    let home = home_dir()?;
    install_skill_bundle_with_home(query, name, files, &home)
}

fn install_skill_bundle_with_home(
    query: ExtensionQuery,
    name: &str,
    files: Vec<SkillBundleFile>,
    home: &Path,
) -> Result<ExtensionInventory, String> {
    let paths = resolve_paths(&query, home)?;
    validate_skill_name(name, "Skill 名称")?;
    if !files.iter().any(|file| file.relative_path == "SKILL.md") {
        return Err("市场 Skill 缺少 SKILL.md".to_string());
    }
    fs::create_dir_all(&paths.skill_root)
        .map_err(|error| format!("无法创建 Skill 目录: {error}"))?;
    let staging = paths
        .skill_root
        .join(format!(".{name}.market-staging-{}", now_stamp()));
    fs::create_dir_all(&staging).map_err(|error| format!("无法创建 Skill 暂存目录: {error}"))?;
    let staged = (|| {
        for file in &files {
            let relative = validate_bundle_relative_path(&file.relative_path)?;
            atomic_write(&staging.join(relative), &file.data)?;
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = staged {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    let active = paths.skill_root.join(name);
    let disabled = paths.skill_disabled_root.join(name);
    let existing_disabled = disabled.is_dir();
    let existing = if active.is_dir() {
        Some(active.clone())
    } else if existing_disabled {
        Some(disabled.clone())
    } else {
        None
    };
    let destination = if existing_disabled { disabled } else { active };
    if let Some(source) = &existing {
        let backup = local_app_data()
            .join("extension-config-backups/skills")
            .join(target_id(paths.target))
            .join(scope_id(paths.scope))
            .join(format!("{}-{name}", now_stamp()));
        copy_directory(source, &backup)?;
    }

    let rollback = existing
        .as_ref()
        .map(|source| source.with_file_name(format!(".{name}.rollback-{}", now_stamp())));
    if let (Some(source), Some(rollback)) = (&existing, &rollback) {
        fs::rename(source, rollback).map_err(|error| format!("无法暂存原 Skill 目录: {error}"))?;
    }
    if let Err(error) = fs::rename(&staging, &destination) {
        if let (Some(source), Some(rollback)) = (&existing, &rollback) {
            let _ = fs::rename(rollback, source);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("无法提交市场 Skill: {error}"));
    }
    if let Some(rollback) = rollback {
        let _ = fs::remove_dir_all(rollback);
    }
    repair_extension_ownership(&query, home);
    inventory_with_home(query, home)
}

fn validate_bundle_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if value.is_empty()
        || value.len() > 240
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(format!("市场 Skill 文件路径不安全: {value}"));
    }
    Ok(path.to_path_buf())
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| format!("无法创建 Skill 备份目录: {error}"))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("无法读取 Skill 目录 {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("无法读取 Skill 目录项: {error}"))?;
        let kind = entry
            .file_type()
            .map_err(|error| format!("无法读取 Skill 文件类型: {error}"))?;
        let target = destination.join(entry.file_name());
        if kind.is_symlink() {
            return Err(format!(
                "Skill 备份拒绝符号链接: {}",
                entry.path().display()
            ));
        } else if kind.is_dir() {
            copy_directory(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &target)
                .map_err(|error| format!("无法备份 Skill 文件: {error}"))?;
        }
    }
    Ok(())
}

fn save_skill_with_home(
    request: SkillSaveRequest,
    home: &Path,
) -> Result<ExtensionMutationResult, String> {
    let paths = resolve_paths(&request.query, &home)?;
    validate_skill_name(&request.name, "Skill 名称")?;
    if request.content.trim().is_empty() {
        return Err("SKILL.md 内容不能为空".to_string());
    }
    let root = if request.enabled {
        &paths.skill_root
    } else {
        &paths.skill_disabled_root
    };
    fs::create_dir_all(root)
        .map_err(|error| format!("无法创建 Skill 目录 {}: {error}", root.display()))?;
    let original_name = request
        .original_name
        .as_deref()
        .unwrap_or(request.name.as_str());
    validate_skill_name(original_name, "原 Skill 名称")?;
    let original_root = if paths.skill_root.join(original_name).is_dir() {
        &paths.skill_root
    } else {
        &paths.skill_disabled_root
    };
    let original_dir = original_root.join(original_name);
    let target_dir = root.join(&request.name);
    if request.name != original_name && target_dir.exists() {
        return Err(format!("Skill 名称已存在: {}", request.name));
    }
    if original_dir.exists() && original_dir != target_dir {
        fs::rename(&original_dir, &target_dir).map_err(|error| {
            format!(
                "无法移动 Skill {} 到 {}: {error}",
                original_dir.display(),
                target_dir.display()
            )
        })?;
    } else {
        fs::create_dir_all(&target_dir)
            .map_err(|error| format!("无法创建 Skill 目录 {}: {error}", target_dir.display()))?;
    }
    atomic_write(&target_dir.join("SKILL.md"), request.content.as_bytes())?;
    let inventory = inventory_with_home(request.query, &home)?;
    Ok(ExtensionMutationResult {
        message: format!("Skill {} 已保存", request.name),
        inventory,
    })
}

pub fn toggle_skill(request: SkillToggleRequest) -> Result<ExtensionMutationResult, String> {
    let home = home_dir()?;
    let query = request.query.clone();
    let result = toggle_skill_with_home(request, &home);
    repair_extension_ownership(&query, &home);
    result
}

fn toggle_skill_with_home(
    request: SkillToggleRequest,
    home: &Path,
) -> Result<ExtensionMutationResult, String> {
    let paths = resolve_paths(&request.query, &home)?;
    validate_skill_name(&request.name, "Skill 名称")?;
    let (source_root, destination_root) = if request.enabled {
        (&paths.skill_disabled_root, &paths.skill_root)
    } else {
        (&paths.skill_root, &paths.skill_disabled_root)
    };
    let source = source_root.join(&request.name);
    let destination = destination_root.join(&request.name);
    if !source.is_dir() {
        return Err(format!("未找到 Skill: {}", request.name));
    }
    if destination.exists() {
        return Err(format!("目标 Skill 已存在: {}", destination.display()));
    }
    fs::create_dir_all(destination_root).map_err(|error| {
        format!(
            "无法创建 Skill 目录 {}: {error}",
            destination_root.display()
        )
    })?;
    fs::rename(&source, &destination).map_err(|error| {
        format!(
            "无法{} Skill {}: {error}",
            if request.enabled { "启用" } else { "停用" },
            request.name
        )
    })?;
    let inventory = inventory_with_home(request.query, &home)?;
    Ok(ExtensionMutationResult {
        message: format!(
            "Skill {} 已{}",
            request.name,
            if request.enabled { "启用" } else { "停用" }
        ),
        inventory,
    })
}

pub fn delete_skill(request: SkillLookupRequest) -> Result<ExtensionMutationResult, String> {
    let home = home_dir()?;
    let query = request.query.clone();
    let result = delete_skill_with_home(request, &home);
    repair_extension_ownership(&query, &home);
    result
}

fn delete_skill_with_home(
    request: SkillLookupRequest,
    home: &Path,
) -> Result<ExtensionMutationResult, String> {
    delete_skill_with_home_and_trash(request, home, &local_app_data().join("extension-trash"))
}

fn delete_skill_with_home_and_trash(
    request: SkillLookupRequest,
    home: &Path,
    trash_root: &Path,
) -> Result<ExtensionMutationResult, String> {
    let paths = resolve_paths(&request.query, &home)?;
    validate_skill_name(&request.name, "Skill 名称")?;
    let root = if request.enabled {
        &paths.skill_root
    } else {
        &paths.skill_disabled_root
    };
    let source = root.join(&request.name);
    if !source.is_dir() {
        return Err(format!("未找到 Skill: {}", request.name));
    }
    let trash = trash_root
        .join(target_id(paths.target))
        .join(scope_id(paths.scope))
        .join(format!("{}-{}", now_stamp(), request.name));
    fs::create_dir_all(trash.parent().unwrap())
        .map_err(|error| format!("无法创建 Skill 回收目录: {error}"))?;
    fs::rename(&source, &trash).map_err(|error| format!("无法移动 Skill 到回收目录: {error}"))?;
    let inventory = inventory_with_home(request.query, &home)?;
    Ok(ExtensionMutationResult {
        message: format!("Skill {} 已移入工作台回收目录", request.name),
        inventory,
    })
}

pub fn prompt_details(request: PromptLookupRequest) -> Result<PromptDetails, String> {
    let paths = resolve_paths(&request.query, &home_dir()?)?;
    ensure_prompt_scope(&paths)?;
    validate_skill_name(&request.name, "提示词名称")?;
    let root = if request.enabled {
        &paths.prompt_root
    } else {
        &paths.prompt_disabled_root
    };
    let path = prompt_file(root, &request.name, paths.target);
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取提示词 {}: {error}", path.display()))?;
    Ok(PromptDetails {
        name: request.name,
        content,
        enabled: request.enabled,
    })
}

pub fn save_prompt(request: PromptSaveRequest) -> Result<ExtensionMutationResult, String> {
    let home = home_dir()?;
    let query = request.query.clone();
    let result = save_prompt_with_home(request, &home);
    repair_extension_ownership(&query, &home);
    result
}

pub fn install_market_prompt(
    query: ExtensionQuery,
    name: &str,
    content: String,
) -> Result<ExtensionInventory, String> {
    let home = home_dir()?;
    let result = install_market_prompt_with_home(query.clone(), name, content, &home);
    repair_extension_ownership(&query, &home);
    result
}

fn install_market_prompt_with_home(
    query: ExtensionQuery,
    name: &str,
    content: String,
    home: &Path,
) -> Result<ExtensionInventory, String> {
    let paths = resolve_paths(&query, home)?;
    ensure_prompt_scope(&paths)?;
    validate_skill_name(name, "提示词名称")?;
    let enabled = if prompt_file(&paths.prompt_root, name, paths.target).is_file() {
        true
    } else {
        !prompt_file(&paths.prompt_disabled_root, name, paths.target).is_file()
    };
    Ok(save_prompt_with_home(
        PromptSaveRequest {
            query,
            original_name: Some(name.to_string()),
            name: name.to_string(),
            content,
            enabled,
        },
        home,
    )?
    .inventory)
}

fn save_prompt_with_home(
    request: PromptSaveRequest,
    home: &Path,
) -> Result<ExtensionMutationResult, String> {
    let paths = resolve_paths(&request.query, home)?;
    ensure_prompt_scope(&paths)?;
    validate_skill_name(&request.name, "提示词名称")?;
    if request.content.trim().is_empty() {
        return Err("提示词内容不能为空".to_string());
    }
    let root = if request.enabled {
        &paths.prompt_root
    } else {
        &paths.prompt_disabled_root
    };
    fs::create_dir_all(root)
        .map_err(|error| format!("无法创建提示词目录 {}: {error}", root.display()))?;
    let original_name = request
        .original_name
        .as_deref()
        .unwrap_or(request.name.as_str());
    validate_skill_name(original_name, "原提示词名称")?;
    let original_active = prompt_file(&paths.prompt_root, original_name, paths.target);
    let original_disabled = prompt_file(&paths.prompt_disabled_root, original_name, paths.target);
    let original_path = if original_active.is_file() {
        original_active
    } else {
        original_disabled
    };
    let target_path = prompt_file(root, &request.name, paths.target);
    if request.name != original_name && target_path.exists() {
        return Err(format!("提示词名称已存在: {}", request.name));
    }
    if original_path.exists() && original_path != target_path {
        fs::rename(&original_path, &target_path).map_err(|error| {
            format!(
                "无法移动提示词 {} 到 {}: {error}",
                original_path.display(),
                target_path.display()
            )
        })?;
    }
    atomic_write(&target_path, request.content.as_bytes())?;
    let inventory = inventory_with_home(request.query, home)?;
    Ok(ExtensionMutationResult {
        message: format!("提示词 {} 已保存", request.name),
        inventory,
    })
}

pub fn toggle_prompt(request: PromptToggleRequest) -> Result<ExtensionMutationResult, String> {
    let home = home_dir()?;
    let query = request.query.clone();
    let result = toggle_prompt_with_home(request, &home);
    repair_extension_ownership(&query, &home);
    result
}

fn toggle_prompt_with_home(
    request: PromptToggleRequest,
    home: &Path,
) -> Result<ExtensionMutationResult, String> {
    let paths = resolve_paths(&request.query, home)?;
    ensure_prompt_scope(&paths)?;
    validate_skill_name(&request.name, "提示词名称")?;
    let (source_root, destination_root) = if request.enabled {
        (&paths.prompt_disabled_root, &paths.prompt_root)
    } else {
        (&paths.prompt_root, &paths.prompt_disabled_root)
    };
    let source = prompt_file(source_root, &request.name, paths.target);
    let destination = prompt_file(destination_root, &request.name, paths.target);
    if !source.is_file() {
        return Err(format!("未找到提示词: {}", request.name));
    }
    if destination.exists() {
        return Err(format!("目标提示词已存在: {}", destination.display()));
    }
    fs::create_dir_all(destination_root).map_err(|error| format!("无法创建提示词目录: {error}"))?;
    fs::rename(&source, &destination).map_err(|error| format!("无法修改提示词状态: {error}"))?;
    let inventory = inventory_with_home(request.query, home)?;
    Ok(ExtensionMutationResult {
        message: format!(
            "提示词 {} 已{}",
            request.name,
            if request.enabled { "启用" } else { "停用" }
        ),
        inventory,
    })
}

pub fn delete_prompt(request: PromptLookupRequest) -> Result<ExtensionMutationResult, String> {
    let home = home_dir()?;
    let query = request.query.clone();
    let paths = resolve_paths(&request.query, &home)?;
    ensure_prompt_scope(&paths)?;
    validate_skill_name(&request.name, "提示词名称")?;
    let root = if request.enabled {
        &paths.prompt_root
    } else {
        &paths.prompt_disabled_root
    };
    let source = prompt_file(root, &request.name, paths.target);
    if !source.is_file() {
        return Err(format!("未找到提示词: {}", request.name));
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("md");
    let trash = local_app_data()
        .join("extension-trash")
        .join(target_id(paths.target))
        .join(scope_id(paths.scope))
        .join(format!("{}-{}.{}", now_stamp(), request.name, extension));
    fs::create_dir_all(trash.parent().unwrap())
        .map_err(|error| format!("无法创建提示词回收目录: {error}"))?;
    fs::rename(&source, &trash).map_err(|error| format!("无法移动提示词到回收目录: {error}"))?;
    let inventory = inventory_with_home(request.query, &home)?;
    repair_extension_ownership(&query, &home);
    Ok(ExtensionMutationResult {
        message: format!("提示词 {} 已移入工作台回收目录", request.name),
        inventory,
    })
}

fn repair_extension_ownership(query: &ExtensionQuery, home: &Path) {
    let Ok(paths) = resolve_paths(query, home) else {
        return;
    };
    for path in [
        &paths.mcp_config,
        &paths.mcp_disabled,
        &paths.skill_root,
        &paths.skill_disabled_root,
        &paths.prompt_root,
        &paths.prompt_disabled_root,
    ] {
        restore_user_ownership(path);
    }
    restore_user_ownership(&local_app_data().join("extension-config-backups"));
    restore_user_ownership(&local_app_data().join("extension-trash"));
    restore_user_ownership(&local_app_data().join("extension-registry"));
}

fn prompt_file(root: &Path, name: &str, target: Target) -> PathBuf {
    root.join(format!(
        "{}.{}",
        name,
        if target == Target::Cursor {
            "mdc"
        } else {
            "md"
        }
    ))
}

fn ensure_prompt_scope(paths: &ExtensionPaths) -> Result<(), String> {
    if paths.target == Target::Cursor && paths.scope == Scope::User {
        Err("Cursor User Rules 由 Customize > Rules 管理, 没有公开的文件配置格式. 请切换到项目级管理 `.cursor/rules/*.mdc`, 工作台不会修改 Cursor 私有数据库".to_string())
    } else {
        Ok(())
    }
}

pub fn location_for(query: &ExtensionQuery, kind: &str) -> Result<PathBuf, String> {
    let paths = resolve_paths(query, &home_dir()?)?;
    match kind {
        "mcp" => Ok(paths
            .mcp_config
            .parent()
            .unwrap_or(Path::new("."))
            .to_path_buf()),
        "skill" => Ok(paths.skill_root),
        "prompt" => {
            ensure_prompt_scope(&paths)?;
            Ok(paths.prompt_root)
        }
        _ => Err(format!("不支持的扩展目录类型: {kind}")),
    }
}

fn inventory_with_home(query: ExtensionQuery, home: &Path) -> Result<ExtensionInventory, String> {
    let paths = resolve_paths(&query, home)?;
    let active = load_document(&paths.mcp_config)?;
    let disabled = load_document(&paths.mcp_disabled)?;
    let mut mcp_servers = server_map(&active)
        .iter()
        .map(|(name, value)| summary_from_value(name, value, true, paths.scope))
        .collect::<Vec<_>>();
    mcp_servers.extend(
        server_map(&disabled)
            .iter()
            .map(|(name, value)| summary_from_value(name, value, false, paths.scope)),
    );
    mcp_servers.sort_by(|left, right| {
        right
            .enabled
            .cmp(&left.enabled)
            .then_with(|| left.name.cmp(&right.name))
    });
    let registry = load_registry(&paths);
    for server in &mut mcp_servers {
        if let Some(origin) = registry.mcp.get(&server.name) {
            server.repository = Some(origin.repository.clone());
            server.revision = Some(origin.revision.clone());
        }
    }
    let mut skills = scan_skills(&paths.skill_root, true, false, paths.scope, None)?;
    skills.extend(scan_skills(
        &paths.skill_disabled_root,
        false,
        false,
        paths.scope,
        None,
    )?);
    for (root, source) in &paths.read_only_skill_roots {
        skills.extend(scan_skills(root, true, true, Scope::User, Some(source))?);
    }
    skills.sort_by(|left, right| {
        left.built_in
            .cmp(&right.built_in)
            .then_with(|| right.enabled.cmp(&left.enabled))
            .then_with(|| left.name.cmp(&right.name))
    });
    let prompt_editable = !(paths.target == Target::Cursor && paths.scope == Scope::User);
    let mut prompts = if prompt_editable {
        scan_prompts(&paths.prompt_root, true, paths.target, paths.scope)?
    } else {
        Vec::new()
    };
    if prompt_editable {
        prompts.extend(scan_prompts(
            &paths.prompt_disabled_root,
            false,
            paths.target,
            paths.scope,
        )?);
    }
    prompts.sort_by(|left, right| {
        right
            .enabled
            .cmp(&left.enabled)
            .then_with(|| left.name.cmp(&right.name))
    });
    let target_label = match paths.target {
        Target::Cursor => "Cursor",
        Target::ClaudeCode => "Claude Code",
    };
    Ok(ExtensionInventory {
        target: target_id(paths.target).to_string(),
        target_label: target_label.to_string(),
        scope: scope_id(paths.scope).to_string(),
        workspace: paths
            .workspace
            .as_ref()
            .map(|path| path.display().to_string()),
        mcp_config_path: paths.mcp_config.display().to_string(),
        skill_root: paths.skill_root.display().to_string(),
        prompt_root: paths.prompt_root.display().to_string(),
        active_mcp_count: mcp_servers.iter().filter(|server| server.enabled).count(),
        enabled_skill_count: skills
            .iter()
            .filter(|skill| skill.enabled && !skill.built_in)
            .count(),
        enabled_prompt_count: prompts.iter().filter(|prompt| prompt.enabled).count(),
        prompt_editable,
        prompt_note: if !prompt_editable {
            "Cursor 全局 User Rules 只能在 Customize > Rules 中维护. 工作台仅管理项目级 `.cursor/rules/*.mdc`, 避免写入未公开的私有数据库".to_string()
        } else if paths.target == Target::ClaudeCode && paths.scope == Scope::User {
            "Claude Code 官方支持 `~/.claude/rules/*.md` 作为所有项目生效的个人规则".to_string()
        } else {
            "项目级提示词会随当前工作区加载, 可以纳入版本控制".to_string()
        },
        mcp_servers,
        skills,
        prompts,
        note: if paths.scope == Scope::Project {
            "项目级配置仅作用于当前选择的工作区".to_string()
        } else {
            "用户级配置会作用于当前系统账号".to_string()
        },
    })
}

fn resolve_paths(query: &ExtensionQuery, home: &Path) -> Result<ExtensionPaths, String> {
    let target = parse_target(&query.target)?;
    let scope = parse_scope(&query.scope)?;
    let workspace = if scope == Scope::Project {
        let raw = query
            .workspace
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "项目级管理需要先选择工作区".to_string())?;
        let path = normalize_canonical_path(
            fs::canonicalize(raw).map_err(|error| format!("工作区路径无效 {raw}: {error}"))?,
        );
        if !path.is_dir() {
            return Err(format!("工作区不是目录: {}", path.display()));
        }
        Some(path)
    } else {
        None
    };
    let (mcp_config, mcp_disabled, skill_root, skill_disabled_root) = match (target, scope) {
        (Target::Cursor, Scope::User) => (
            home.join(".cursor/mcp.json"),
            home.join(".cursor/mcp.disabled.json"),
            home.join(".cursor/skills"),
            home.join(".cursor/skills-disabled"),
        ),
        (Target::Cursor, Scope::Project) => {
            let root = workspace.as_ref().unwrap();
            (
                root.join(".cursor/mcp.json"),
                root.join(".cursor/mcp.disabled.json"),
                root.join(".cursor/skills"),
                root.join(".cursor/skills-disabled"),
            )
        }
        (Target::ClaudeCode, Scope::User) => (
            home.join(".claude.json"),
            home.join(".claude/mcp.disabled.json"),
            home.join(".claude/skills"),
            home.join(".claude/skills-disabled"),
        ),
        (Target::ClaudeCode, Scope::Project) => {
            let root = workspace.as_ref().unwrap();
            (
                root.join(".mcp.json"),
                root.join(".mcp.disabled.json"),
                root.join(".claude/skills"),
                root.join(".claude/skills-disabled"),
            )
        }
    };
    let (prompt_root, prompt_disabled_root) = match (target, scope) {
        (Target::Cursor, Scope::User) => (
            home.join(".cursor/rules"),
            home.join(".cursor/rules-disabled"),
        ),
        (Target::Cursor, Scope::Project) => {
            let root = workspace.as_ref().unwrap();
            (
                root.join(".cursor/rules"),
                root.join(".cursor/rules-disabled"),
            )
        }
        (Target::ClaudeCode, Scope::User) => (
            home.join(".claude/rules"),
            home.join(".claude/rules-disabled"),
        ),
        (Target::ClaudeCode, Scope::Project) => {
            let root = workspace.as_ref().unwrap();
            (
                root.join(".claude/rules"),
                root.join(".claude/rules-disabled"),
            )
        }
    };
    let read_only_skill_roots = match (target, scope) {
        (Target::Cursor, Scope::User) => vec![
            (
                home.join(".cursor/skills-cursor"),
                "Cursor 内置".to_string(),
            ),
            (home.join(".claude/skills"), "Claude 兼容".to_string()),
            (home.join(".agents/skills"), "Agents 共享".to_string()),
        ],
        (Target::Cursor, Scope::Project) => {
            let root = workspace.as_ref().unwrap();
            vec![
                (root.join(".claude/skills"), "Claude 兼容".to_string()),
                (root.join(".agents/skills"), "Agents 共享".to_string()),
            ]
        }
        _ => Vec::new(),
    };
    Ok(ExtensionPaths {
        target,
        scope,
        workspace,
        mcp_config,
        mcp_disabled,
        skill_root,
        skill_disabled_root,
        prompt_root,
        prompt_disabled_root,
        read_only_skill_roots,
    })
}

fn parse_target(value: &str) -> Result<Target, String> {
    match value {
        "cursor" => Ok(Target::Cursor),
        "claude-code" => Ok(Target::ClaudeCode),
        _ => Err(format!("不支持的扩展目标: {value}")),
    }
}

fn parse_scope(value: &str) -> Result<Scope, String> {
    match value {
        "user" => Ok(Scope::User),
        "project" => Ok(Scope::Project),
        _ => Err(format!("不支持的配置范围: {value}")),
    }
}

fn target_id(target: Target) -> &'static str {
    match target {
        Target::Cursor => "cursor",
        Target::ClaudeCode => "claude-code",
    }
}

fn scope_id(scope: Scope) -> &'static str {
    match scope {
        Scope::User => "user",
        Scope::Project => "project",
    }
}

fn registry_path(paths: &ExtensionPaths) -> PathBuf {
    let identity = format!(
        "{}|{}|{}",
        target_id(paths.target),
        scope_id(paths.scope),
        paths
            .workspace
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|| "user".to_string())
    );
    let digest = Sha256::digest(identity.as_bytes());
    let key = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    local_app_data()
        .join("extension-registry")
        .join(target_id(paths.target))
        .join(scope_id(paths.scope))
        .join(format!("{key}.json"))
}

fn load_registry(paths: &ExtensionPaths) -> ExtensionRegistry {
    let path = registry_path(paths);
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_registry(paths: &ExtensionPaths, registry: &ExtensionRegistry) -> Result<(), String> {
    let path = registry_path(paths);
    let data = serde_json::to_vec_pretty(registry)
        .map_err(|error| format!("无法生成扩展来源注册表: {error}"))?;
    atomic_write(&path, &data)?;
    restore_user_ownership(&path);
    Ok(())
}

fn migrate_mcp_origin(query: &ExtensionQuery, home: &Path, original: &str, name: &str) {
    let Ok(paths) = resolve_paths(query, home) else {
        return;
    };
    let mut registry = load_registry(&paths);
    let Some(origin) = registry.mcp.remove(original) else {
        return;
    };
    registry.mcp.insert(name.to_string(), origin);
    let _ = save_registry(&paths, &registry);
}

fn remove_mcp_origin(query: &ExtensionQuery, home: &Path, name: &str) {
    let Ok(paths) = resolve_paths(query, home) else {
        return;
    };
    let mut registry = load_registry(&paths);
    if registry.mcp.remove(name).is_some() {
        let _ = save_registry(&paths, &registry);
    }
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("I18N_WORKBENCH_USER_HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法确定当前用户目录".to_string())
}

#[cfg(windows)]
fn normalize_canonical_path(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path
    }
}

#[cfg(not(windows))]
fn normalize_canonical_path(path: PathBuf) -> PathBuf {
    path
}

fn empty_document() -> Value {
    serde_json::json!({ "mcpServers": {} })
}

fn load_document(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(empty_document());
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("无法读取 MCP 配置 {}: {error}", path.display()))?;
    let value = serde_json::from_str::<Value>(&raw)
        .map_err(|error| format!("MCP 配置 JSON 无效 {}: {error}", path.display()))?;
    if !value.is_object() {
        return Err(format!("MCP 配置根节点必须是对象: {}", path.display()));
    }
    if value
        .get("mcpServers")
        .is_some_and(|servers| !servers.is_object())
    {
        return Err(format!("mcpServers 必须是对象: {}", path.display()));
    }
    Ok(value)
}

fn server_map(document: &Value) -> &Map<String, Value> {
    if let Some(map) = document.get("mcpServers").and_then(Value::as_object) {
        map
    } else {
        empty_map()
    }
}

fn empty_map() -> &'static Map<String, Value> {
    static EMPTY: std::sync::OnceLock<Map<String, Value>> = std::sync::OnceLock::new();
    EMPTY.get_or_init(Map::new)
}

fn server_map_mut(document: &mut Value) -> Result<&mut Map<String, Value>, String> {
    let root = document
        .as_object_mut()
        .ok_or_else(|| "MCP 配置根节点必须是对象".to_string())?;
    if !root.contains_key("mcpServers") {
        root.insert("mcpServers".to_string(), Value::Object(Map::new()));
    }
    root.get_mut("mcpServers")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "mcpServers 必须是对象".to_string())
}

fn remove_server(document: &mut Value, name: &str) -> Option<Value> {
    server_map_mut(document).ok()?.remove(name)
}

fn validate_mcp_name(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 100 || trimmed.chars().any(char::is_control)
    {
        Err("MCP 名称不能为空、不能包含控制字符且不能超过 100 个字符".to_string())
    } else {
        Ok(())
    }
}

fn validate_skill_name(value: &str, label: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    if valid {
        Ok(())
    } else {
        Err(format!("{label}只能包含字母、数字、点、横线和下划线"))
    }
}

fn validate_transport(request: &McpSaveRequest) -> Result<(), String> {
    match request.transport.as_str() {
        "stdio" if request.command.trim().is_empty() => Err("stdio MCP 必须填写命令".to_string()),
        "http" | "sse" if !is_safe_remote_url(request.url.trim()) => {
            Err("远程 MCP 必须使用 http:// 或 https:// URL".to_string())
        }
        "stdio" | "http" | "sse" => Ok(()),
        other => Err(format!("不支持的 MCP 传输类型: {other}")),
    }
}

fn is_safe_remote_url(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://")
}

fn build_server_value(existing: Option<&Value>, request: &McpSaveRequest) -> Result<Value, String> {
    let mut object = existing
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for key in ["type", "command", "args", "url", "env", "headers"] {
        object.remove(key);
    }
    object.remove("_i18nWorkbench");
    if request.query.target == "claude-code" {
        object.insert("type".to_string(), Value::String(request.transport.clone()));
    }
    if request.transport == "stdio" {
        object.insert(
            "command".to_string(),
            Value::String(request.command.trim().to_string()),
        );
        object.insert(
            "args".to_string(),
            Value::Array(
                request
                    .args
                    .iter()
                    .map(|argument| Value::String(argument.to_string()))
                    .collect(),
            ),
        );
        let env = merge_secret_fields(existing.and_then(|value| value.get("env")), &request.env)?;
        if !env.is_empty() {
            object.insert("env".to_string(), Value::Object(env));
        }
    } else {
        let url = if request.url.contains(REDACTED_VALUE) {
            existing
                .and_then(|value| value.get("url"))
                .and_then(Value::as_str)
                .ok_or_else(|| "无法保留不存在的脱敏 URL".to_string())?
                .to_string()
        } else {
            request.url.trim().to_string()
        };
        object.insert("url".to_string(), Value::String(url));
        let headers = merge_secret_fields(
            existing.and_then(|value| value.get("headers")),
            &request.headers,
        )?;
        if !headers.is_empty() {
            object.insert("headers".to_string(), Value::Object(headers));
        }
    }
    Ok(Value::Object(object))
}

fn merge_secret_fields(
    existing: Option<&Value>,
    fields: &[SecretFieldInput],
) -> Result<Map<String, Value>, String> {
    let existing = existing.and_then(Value::as_object);
    let mut result = Map::new();
    let mut seen = BTreeSet::new();
    for field in fields {
        let key = field.key.trim();
        if key.is_empty() {
            continue;
        }
        if !seen.insert(key.to_string()) {
            return Err(format!("配置字段重复: {key}"));
        }
        let value = if field.value == REDACTED_VALUE {
            existing
                .and_then(|map| map.get(key))
                .cloned()
                .ok_or_else(|| format!("无法保留不存在的脱敏字段: {key}"))?
        } else {
            Value::String(field.value.clone())
        };
        result.insert(key.to_string(), value);
    }
    Ok(result)
}

fn summary_from_value(name: &str, value: &Value, enabled: bool, scope: Scope) -> McpServerSummary {
    let object = value.as_object();
    let command = object
        .and_then(|map| map.get("command"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let url = object
        .and_then(|map| map.get("url"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let transport = object
        .and_then(|map| map.get("type"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            if !url.is_empty() {
                if url.contains("/sse") {
                    "sse".to_string()
                } else {
                    "http".to_string()
                }
            } else {
                "stdio".to_string()
            }
        });
    McpServerSummary {
        name: name.to_string(),
        transport,
        endpoint: if !command.is_empty() {
            command.to_string()
        } else {
            redact_url(url)
        },
        enabled,
        env_keys: object_keys(object.and_then(|map| map.get("env"))),
        header_keys: object_keys(object.and_then(|map| map.get("headers"))),
        args_count: object
            .and_then(|map| map.get("args"))
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0),
        source: if scope == Scope::User {
            "用户级".to_string()
        } else {
            "项目级".to_string()
        },
        repository: workbench_origin(value, "repository").or_else(|| find_github_repository(value)),
        revision: workbench_origin(value, "revision"),
    }
}

fn workbench_origin(value: &Value, key: &str) -> Option<String> {
    value
        .get("_i18nWorkbench")
        .and_then(|origin| origin.get(key))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn find_github_repository(value: &Value) -> Option<String> {
    let raw = value.to_string();
    let start = raw.find("https://github.com/")?;
    let suffix = &raw[start..];
    let end = suffix
        .find(|character: char| {
            character.is_whitespace() || matches!(character, '"' | '\\' | '?' | '#')
        })
        .unwrap_or(suffix.len());
    normalize_repository_url(&suffix[..end])
}

pub fn normalize_repository_url(value: &str) -> Option<String> {
    let value = value.trim().trim_end_matches('/').trim_end_matches(".git");
    let rest = value.strip_prefix("https://github.com/")?;
    let mut parts = rest.split('/').filter(|part| !part.is_empty());
    let owner = parts.next()?;
    let repository = parts.next()?;
    let valid = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    };
    if !valid(owner) || !valid(repository) {
        return None;
    }
    Some(format!("https://github.com/{owner}/{repository}"))
}

fn details_from_value(name: &str, value: &Value, enabled: bool) -> McpServerDetails {
    let summary = summary_from_value(name, value, enabled, Scope::User);
    let object = value.as_object();
    McpServerDetails {
        name: name.to_string(),
        transport: summary.transport,
        command: object
            .and_then(|map| map.get("command"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        url: redact_url(
            object
                .and_then(|map| map.get("url"))
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ),
        args: object
            .and_then(|map| map.get("args"))
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        env: redacted_fields(object.and_then(|map| map.get("env"))),
        headers: redacted_fields(object.and_then(|map| map.get("headers"))),
        enabled,
    }
}

fn object_keys(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_object)
        .map(|object| object.keys().cloned().collect())
        .unwrap_or_default()
}

fn redacted_fields(value: Option<&Value>) -> Vec<SecretField> {
    value
        .and_then(Value::as_object)
        .map(|object| {
            object
                .keys()
                .map(|key| SecretField {
                    key: key.clone(),
                    value: REDACTED_VALUE.to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn redact_url(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    let suffix_index = value.find(['?', '#']).unwrap_or(value.len());
    let mut base = value[..suffix_index].to_string();
    if let Some(scheme_index) = base.find("://") {
        let authority_start = scheme_index + 3;
        let authority_end = base[authority_start..]
            .find('/')
            .map(|index| authority_start + index)
            .unwrap_or(base.len());
        if let Some(at_index) = base[authority_start..authority_end].rfind('@') {
            let absolute_at = authority_start + at_index;
            base.replace_range(authority_start..absolute_at, REDACTED_VALUE);
        }
    }
    if suffix_index < value.len() {
        base.push('?');
        base.push_str(REDACTED_VALUE);
    }
    base
}

fn scan_skills(
    root: &Path,
    enabled: bool,
    built_in: bool,
    scope: Scope,
    source_override: Option<&str>,
) -> Result<Vec<SkillSummary>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(root)
        .map_err(|error| format!("无法扫描 Skill 目录 {}: {error}", root.display()))?;
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let fallback_name = entry.file_name().to_string_lossy().to_string();
        let skill_file = path.join("SKILL.md");
        if !skill_file.is_file() {
            continue;
        }
        let raw = fs::read_to_string(&skill_file).unwrap_or_default();
        let frontmatter = parse_frontmatter(&raw);
        let name = frontmatter
            .get("name")
            .cloned()
            .unwrap_or_else(|| fallback_name.clone());
        let description = frontmatter
            .get("description")
            .cloned()
            .unwrap_or_else(|| "未提供 Skill 描述".to_string());
        let repository = frontmatter
            .get("repository")
            .and_then(|value| normalize_repository_url(value));
        let revision = frontmatter.get("revision").cloned();
        result.push(SkillSummary {
            id: fallback_name,
            name,
            description,
            enabled,
            built_in,
            source: if let Some(source) = source_override {
                source.to_string()
            } else if scope == Scope::User {
                "用户级".to_string()
            } else {
                "项目级".to_string()
            },
            path: path.display().to_string(),
            repository,
            revision,
        });
    }
    Ok(result)
}

fn scan_prompts(
    root: &Path,
    enabled: bool,
    target: Target,
    scope: Scope,
) -> Result<Vec<PromptSummary>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let expected_extension = if target == Target::Cursor {
        "mdc"
    } else {
        "md"
    };
    let mut result = Vec::new();
    for entry in fs::read_dir(root)
        .map_err(|error| format!("无法扫描提示词目录 {}: {error}", root.display()))?
        .flatten()
    {
        let path = entry.path();
        if !path.is_file()
            || path.extension().and_then(|value| value.to_str()) != Some(expected_extension)
        {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        if id.is_empty() {
            continue;
        }
        let raw = fs::read_to_string(&path).unwrap_or_default();
        let frontmatter = parse_frontmatter(&raw);
        result.push(PromptSummary {
            name: frontmatter
                .get("name")
                .cloned()
                .unwrap_or_else(|| id.clone()),
            description: frontmatter
                .get("description")
                .cloned()
                .unwrap_or_else(|| "未提供提示词描述".to_string()),
            repository: frontmatter
                .get("repository")
                .and_then(|value| normalize_repository_url(value)),
            revision: frontmatter.get("revision").cloned(),
            id,
            enabled,
            source: if scope == Scope::User {
                "用户级"
            } else {
                "项目级"
            }
            .to_string(),
            path: path.display().to_string(),
        });
    }
    Ok(result)
}

fn parse_frontmatter(raw: &str) -> BTreeMap<String, String> {
    let mut result = BTreeMap::new();
    let mut lines = raw.lines();
    if lines.next().map(str::trim) != Some("---") {
        return result;
    }
    for line in lines {
        let line = line.trim();
        if line == "---" {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            let value = value.trim().trim_matches(['"', '\'']).to_string();
            result.insert(key.trim().to_string(), value);
        }
    }
    result
}

fn commit_documents(updates: &[(&Path, &Value)]) -> Result<(), String> {
    for (path, _) in updates {
        backup_config(path)?;
    }
    let originals = updates
        .iter()
        .map(|(path, _)| fs::read(path).ok())
        .collect::<Vec<_>>();
    for (index, (path, value)) in updates.iter().enumerate() {
        let data = serde_json::to_vec_pretty(value)
            .map_err(|error| format!("无法生成 MCP 配置 JSON: {error}"))?;
        if let Err(error) = atomic_write(path, &data) {
            for rollback_index in 0..index {
                let rollback_path = updates[rollback_index].0;
                match &originals[rollback_index] {
                    Some(original) => {
                        let _ = atomic_write(rollback_path, original);
                    }
                    None => {
                        let _ = fs::remove_file(rollback_path);
                    }
                }
            }
            return Err(error);
        }
    }
    Ok(())
}

fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("配置路径缺少父目录: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("无法创建目录 {}: {error}", parent.display()))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("config.json");
    let temp = parent.join(format!(".{file_name}.tmp-{}", now_stamp()));
    let mut file = fs::File::create(&temp)
        .map_err(|error| format!("无法创建暂存配置 {}: {error}", temp.display()))?;
    file.write_all(data)
        .map_err(|error| format!("无法写入暂存配置 {}: {error}", temp.display()))?;
    file.sync_all()
        .map_err(|error| format!("无法同步暂存配置 {}: {error}", temp.display()))?;
    drop(file);
    if let Err(error) = replace_file(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(format!("无法提交配置 {}: {error}", path.display()));
    }
    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    if destination.exists() {
        fs::remove_file(destination)?;
    }
    fs::rename(source, destination)
}

fn backup_config(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Ok(());
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("config.json");
    let backup = local_app_data()
        .join("extension-config-backups")
        .join(now_stamp().to_string())
        .join(file_name);
    fs::create_dir_all(backup.parent().unwrap())
        .map_err(|error| format!("无法创建扩展配置备份目录: {error}"))?;
    fs::copy(path, &backup)
        .map(|_| ())
        .map_err(|error| format!("无法备份扩展配置 {}: {error}", path.display()))
}

fn now_stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sandbox() -> PathBuf {
        std::env::temp_dir().join(format!(
            "i18n-workbench-extension-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    fn query(target: &str, scope: &str, workspace: Option<&Path>) -> ExtensionQuery {
        ExtensionQuery {
            target: target.to_string(),
            scope: scope.to_string(),
            workspace: workspace.map(|path| path.display().to_string()),
        }
    }

    #[test]
    fn resolves_user_and_project_configuration_paths() {
        let root = sandbox();
        let home = root.join("home");
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        let cursor = resolve_paths(&query("cursor", "user", None), &home).unwrap();
        assert_eq!(cursor.mcp_config, home.join(".cursor/mcp.json"));
        assert_eq!(cursor.skill_root, home.join(".cursor/skills"));
        let claude =
            resolve_paths(&query("claude-code", "project", Some(&workspace)), &home).unwrap();
        assert!(claude.mcp_config.ends_with(".mcp.json"));
        assert!(claude.skill_root.ends_with(".claude/skills"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn redacts_secrets_and_preserves_masked_values() {
        let existing = serde_json::json!({
            "type": "stdio",
            "command": "npx",
            "env": { "API_KEY": "secret-value" },
            "_i18nWorkbench": {
                "repository": "https://github.com/example/repo",
                "revision": "legacy"
            }
        });
        let details = details_from_value("demo", &existing, true);
        assert_eq!(details.env[0].value, REDACTED_VALUE);
        let request = McpSaveRequest {
            query: query("cursor", "user", None),
            original_name: None,
            name: "demo".to_string(),
            transport: "stdio".to_string(),
            command: "npx".to_string(),
            url: String::new(),
            args: vec!["demo".to_string()],
            env: vec![SecretFieldInput {
                key: "API_KEY".to_string(),
                value: REDACTED_VALUE.to_string(),
            }],
            headers: Vec::new(),
            enabled: true,
        };
        let saved = build_server_value(Some(&existing), &request).unwrap();
        assert_eq!(saved["env"]["API_KEY"], "secret-value");
        assert!(saved.get("_i18nWorkbench").is_none());
    }

    #[test]
    fn redacts_url_credentials_and_preserves_masked_remote_urls() {
        let existing = serde_json::json!({
            "type": "http",
            "url": "https://user:password@example.com/mcp?token=secret"
        });
        let details = details_from_value("remote", &existing, true);
        assert!(details.url.contains(REDACTED_VALUE));
        assert!(!details.url.contains("password"));
        assert!(!details.url.contains("secret"));
        let request = McpSaveRequest {
            query: query("claude-code", "user", None),
            original_name: Some("remote".to_string()),
            name: "remote".to_string(),
            transport: "http".to_string(),
            command: String::new(),
            url: details.url,
            args: Vec::new(),
            env: Vec::new(),
            headers: Vec::new(),
            enabled: true,
        };
        let saved = build_server_value(Some(&existing), &request).unwrap();
        assert_eq!(saved["url"], existing["url"]);
    }

    #[test]
    fn moves_mcp_entries_between_active_and_disabled_files() {
        let root = sandbox();
        let home = root.join("home");
        fs::create_dir_all(&home).unwrap();
        let base_query = query("cursor", "user", None);
        let result = save_mcp_with_home(
            McpSaveRequest {
                query: base_query.clone(),
                original_name: None,
                name: "demo".to_string(),
                transport: "stdio".to_string(),
                command: "npx".to_string(),
                url: String::new(),
                args: vec!["demo-server".to_string()],
                env: Vec::new(),
                headers: Vec::new(),
                enabled: true,
            },
            &home,
        )
        .unwrap();
        assert_eq!(result.inventory.active_mcp_count, 1);
        let result = toggle_mcp_with_home(
            McpToggleRequest {
                query: base_query.clone(),
                name: "demo".to_string(),
                enabled: false,
            },
            &home,
        )
        .unwrap();
        assert_eq!(result.inventory.active_mcp_count, 0);
        assert!(!result.inventory.mcp_servers[0].enabled);
        let result = delete_mcp_with_home(
            McpLookupRequest {
                query: base_query,
                name: "demo".to_string(),
            },
            &home,
        )
        .unwrap();
        assert!(result.inventory.mcp_servers.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scans_enabled_disabled_and_builtin_skills() {
        let root = sandbox();
        let home = root.join("home");
        for (path, name) in [
            (home.join(".cursor/skills/demo/SKILL.md"), "demo"),
            (
                home.join(".cursor/skills-disabled/paused/SKILL.md"),
                "paused",
            ),
            (
                home.join(".cursor/skills-cursor/builtin/SKILL.md"),
                "builtin",
            ),
            (home.join(".claude/skills/shared/SKILL.md"), "shared"),
        ] {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(
                path,
                format!("---\nname: {name}\ndescription: {name} description\n---\n"),
            )
            .unwrap();
        }
        let inventory = inventory_with_home(query("cursor", "user", None), &home).unwrap();
        assert_eq!(inventory.skills.len(), 4);
        assert!(inventory
            .skills
            .iter()
            .any(|skill| skill.built_in && skill.name == "builtin"));
        assert!(inventory
            .skills
            .iter()
            .any(|skill| !skill.enabled && skill.name == "paused"));
        assert!(inventory
            .skills
            .iter()
            .any(|skill| skill.source == "Claude 兼容" && skill.name == "shared"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn creates_edits_and_toggles_skills_without_touching_builtin_skills() {
        let root = sandbox();
        let home = root.join("home");
        fs::create_dir_all(&home).unwrap();
        let base_query = query("claude-code", "user", None);
        let content = "---\nname: review\ndescription: Review code\n---\n\n# Instructions\n";
        let result = save_skill_with_home(
            SkillSaveRequest {
                query: base_query.clone(),
                original_name: None,
                name: "review".to_string(),
                content: content.to_string(),
                enabled: true,
            },
            &home,
        )
        .unwrap();
        assert_eq!(result.inventory.enabled_skill_count, 1);
        assert!(home.join(".claude/skills/review/SKILL.md").is_file());
        let result = toggle_skill_with_home(
            SkillToggleRequest {
                query: base_query,
                name: "review".to_string(),
                enabled: false,
            },
            &home,
        )
        .unwrap();
        assert_eq!(result.inventory.enabled_skill_count, 0);
        assert!(home
            .join(".claude/skills-disabled/review/SKILL.md")
            .is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn deletes_skills_into_the_workbench_trash() {
        let root = sandbox();
        let home = root.join("home");
        let trash = root.join("trash");
        let base_query = query("cursor", "user", None);
        let skill = home.join(".cursor/skills/review");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "# Review\n").unwrap();

        let result = delete_skill_with_home_and_trash(
            SkillLookupRequest {
                query: base_query,
                name: "review".to_string(),
                enabled: true,
            },
            &home,
            &trash,
        )
        .unwrap();

        assert!(result.inventory.skills.is_empty());
        assert!(!skill.exists());
        let moved = trash.join("cursor/user");
        let entries = fs::read_dir(&moved)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].path().join("SKILL.md").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn creates_and_toggles_target_specific_prompt_rules() {
        let root = sandbox();
        let home = root.join("home");
        let workspace = root.join("workspace");
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(&workspace).unwrap();
        let cursor_query = query("cursor", "project", Some(&workspace));
        let result = save_prompt_with_home(
            PromptSaveRequest {
                query: cursor_query.clone(),
                original_name: None,
                name: "quality".to_string(),
                content: "---\nname: quality\ndescription: Quality\n---\n\nVerify changes.\n"
                    .to_string(),
                enabled: true,
            },
            &home,
        )
        .unwrap();
        assert_eq!(result.inventory.enabled_prompt_count, 1);
        assert!(workspace.join(".cursor/rules/quality.mdc").is_file());

        let result = toggle_prompt_with_home(
            PromptToggleRequest {
                query: cursor_query,
                name: "quality".to_string(),
                enabled: false,
            },
            &home,
        )
        .unwrap();
        assert_eq!(result.inventory.enabled_prompt_count, 0);
        assert!(workspace
            .join(".cursor/rules-disabled/quality.mdc")
            .is_file());

        let unsupported = save_prompt_with_home(
            PromptSaveRequest {
                query: query("cursor", "user", None),
                original_name: None,
                name: "global".to_string(),
                content: "Global rule".to_string(),
                enabled: true,
            },
            &home,
        )
        .unwrap_err();
        assert!(unsupported.contains("Customize > Rules"));

        let claude_query = query("claude-code", "user", None);
        save_prompt_with_home(
            PromptSaveRequest {
                query: claude_query,
                original_name: None,
                name: "review".to_string(),
                content: "Review code.\n".to_string(),
                enabled: true,
            },
            &home,
        )
        .unwrap();
        assert!(home.join(".claude/rules/review.md").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn market_prompt_update_preserves_disabled_state() {
        let root = sandbox();
        let home = root.join("home");
        let workspace = root.join("workspace");
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(&workspace).unwrap();
        let query = query("claude-code", "project", Some(&workspace));
        save_prompt_with_home(
            PromptSaveRequest {
                query: query.clone(),
                original_name: None,
                name: "quality".to_string(),
                content: "Old rule.\n".to_string(),
                enabled: false,
            },
            &home,
        )
        .unwrap();

        let inventory =
            install_market_prompt_with_home(query, "quality", "Updated rule.\n".to_string(), &home)
                .unwrap();

        assert_eq!(inventory.enabled_prompt_count, 0);
        assert!(!workspace.join(".claude/rules/quality.md").exists());
        let disabled = workspace.join(".claude/rules-disabled/quality.md");
        assert_eq!(fs::read_to_string(disabled).unwrap(), "Updated rule.\n");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn installs_complete_market_skill_directories() {
        let root = sandbox();
        let home = root.join("home");
        let workspace = root.join("workspace");
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(&workspace).unwrap();
        let inventory = install_skill_bundle_with_home(
            query("cursor", "project", Some(&workspace)),
            "bundle-skill",
            vec![
                SkillBundleFile {
                    relative_path: "SKILL.md".to_string(),
                    data: b"---\nname: bundle-skill\ndescription: Bundle\n---\n".to_vec(),
                },
                SkillBundleFile {
                    relative_path: "scripts/check.sh".to_string(),
                    data: b"#!/bin/sh\nexit 0\n".to_vec(),
                },
                SkillBundleFile {
                    relative_path: "references/guide.md".to_string(),
                    data: b"# Guide\n".to_vec(),
                },
            ],
            &home,
        )
        .unwrap();
        assert_eq!(inventory.enabled_skill_count, 1);
        let installed = workspace.join(".cursor/skills/bundle-skill");
        assert!(installed.join("SKILL.md").is_file());
        assert!(installed.join("scripts/check.sh").is_file());
        assert!(installed.join("references/guide.md").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn market_skill_update_preserves_disabled_state() {
        let root = sandbox();
        let home = root.join("home");
        let workspace = root.join("workspace");
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(&workspace).unwrap();
        let query = query("cursor", "project", Some(&workspace));
        install_skill_bundle_with_home(
            query.clone(),
            "paused-skill",
            vec![SkillBundleFile {
                relative_path: "SKILL.md".to_string(),
                data: b"---\nname: paused-skill\ndescription: Old\n---\n".to_vec(),
            }],
            &home,
        )
        .unwrap();
        toggle_skill_with_home(
            SkillToggleRequest {
                query: query.clone(),
                name: "paused-skill".to_string(),
                enabled: false,
            },
            &home,
        )
        .unwrap();

        let inventory = install_skill_bundle_with_home(
            query,
            "paused-skill",
            vec![SkillBundleFile {
                relative_path: "SKILL.md".to_string(),
                data: b"---\nname: paused-skill\ndescription: Updated\n---\n".to_vec(),
            }],
            &home,
        )
        .unwrap();

        assert_eq!(inventory.enabled_skill_count, 0);
        assert!(!workspace.join(".cursor/skills/paused-skill").exists());
        let disabled = workspace.join(".cursor/skills-disabled/paused-skill/SKILL.md");
        assert!(fs::read_to_string(disabled).unwrap().contains("Updated"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn writes_target_specific_project_mcp_formats() {
        let root = sandbox();
        let home = root.join("home");
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        save_mcp_with_home(
            McpSaveRequest {
                query: query("cursor", "project", Some(&workspace)),
                original_name: None,
                name: "cursor-server".to_string(),
                transport: "stdio".to_string(),
                command: "npx".to_string(),
                url: String::new(),
                args: vec!["server".to_string()],
                env: Vec::new(),
                headers: Vec::new(),
                enabled: true,
            },
            &home,
        )
        .unwrap();
        let cursor: Value =
            serde_json::from_str(&fs::read_to_string(workspace.join(".cursor/mcp.json")).unwrap())
                .unwrap();
        assert!(cursor["mcpServers"]["cursor-server"].get("type").is_none());

        save_mcp_with_home(
            McpSaveRequest {
                query: query("claude-code", "project", Some(&workspace)),
                original_name: None,
                name: "claude-server".to_string(),
                transport: "http".to_string(),
                command: String::new(),
                url: "https://example.com/mcp".to_string(),
                args: Vec::new(),
                env: Vec::new(),
                headers: vec![SecretFieldInput {
                    key: "Authorization".to_string(),
                    value: "Bearer secret".to_string(),
                }],
                enabled: true,
            },
            &home,
        )
        .unwrap();
        let claude: Value =
            serde_json::from_str(&fs::read_to_string(workspace.join(".mcp.json")).unwrap())
                .unwrap();
        assert_eq!(claude["mcpServers"]["claude-server"]["type"], "http");
        assert_eq!(
            claude["mcpServers"]["claude-server"]["headers"]["Authorization"],
            "Bearer secret"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    #[ignore = "reads current user extension configuration"]
    fn scans_current_user_extension_configuration() {
        for target in ["cursor", "claude-code"] {
            let inventory = inventory(query(target, "user", None)).unwrap();
            assert_eq!(inventory.target, target);
            assert!(inventory
                .mcp_servers
                .iter()
                .all(|server| !server.endpoint.contains(REDACTED_VALUE)));
        }
    }
}
