use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::adapters::{local_app_data, restore_user_ownership};

mod health;
mod history;
mod security;
mod targets;
mod transfer;

pub use health::McpHealthResult;
pub use history::ExtensionHistoryRecord;
pub use security::SkillAudit;
pub use targets::ExtensionTargetDescriptor;
pub use transfer::TransferPreview;

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
    pub capabilities: Vec<String>,
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
    pub local_modified: bool,
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
    pub audit: SkillAudit,
    pub local_modified: bool,
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
    pub sha256: String,
    pub local_modified: bool,
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
pub struct McpHealthRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionHistoryRestoreRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionExportRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub path: String,
    #[serde(default)]
    pub include_secrets: bool,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionImportPreviewRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub path: String,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionImportRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub path: String,
    pub conflict_policy: String,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCopyPreviewRequest {
    pub source: ExtensionQuery,
    pub destination: ExtensionQuery,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCopyRequest {
    pub source: ExtensionQuery,
    pub destination: ExtensionQuery,
    pub conflict_policy: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionExportResult {
    pub path: String,
    pub includes_secrets: bool,
    pub encrypted: bool,
    pub mcp_count: usize,
    pub skill_count: usize,
    pub prompt_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionBatchRequest {
    #[serde(flatten)]
    pub query: ExtensionQuery,
    pub kind: String,
    #[serde(default)]
    pub names: Vec<String>,
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
    #[serde(default)]
    skills: BTreeMap<String, RegistryOrigin>,
    #[serde(default)]
    prompts: BTreeMap<String, RegistryOrigin>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct RegistryOrigin {
    repository: String,
    revision: String,
    #[serde(default)]
    content_sha256: Option<String>,
}

pub fn inventory(query: ExtensionQuery) -> Result<ExtensionInventory, String> {
    inventory_with_home(query, &home_dir()?)
}

pub fn extension_targets() -> Vec<ExtensionTargetDescriptor> {
    targets::descriptors()
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

pub fn check_mcp_health(request: McpHealthRequest) -> Result<McpHealthResult, String> {
    let home = home_dir()?;
    let paths = resolve_paths(&request.query, &home)?;
    validate_mcp_name(&request.name)?;
    let active = load_document(&paths.mcp_config)?;
    let disabled = load_document(&paths.mcp_disabled)?;
    let (value, enabled) = if let Some(value) = server_map(&active).get(&request.name) {
        (value, true)
    } else if let Some(value) = server_map(&disabled).get(&request.name) {
        (value, false)
    } else {
        return Err(format!("未找到 MCP 服务: {}", request.name));
    };
    let summary = summary_from_value(&request.name, value, enabled, paths.scope);
    let object = value.as_object();
    let string_map = |field: &str| {
        object
            .and_then(|map| map.get(field))
            .and_then(Value::as_object)
            .map(|map| {
                map.iter()
                    .filter_map(|(key, value)| {
                        value.as_str().map(|value| (key.clone(), value.to_string()))
                    })
                    .collect::<BTreeMap<_, _>>()
            })
            .unwrap_or_default()
    };
    Ok(health::check(health::McpRuntimeConfig {
        name: request.name,
        transport: summary.transport,
        command: object
            .and_then(|map| map.get("command"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        url: object
            .and_then(|map| map.get("url"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
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
        env: string_map("env"),
        headers: string_map("headers"),
        enabled,
        workspace: paths.workspace.or(Some(home)),
    }))
}

pub fn extension_history(query: ExtensionQuery) -> Result<Vec<ExtensionHistoryRecord>, String> {
    let home = home_dir()?;
    history::list(&history_context(&query, &home)?)
}

pub fn restore_extension_history(
    request: ExtensionHistoryRestoreRequest,
) -> Result<ExtensionMutationResult, String> {
    let home = home_dir()?;
    let context = history_context(&request.query, &home)?;
    let record = history::restore(&context, &request.id)?;
    repair_extension_ownership(&request.query, &home);
    let inventory = inventory_with_home(request.query, &home)?;
    Ok(ExtensionMutationResult {
        message: format!(
            "扩展配置已恢复, 本次恢复记录包含 {} 项变更",
            record.changes.len()
        ),
        inventory,
    })
}

pub fn export_extension_bundle(
    request: ExtensionExportRequest,
) -> Result<ExtensionExportResult, String> {
    let home = home_dir()?;
    let bundle = bundle_from_query(&request.query, &home, request.include_secrets)?;
    let path = PathBuf::from(request.path.trim());
    if request.include_secrets {
        transfer::write_encrypted_bundle(
            &path,
            &bundle,
            request.password.as_deref().unwrap_or_default(),
        )?;
    } else {
        transfer::write_bundle(&path, &bundle)?;
    }
    restore_user_ownership(&path);
    Ok(ExtensionExportResult {
        path: path.display().to_string(),
        includes_secrets: bundle.includes_secrets,
        encrypted: request.include_secrets,
        mcp_count: bundle.mcp_servers.len(),
        skill_count: bundle.skills.len(),
        prompt_count: bundle.prompts.len(),
    })
}

pub fn preview_extension_import(
    request: ExtensionImportPreviewRequest,
) -> Result<TransferPreview, String> {
    let home = home_dir()?;
    let (bundle, encrypted) =
        transfer::read_bundle(Path::new(request.path.trim()), request.password.as_deref())?;
    preview_bundle(&bundle, &request.query, &home, encrypted)
}

pub fn import_extension_bundle(
    request: ExtensionImportRequest,
) -> Result<ExtensionMutationResult, String> {
    let home = home_dir()?;
    let (bundle, _) =
        transfer::read_bundle(Path::new(request.path.trim()), request.password.as_deref())?;
    let query = request.query.clone();
    let summary = format!(
        "导入 {} 的扩展配置包",
        if bundle.source_target == "cursor" {
            "Cursor"
        } else {
            "Claude Code"
        }
    );
    let result = mutate_with_history(&query, &home, "import", &summary, || {
        apply_bundle(&bundle, &query, &home, &request.conflict_policy)
    });
    repair_extension_ownership(&query, &home);
    result
}

pub fn preview_extension_copy(
    request: ExtensionCopyPreviewRequest,
) -> Result<TransferPreview, String> {
    let home = home_dir()?;
    let bundle = bundle_from_query(&request.source, &home, true)?;
    preview_bundle(&bundle, &request.destination, &home, false)
}

pub fn copy_extensions(request: ExtensionCopyRequest) -> Result<ExtensionMutationResult, String> {
    let home = home_dir()?;
    let bundle = bundle_from_query(&request.source, &home, true)?;
    let destination = request.destination.clone();
    let summary = format!(
        "从 {} 复制扩展到 {}",
        if bundle.source_target == "cursor" {
            "Cursor"
        } else {
            "Claude Code"
        },
        if destination.target == "cursor" {
            "Cursor"
        } else {
            "Claude Code"
        }
    );
    let result = mutate_with_history(&destination, &home, "copy", &summary, || {
        apply_bundle(&bundle, &destination, &home, &request.conflict_policy)
    });
    repair_extension_ownership(&destination, &home);
    result
}

pub fn batch_toggle_extensions(
    request: ExtensionBatchRequest,
) -> Result<ExtensionMutationResult, String> {
    let home = home_dir()?;
    let query = request.query.clone();
    let mut names = request.names.clone();
    names.sort();
    names.dedup();
    if names.is_empty() || names.len() > 100 {
        return Err("批量操作必须选择 1 到 100 个项目".to_string());
    }
    let summary = format!(
        "批量{} {} 个 {}",
        if request.enabled { "启用" } else { "停用" },
        names.len(),
        request.kind
    );
    let result = mutate_with_history(&query, &home, "batch-toggle", &summary, || {
        batch_toggle_with_home(&request, &names, &home)
    });
    repair_extension_ownership(&query, &home);
    result
}

fn batch_toggle_with_home(
    request: &ExtensionBatchRequest,
    names: &[String],
    home: &Path,
) -> Result<ExtensionMutationResult, String> {
    let paths = resolve_paths(&request.query, home)?;
    match request.kind.as_str() {
        "mcp" => {
            let mut active = load_document(&paths.mcp_config)?;
            let mut disabled = load_document(&paths.mcp_disabled)?;
            for name in names {
                validate_mcp_name(name)?;
                let value = if request.enabled {
                    remove_server(&mut disabled, name)
                } else {
                    remove_server(&mut active, name)
                };
                if let Some(value) = value {
                    server_map_mut(if request.enabled {
                        &mut active
                    } else {
                        &mut disabled
                    })?
                    .insert(name.clone(), value);
                }
            }
            commit_documents(&[
                (&paths.mcp_config, &active),
                (&paths.mcp_disabled, &disabled),
            ])?;
        }
        "skill" => {
            let (source_root, destination_root) = if request.enabled {
                (&paths.skill_disabled_root, &paths.skill_root)
            } else {
                (&paths.skill_root, &paths.skill_disabled_root)
            };
            for name in names {
                validate_skill_name(name, "Skill 名称")?;
                let source = source_root.join(name);
                let destination = destination_root.join(name);
                if source.exists() && destination.exists() {
                    return Err(format!("目标 Skill 已存在: {}", destination.display()));
                }
            }
            fs::create_dir_all(destination_root)
                .map_err(|error| format!("无法创建 Skill 目录: {error}"))?;
            for name in names {
                let source = source_root.join(name);
                if source.is_dir() {
                    fs::rename(&source, destination_root.join(name))
                        .map_err(|error| format!("无法批量修改 Skill {name}: {error}"))?;
                }
            }
        }
        "prompt" => {
            ensure_prompt_scope(&paths)?;
            let (source_root, destination_root) = if request.enabled {
                (&paths.prompt_disabled_root, &paths.prompt_root)
            } else {
                (&paths.prompt_root, &paths.prompt_disabled_root)
            };
            for name in names {
                validate_skill_name(name, "提示词名称")?;
                let source = prompt_file(source_root, name, paths.target);
                let destination = prompt_file(destination_root, name, paths.target);
                if source.exists() && destination.exists() {
                    return Err(format!("目标提示词已存在: {}", destination.display()));
                }
            }
            fs::create_dir_all(destination_root)
                .map_err(|error| format!("无法创建提示词目录: {error}"))?;
            for name in names {
                let source = prompt_file(source_root, name, paths.target);
                if source.is_file() {
                    fs::rename(&source, prompt_file(destination_root, name, paths.target))
                        .map_err(|error| format!("无法批量修改提示词 {name}: {error}"))?;
                }
            }
        }
        other => return Err(format!("不支持批量操作的扩展类型: {other}")),
    }
    let inventory = inventory_with_home(request.query.clone(), home)?;
    Ok(ExtensionMutationResult {
        message: format!(
            "已批量{} {} 个项目",
            if request.enabled { "启用" } else { "停用" },
            names.len()
        ),
        inventory,
    })
}

fn bundle_from_query(
    query: &ExtensionQuery,
    home: &Path,
    include_secrets: bool,
) -> Result<transfer::ExtensionBundle, String> {
    let paths = resolve_paths(query, home)?;
    let active = load_document(&paths.mcp_config)?;
    let disabled = load_document(&paths.mcp_disabled)?;
    let registry = load_registry(&paths);
    let mut mcp_servers = Vec::new();
    for (enabled, document) in [(true, &active), (false, &disabled)] {
        for (name, value) in server_map(document) {
            let mut value = value.clone();
            if !include_secrets {
                redact_mcp_value(&mut value);
            }
            let origin = registry.mcp.get(name);
            mcp_servers.push(transfer::BundleMcp {
                name: name.clone(),
                enabled,
                repository: origin
                    .map(|value| value.repository.clone())
                    .or_else(|| find_github_repository(&value)),
                revision: origin.map(|value| value.revision.clone()),
                value,
            });
        }
    }
    mcp_servers.sort_by(|left, right| left.name.cmp(&right.name));

    let mut skills = Vec::new();
    for (enabled, root) in [
        (true, &paths.skill_root),
        (false, &paths.skill_disabled_root),
    ] {
        if !root.exists() {
            continue;
        }
        for entry in fs::read_dir(root)
            .map_err(|error| format!("无法读取 Skill 目录 {}: {error}", root.display()))?
            .flatten()
        {
            let path = entry.path();
            if !path.is_dir() || !path.join("SKILL.md").is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            validate_skill_name(&name, "Skill 名称")?;
            skills.push(transfer::BundleSkill {
                name,
                enabled,
                files: transfer::collect_directory(&path)?,
            });
        }
    }
    skills.sort_by(|left, right| left.name.cmp(&right.name));

    let mut prompts = Vec::new();
    if targets::adapter(paths.target).prompt_editable(paths.scope) {
        for (enabled, root) in [
            (true, &paths.prompt_root),
            (false, &paths.prompt_disabled_root),
        ] {
            if !root.exists() {
                continue;
            }
            for entry in fs::read_dir(root)
                .map_err(|error| format!("无法读取提示词目录 {}: {error}", root.display()))?
                .flatten()
            {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let name = path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_string();
                if name.is_empty() {
                    continue;
                }
                prompts.push(transfer::BundlePrompt {
                    name,
                    enabled,
                    content: fs::read_to_string(&path)
                        .map_err(|error| format!("无法读取提示词 {}: {error}", path.display()))?,
                });
            }
        }
    }
    prompts.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(transfer::new_bundle(
        target_id(paths.target).to_string(),
        scope_id(paths.scope).to_string(),
        include_secrets,
        mcp_servers,
        skills,
        prompts,
    ))
}

fn preview_bundle(
    bundle: &transfer::ExtensionBundle,
    destination: &ExtensionQuery,
    home: &Path,
    encrypted: bool,
) -> Result<TransferPreview, String> {
    let paths = resolve_paths(destination, home)?;
    let active = load_document(&paths.mcp_config)?;
    let disabled = load_document(&paths.mcp_disabled)?;
    let mut conflicts = Vec::new();
    for server in &bundle.mcp_servers {
        if let Some(existing) = server_map(&active)
            .get(&server.name)
            .or_else(|| server_map(&disabled).get(&server.name))
        {
            let incoming = normalize_server_for_target(&server.value, paths.target);
            conflicts.push(transfer::TransferConflict {
                kind: "mcp".to_string(),
                name: server.name.clone(),
                summary: if existing == &incoming {
                    "同名 MCP 配置内容相同".to_string()
                } else {
                    "同名 MCP 配置不同, 需要明确选择覆盖或跳过".to_string()
                },
            });
        }
    }
    for skill in &bundle.skills {
        let existing = paths.skill_root.join(&skill.name);
        let existing_disabled = paths.skill_disabled_root.join(&skill.name);
        let existing = if existing.is_dir() {
            Some(existing)
        } else if existing_disabled.is_dir() {
            Some(existing_disabled)
        } else {
            None
        };
        if let Some(existing) = existing {
            let same = transfer::collect_directory(&existing)
                .map(|files| files == skill.files)
                .unwrap_or(false);
            conflicts.push(transfer::TransferConflict {
                kind: "skill".to_string(),
                name: skill.name.clone(),
                summary: if same {
                    "同名 Skill 完整目录内容相同".to_string()
                } else {
                    "同名 Skill 目录不同, 需要明确选择覆盖或跳过".to_string()
                },
            });
        }
    }
    if !bundle.prompts.is_empty() && !targets::adapter(paths.target).prompt_editable(paths.scope) {
        conflicts.push(transfer::TransferConflict {
            kind: "unsupported".to_string(),
            name: "Cursor User Rules".to_string(),
            summary: "Cursor 用户级提示词没有公开文件格式, 请改用项目级目标".to_string(),
        });
    } else {
        for prompt in &bundle.prompts {
            let active = prompt_file(&paths.prompt_root, &prompt.name, paths.target);
            let disabled = prompt_file(&paths.prompt_disabled_root, &prompt.name, paths.target);
            let existing = if active.is_file() {
                Some(active)
            } else if disabled.is_file() {
                Some(disabled)
            } else {
                None
            };
            if let Some(existing) = existing {
                let same = fs::read_to_string(&existing)
                    .map(|content| content == prompt.content)
                    .unwrap_or(false);
                conflicts.push(transfer::TransferConflict {
                    kind: "prompt".to_string(),
                    name: prompt.name.clone(),
                    summary: if same {
                        "同名提示词内容相同".to_string()
                    } else {
                        "同名提示词内容不同, 需要明确选择覆盖或跳过".to_string()
                    },
                });
            }
        }
    }
    Ok(TransferPreview {
        source_target: bundle.source_target.clone(),
        destination_target: target_id(paths.target).to_string(),
        mcp_count: bundle.mcp_servers.len(),
        skill_count: bundle.skills.len(),
        prompt_count: bundle.prompts.len(),
        conflicts,
        includes_secrets: bundle.includes_secrets,
        encrypted,
    })
}

fn apply_bundle(
    bundle: &transfer::ExtensionBundle,
    destination: &ExtensionQuery,
    home: &Path,
    conflict_policy: &str,
) -> Result<ExtensionMutationResult, String> {
    if !matches!(conflict_policy, "fail" | "skip" | "overwrite") {
        return Err(format!("不支持的冲突策略: {conflict_policy}"));
    }
    let preview = preview_bundle(bundle, destination, home, false)?;
    if preview
        .conflicts
        .iter()
        .any(|conflict| conflict.kind == "unsupported")
    {
        return Err(preview
            .conflicts
            .iter()
            .find(|conflict| conflict.kind == "unsupported")
            .map(|conflict| conflict.summary.clone())
            .unwrap_or_else(|| "目标不支持配置包中的内容".to_string()));
    }
    if conflict_policy == "fail" && !preview.conflicts.is_empty() {
        return Err(format!(
            "发现 {} 个同名冲突, 请明确选择覆盖或跳过",
            preview.conflicts.len()
        ));
    }
    if !bundle.includes_secrets
        && bundle
            .mcp_servers
            .iter()
            .any(|server| contains_redacted_value(&server.value))
    {
        return Err(
            "该配置包已脱敏, 不能直接导入包含密钥的 MCP. 请导出“包含密钥”的私密配置包".to_string(),
        );
    }

    let paths = resolve_paths(destination, home)?;
    let conflict_names = preview
        .conflicts
        .iter()
        .map(|conflict| (conflict.kind.as_str(), conflict.name.as_str()))
        .collect::<BTreeSet<_>>();
    let mut active = load_document(&paths.mcp_config)?;
    let mut disabled = load_document(&paths.mcp_disabled)?;
    let mut registry = load_registry(&paths);
    for server in &bundle.mcp_servers {
        if conflict_policy == "skip" && conflict_names.contains(&("mcp", server.name.as_str())) {
            continue;
        }
        remove_server(&mut active, &server.name);
        remove_server(&mut disabled, &server.name);
        let value = normalize_server_for_target(&server.value, paths.target);
        server_map_mut(if server.enabled {
            &mut active
        } else {
            &mut disabled
        })?
        .insert(server.name.clone(), value);
        if let (Some(repository), Some(revision)) = (&server.repository, &server.revision) {
            registry.mcp.insert(
                server.name.clone(),
                RegistryOrigin {
                    repository: repository.clone(),
                    revision: revision.clone(),
                    content_sha256: Some(hash_json(&normalize_server_for_target(
                        &server.value,
                        paths.target,
                    ))),
                },
            );
        }
    }
    commit_documents(&[
        (&paths.mcp_config, &active),
        (&paths.mcp_disabled, &disabled),
    ])?;
    save_registry(&paths, &registry)?;

    for skill in &bundle.skills {
        if conflict_policy == "skip" && conflict_names.contains(&("skill", skill.name.as_str())) {
            continue;
        }
        let active = paths.skill_root.join(&skill.name);
        let disabled = paths.skill_disabled_root.join(&skill.name);
        if active.exists() {
            fs::remove_dir_all(&active)
                .map_err(|error| format!("无法覆盖 Skill {}: {error}", skill.name))?;
        }
        if disabled.exists() {
            fs::remove_dir_all(&disabled)
                .map_err(|error| format!("无法覆盖 Skill {}: {error}", skill.name))?;
        }
        transfer::restore_directory(
            &skill.files,
            if skill.enabled { &active } else { &disabled },
        )?;
        let destination = if skill.enabled { &active } else { &disabled };
        let raw = fs::read_to_string(destination.join("SKILL.md"))
            .map_err(|error| format!("无法读取导入后的 Skill {}: {error}", skill.name))?;
        let frontmatter = parse_frontmatter(&raw);
        if let (Some(repository), Some(revision)) = (
            frontmatter
                .get("repository")
                .and_then(|value| normalize_repository_url(value)),
            frontmatter.get("revision").cloned(),
        ) {
            let audit =
                security::audit_skill(destination, &raw, Some(&repository), Some(&revision));
            registry.skills.insert(
                skill.name.clone(),
                RegistryOrigin {
                    repository,
                    revision,
                    content_sha256: Some(audit.sha256),
                },
            );
        }
    }

    for prompt in &bundle.prompts {
        if conflict_policy == "skip" && conflict_names.contains(&("prompt", prompt.name.as_str())) {
            continue;
        }
        let active = prompt_file(&paths.prompt_root, &prompt.name, paths.target);
        let disabled = prompt_file(&paths.prompt_disabled_root, &prompt.name, paths.target);
        if active.exists() {
            fs::remove_file(&active)
                .map_err(|error| format!("无法覆盖提示词 {}: {error}", prompt.name))?;
        }
        if disabled.exists() {
            fs::remove_file(&disabled)
                .map_err(|error| format!("无法覆盖提示词 {}: {error}", prompt.name))?;
        }
        atomic_write(
            if prompt.enabled { &active } else { &disabled },
            prompt.content.as_bytes(),
        )?;
        let frontmatter = parse_frontmatter(&prompt.content);
        if let (Some(repository), Some(revision)) = (
            frontmatter
                .get("repository")
                .and_then(|value| normalize_repository_url(value)),
            frontmatter.get("revision").cloned(),
        ) {
            registry.prompts.insert(
                prompt.name.clone(),
                RegistryOrigin {
                    repository,
                    revision,
                    content_sha256: Some(sha256_hex(prompt.content.as_bytes())),
                },
            );
        }
    }
    save_registry(&paths, &registry)?;
    let inventory = inventory_with_home(destination.clone(), home)?;
    Ok(ExtensionMutationResult {
        message: format!(
            "扩展迁移完成: MCP {}, Skill {}, 提示词 {}",
            bundle.mcp_servers.len(),
            bundle.skills.len(),
            bundle.prompts.len()
        ),
        inventory,
    })
}

fn normalize_server_for_target(value: &Value, target: Target) -> Value {
    let mut value = value.clone();
    let transport = summary_from_value("transfer", &value, true, Scope::User).transport;
    targets::adapter(target).normalize_mcp(&mut value, &transport);
    value
}

fn redact_mcp_value(value: &mut Value) {
    if let Some(object) = value.as_object_mut() {
        if let Some(url) = object.get_mut("url") {
            if let Some(raw) = url.as_str() {
                *url = Value::String(redact_url(raw));
            }
        }
        for field in ["env", "headers"] {
            if let Some(values) = object.get_mut(field).and_then(Value::as_object_mut) {
                for value in values.values_mut() {
                    *value = Value::String(REDACTED_VALUE.to_string());
                }
            }
        }
    }
}

fn contains_redacted_value(value: &Value) -> bool {
    match value {
        Value::String(value) => value.contains(REDACTED_VALUE),
        Value::Array(values) => values.iter().any(contains_redacted_value),
        Value::Object(values) => values.values().any(contains_redacted_value),
        _ => false,
    }
}

pub fn save_mcp(request: McpSaveRequest) -> Result<ExtensionMutationResult, String> {
    let home = home_dir()?;
    let query = request.query.clone();
    let original_name = request.original_name.clone();
    let name = request.name.clone();
    let summary = format!("保存 MCP {name}");
    let result = mutate_with_history(&query, &home, "save-mcp", &summary, || {
        let result = save_mcp_with_home(request, &home);
        if result.is_ok() {
            if let Some(original_name) = original_name.filter(|original| original != &name) {
                migrate_mcp_origin(&query, &home, &original_name, &name);
            }
        }
        result
    });
    repair_extension_ownership(&query, &home);
    result
}

pub fn install_market_mcp(
    request: McpSaveRequest,
    repository: &str,
    revision: &str,
) -> Result<ExtensionInventory, String> {
    let home = home_dir()?;
    let query = request.query.clone();
    let name = request.name.clone();
    let summary = format!("安装或更新市场 MCP {name}");
    let result = mutate_with_history(&query, &home, "install-mcp", &summary, || {
        save_mcp_with_home(request, &home)?;
        tag_mcp_origin_with_home(&query, &home, &name, repository, revision)?;
        inventory_with_home(query.clone(), &home)
    });
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
    let summary = format!(
        "{} MCP {}",
        if request.enabled { "启用" } else { "停用" },
        request.name
    );
    let result = mutate_with_history(&query, &home, "toggle-mcp", &summary, || {
        toggle_mcp_with_home(request, &home)
    });
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
    let summary = format!("删除 MCP {name}");
    let result = mutate_with_history(&query, &home, "delete-mcp", &summary, || {
        let result = delete_mcp_with_home(request, &home);
        if result.is_ok() {
            remove_mcp_origin(&query, &home, &name);
        }
        result
    });
    repair_extension_ownership(&query, &home);
    result
}

fn tag_mcp_origin_with_home(
    query: &ExtensionQuery,
    home: &Path,
    name: &str,
    repository: &str,
    revision: &str,
) -> Result<(), String> {
    let paths = resolve_paths(&query, &home)?;
    validate_mcp_name(name)?;
    let repository = normalize_repository_url(repository)
        .ok_or_else(|| "市场项目 GitHub 仓库地址无效".to_string())?;
    let active = load_document(&paths.mcp_config)?;
    let disabled = load_document(&paths.mcp_disabled)?;
    let value = server_map(&active)
        .get(name)
        .or_else(|| server_map(&disabled).get(name))
        .ok_or_else(|| format!("未找到要标记来源的 MCP 服务: {name}"))?;
    let mut registry = load_registry(&paths);
    registry.mcp.insert(
        name.to_string(),
        RegistryOrigin {
            repository,
            revision: revision.to_string(),
            content_sha256: Some(hash_json(value)),
        },
    );
    save_registry(&paths, &registry)?;
    Ok(())
}

fn tag_skill_origin_with_home(
    query: &ExtensionQuery,
    home: &Path,
    name: &str,
    repository: &str,
    revision: &str,
) -> Result<(), String> {
    let paths = resolve_paths(&query, &home)?;
    validate_skill_name(name, "Skill 名称")?;
    let repository = normalize_repository_url(repository)
        .ok_or_else(|| "市场项目 GitHub 仓库地址无效".to_string())?;
    let path = if paths.skill_root.join(name).is_dir() {
        paths.skill_root.join(name)
    } else if paths.skill_disabled_root.join(name).is_dir() {
        paths.skill_disabled_root.join(name)
    } else {
        return Err(format!("未找到要标记来源的 Skill: {name}"));
    };
    let raw = fs::read_to_string(path.join("SKILL.md"))
        .map_err(|error| format!("无法读取 Skill 来源文件: {error}"))?;
    let audit = security::audit_skill(&path, &raw, Some(&repository), Some(revision));
    let mut registry = load_registry(&paths);
    registry.skills.insert(
        name.to_string(),
        RegistryOrigin {
            repository,
            revision: revision.to_string(),
            content_sha256: Some(audit.sha256),
        },
    );
    save_registry(&paths, &registry)?;
    Ok(())
}

fn tag_prompt_origin_with_home(
    query: &ExtensionQuery,
    home: &Path,
    name: &str,
    repository: &str,
    revision: &str,
) -> Result<(), String> {
    let paths = resolve_paths(&query, &home)?;
    ensure_prompt_scope(&paths)?;
    validate_skill_name(name, "提示词名称")?;
    let repository = normalize_repository_url(repository)
        .ok_or_else(|| "市场项目 GitHub 仓库地址无效".to_string())?;
    let path = [
        prompt_file(&paths.prompt_root, name, paths.target),
        prompt_file(&paths.prompt_disabled_root, name, paths.target),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .ok_or_else(|| format!("未找到要标记来源的提示词: {name}"))?;
    let content = fs::read(&path)
        .map_err(|error| format!("无法读取提示词来源文件 {}: {error}", path.display()))?;
    let mut registry = load_registry(&paths);
    registry.prompts.insert(
        name.to_string(),
        RegistryOrigin {
            repository,
            revision: revision.to_string(),
            content_sha256: Some(sha256_hex(&content)),
        },
    );
    save_registry(&paths, &registry)?;
    Ok(())
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
    let original_name = request.original_name.clone();
    let name = request.name.clone();
    let summary = format!("保存 Skill {}", request.name);
    let result = mutate_with_history(&query, &home, "save-skill", &summary, || {
        let result = save_skill_with_home(request, &home);
        if result.is_ok() {
            if let Some(original) = original_name.filter(|original| original != &name) {
                migrate_named_origin(&query, &home, "skill", &original, &name);
            }
        }
        result
    });
    repair_extension_ownership(&query, &home);
    result
}

pub fn install_market_skill_bundle(
    query: ExtensionQuery,
    name: &str,
    files: Vec<SkillBundleFile>,
    repository: &str,
    revision: &str,
) -> Result<ExtensionInventory, String> {
    let home = home_dir()?;
    let summary = format!("安装或更新市场 Skill {name}");
    let operation_query = query.clone();
    let result = mutate_with_history(&query, &home, "install-skill", &summary, || {
        install_skill_bundle_with_home(operation_query, name, files, &home)?;
        tag_skill_origin_with_home(&query, &home, name, repository, revision)?;
        inventory_with_home(query.clone(), &home)
    });
    repair_extension_ownership(&query, &home);
    result
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
    let summary = format!(
        "{} Skill {}",
        if request.enabled { "启用" } else { "停用" },
        request.name
    );
    let result = mutate_with_history(&query, &home, "toggle-skill", &summary, || {
        toggle_skill_with_home(request, &home)
    });
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
    let name = request.name.clone();
    let summary = format!("删除 Skill {}", request.name);
    let result = mutate_with_history(&query, &home, "delete-skill", &summary, || {
        let result = delete_skill_with_home(request, &home);
        if result.is_ok() {
            remove_named_origin(&query, &home, "skill", &name);
        }
        result
    });
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
    let original_name = request.original_name.clone();
    let name = request.name.clone();
    let summary = format!("保存提示词 {}", request.name);
    let result = mutate_with_history(&query, &home, "save-prompt", &summary, || {
        let result = save_prompt_with_home(request, &home);
        if result.is_ok() {
            if let Some(original) = original_name.filter(|original| original != &name) {
                migrate_named_origin(&query, &home, "prompt", &original, &name);
            }
        }
        result
    });
    repair_extension_ownership(&query, &home);
    result
}

pub fn install_market_prompt_with_origin(
    query: ExtensionQuery,
    name: &str,
    content: String,
    repository: &str,
    revision: &str,
) -> Result<ExtensionInventory, String> {
    let home = home_dir()?;
    let summary = format!("安装或更新市场提示词 {name}");
    let result = mutate_with_history(&query, &home, "install-prompt", &summary, || {
        install_market_prompt_with_home(query.clone(), name, content, &home)?;
        tag_prompt_origin_with_home(&query, &home, name, repository, revision)?;
        inventory_with_home(query.clone(), &home)
    });
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
    let summary = format!(
        "{}提示词 {}",
        if request.enabled { "启用" } else { "停用" },
        request.name
    );
    let result = mutate_with_history(&query, &home, "toggle-prompt", &summary, || {
        toggle_prompt_with_home(request, &home)
    });
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
    let name = request.name.clone();
    let summary = format!("删除提示词 {}", request.name);
    let result = mutate_with_history(&query, &home, "delete-prompt", &summary, || {
        let result = delete_prompt_with_home(request, &home);
        if result.is_ok() {
            remove_named_origin(&query, &home, "prompt", &name);
        }
        result
    });
    repair_extension_ownership(&query, &home);
    result
}

fn delete_prompt_with_home(
    request: PromptLookupRequest,
    home: &Path,
) -> Result<ExtensionMutationResult, String> {
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
    restore_user_ownership(&local_app_data().join("extension-history"));
}

fn history_context(query: &ExtensionQuery, home: &Path) -> Result<history::HistoryContext, String> {
    let paths = resolve_paths(query, home)?;
    let target_label = targets::adapter(paths.target).label();
    Ok(history::HistoryContext {
        base_root: local_app_data().join("extension-history"),
        target: target_id(paths.target).to_string(),
        target_label: target_label.to_string(),
        scope: scope_id(paths.scope).to_string(),
        workspace: paths
            .workspace
            .as_ref()
            .map(|path| path.display().to_string()),
        managed: vec![
            history::ManagedPath {
                key: "mcp.json".to_string(),
                path: paths.mcp_config.clone(),
            },
            history::ManagedPath {
                key: "mcp.disabled.json".to_string(),
                path: paths.mcp_disabled.clone(),
            },
            history::ManagedPath {
                key: "skills".to_string(),
                path: paths.skill_root.clone(),
            },
            history::ManagedPath {
                key: "skills-disabled".to_string(),
                path: paths.skill_disabled_root.clone(),
            },
            history::ManagedPath {
                key: "prompts".to_string(),
                path: paths.prompt_root.clone(),
            },
            history::ManagedPath {
                key: "prompts-disabled".to_string(),
                path: paths.prompt_disabled_root.clone(),
            },
            history::ManagedPath {
                key: "registry.json".to_string(),
                path: registry_path(&paths),
            },
        ],
    })
}

fn mutate_with_history<T>(
    query: &ExtensionQuery,
    home: &Path,
    action: &str,
    summary: &str,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let context = history_context(query, home)?;
    let mut transaction = history::begin(&context, action, summary)?;
    let result = operation();
    let value = match result {
        Ok(value) => value,
        Err(error) => {
            let rollback = history::rollback(&context, &transaction);
            history::discard(transaction);
            return Err(match rollback {
                Ok(()) => error,
                Err(rollback_error) => {
                    format!("{error}; 同时回滚修改失败: {rollback_error}")
                }
            });
        }
    };
    if let Err(error) = history::finish(&context, &mut transaction) {
        let rollback = history::rollback(&context, &transaction);
        history::discard(transaction);
        return Err(match rollback {
            Ok(()) => format!("保存扩展历史失败, 修改已回滚: {error}"),
            Err(rollback_error) => {
                format!("保存扩展历史失败, 且修改回滚失败: {error}; {rollback_error}")
            }
        });
    }
    Ok(value)
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
    if !targets::adapter(paths.target).prompt_editable(paths.scope) {
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
            if let Some(expected) = origin.content_sha256.as_deref() {
                if let Some(value) = server_map(&active)
                    .get(&server.name)
                    .or_else(|| server_map(&disabled).get(&server.name))
                {
                    server.local_modified = hash_json(value) != expected;
                }
            }
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
    for skill in &mut skills {
        if let Some(origin) = registry.skills.get(&skill.id) {
            skill.repository = Some(origin.repository.clone());
            skill.revision = Some(origin.revision.clone());
            skill.local_modified = origin
                .content_sha256
                .as_deref()
                .is_some_and(|expected| expected != skill.audit.sha256);
        }
    }
    skills.sort_by(|left, right| {
        left.built_in
            .cmp(&right.built_in)
            .then_with(|| right.enabled.cmp(&left.enabled))
            .then_with(|| left.name.cmp(&right.name))
    });
    let adapter = targets::adapter(paths.target);
    let prompt_editable = adapter.prompt_editable(paths.scope);
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
    for prompt in &mut prompts {
        if let Some(origin) = registry.prompts.get(&prompt.id) {
            prompt.repository = Some(origin.repository.clone());
            prompt.revision = Some(origin.revision.clone());
            prompt.local_modified = origin
                .content_sha256
                .as_deref()
                .is_some_and(|expected| expected != prompt.sha256);
        }
    }
    prompts.sort_by(|left, right| {
        right
            .enabled
            .cmp(&left.enabled)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(ExtensionInventory {
        target: target_id(paths.target).to_string(),
        target_label: adapter.label().to_string(),
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
        prompt_note: adapter.prompt_note(paths.scope),
        mcp_servers,
        skills,
        prompts,
        note: if paths.scope == Scope::Project {
            "项目级配置仅作用于当前选择的工作区".to_string()
        } else {
            "用户级配置会作用于当前系统账号".to_string()
        },
        capabilities: adapter.capabilities(paths.scope),
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
    Ok(targets::resolve_paths(target, scope, workspace, home))
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
    targets::adapter(target).id()
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

fn migrate_named_origin(
    query: &ExtensionQuery,
    home: &Path,
    kind: &str,
    original: &str,
    name: &str,
) {
    let Ok(paths) = resolve_paths(query, home) else {
        return;
    };
    let mut registry = load_registry(&paths);
    let origins = if kind == "skill" {
        &mut registry.skills
    } else {
        &mut registry.prompts
    };
    if let Some(origin) = origins.remove(original) {
        origins.insert(name.to_string(), origin);
        let _ = save_registry(&paths, &registry);
    }
}

fn remove_named_origin(query: &ExtensionQuery, home: &Path, kind: &str, name: &str) {
    let Ok(paths) = resolve_paths(query, home) else {
        return;
    };
    let mut registry = load_registry(&paths);
    let removed = if kind == "skill" {
        registry.skills.remove(name).is_some()
    } else {
        registry.prompts.remove(name).is_some()
    };
    if removed {
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
    let mut value = Value::Object(object);
    targets::adapter(parse_target(&request.query.target)?)
        .normalize_mcp(&mut value, &request.transport);
    Ok(value)
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
        local_modified: false,
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
        let audit = security::audit_skill(&path, &raw, repository.as_deref(), revision.as_deref());
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
            audit,
            local_modified: false,
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
            sha256: sha256_hex(raw.as_bytes()),
            local_modified: false,
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

fn now_stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn hash_json(value: &Value) -> String {
    serde_json::to_vec(value)
        .map(|data| sha256_hex(&data))
        .unwrap_or_default()
}

fn sha256_hex(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SANDBOX_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn sandbox() -> PathBuf {
        std::env::temp_dir().join(format!(
            "i18n-workbench-extension-test-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            SANDBOX_SEQUENCE.fetch_add(1, Ordering::Relaxed)
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
    fn previews_and_copies_complete_extensions_between_targets() {
        let root = sandbox();
        let home = root.join("home");
        let workspace = root.join("workspace");
        fs::create_dir_all(workspace.join(".cursor/skills/demo/scripts")).unwrap();
        fs::create_dir_all(workspace.join(".cursor/rules")).unwrap();
        fs::write(
            workspace.join(".cursor/mcp.json"),
            r#"{"mcpServers":{"demo":{"command":"node","args":["server.js"],"env":{"TOKEN":"secret"}}}}"#,
        )
        .unwrap();
        fs::write(
            workspace.join(".cursor/skills/demo/SKILL.md"),
            "---\nname: demo\ndescription: Demo\n---\n",
        )
        .unwrap();
        fs::write(
            workspace.join(".cursor/skills/demo/scripts/run.js"),
            "console.log('ok')",
        )
        .unwrap();
        fs::write(
            workspace.join(".cursor/rules/review.mdc"),
            "---\nname: review\ndescription: Review\n---\nReview",
        )
        .unwrap();
        let source = query("cursor", "project", Some(&workspace));
        let destination = query("claude-code", "project", Some(&workspace));
        let bundle = bundle_from_query(&source, &home, true).unwrap();
        let preview = preview_bundle(&bundle, &destination, &home, false).unwrap();
        assert!(preview.conflicts.is_empty());
        apply_bundle(&bundle, &destination, &home, "overwrite").unwrap();

        let mcp: Value =
            serde_json::from_str(&fs::read_to_string(workspace.join(".mcp.json")).unwrap())
                .unwrap();
        assert_eq!(mcp["mcpServers"]["demo"]["type"], "stdio");
        assert_eq!(mcp["mcpServers"]["demo"]["env"]["TOKEN"], "secret");
        assert!(workspace
            .join(".claude/skills/demo/scripts/run.js")
            .is_file());
        assert!(workspace.join(".claude/rules/review.md").is_file());

        let conflict = preview_bundle(&bundle, &destination, &home, false).unwrap();
        assert_eq!(conflict.conflicts.len(), 3);
        let sanitized = bundle_from_query(&source, &home, false).unwrap();
        assert!(apply_bundle(&sanitized, &destination, &home, "overwrite").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn batch_toggles_selected_mcp_servers() {
        let root = sandbox();
        let home = root.join("home");
        let workspace = root.join("workspace");
        fs::create_dir_all(workspace.join(".cursor")).unwrap();
        fs::write(
            workspace.join(".cursor/mcp.json"),
            r#"{"mcpServers":{"one":{"command":"node"},"two":{"command":"node"}}}"#,
        )
        .unwrap();
        let query = query("cursor", "project", Some(&workspace));
        let result = batch_toggle_with_home(
            &ExtensionBatchRequest {
                query: query.clone(),
                kind: "mcp".to_string(),
                names: vec!["one".to_string()],
                enabled: false,
            },
            &["one".to_string()],
            &home,
        )
        .unwrap();
        assert_eq!(result.inventory.active_mcp_count, 1);
        assert!(result
            .inventory
            .mcp_servers
            .iter()
            .any(|server| server.name == "one" && !server.enabled));
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
