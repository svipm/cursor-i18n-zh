use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BUNDLE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_BUNDLE_FILES: usize = 1024;
const MAX_BUNDLE_FILE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExtensionBundle {
    pub schema_version: u32,
    pub exported_at_unix: u64,
    pub source_target: String,
    pub source_scope: String,
    pub includes_secrets: bool,
    pub mcp_servers: Vec<BundleMcp>,
    pub skills: Vec<BundleSkill>,
    pub prompts: Vec<BundlePrompt>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BundleMcp {
    pub name: String,
    pub enabled: bool,
    pub value: Value,
    pub repository: Option<String>,
    pub revision: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BundleSkill {
    pub name: String,
    pub enabled: bool,
    pub files: Vec<BundleFile>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BundlePrompt {
    pub name: String,
    pub enabled: bool,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct BundleFile {
    pub path: String,
    pub data_base64: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferConflict {
    pub kind: String,
    pub name: String,
    pub summary: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferPreview {
    pub source_target: String,
    pub destination_target: String,
    pub mcp_count: usize,
    pub skill_count: usize,
    pub prompt_count: usize,
    pub conflicts: Vec<TransferConflict>,
    pub includes_secrets: bool,
}

pub(super) fn new_bundle(
    source_target: String,
    source_scope: String,
    includes_secrets: bool,
    mcp_servers: Vec<BundleMcp>,
    skills: Vec<BundleSkill>,
    prompts: Vec<BundlePrompt>,
) -> ExtensionBundle {
    ExtensionBundle {
        schema_version: 1,
        exported_at_unix: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        source_target,
        source_scope,
        includes_secrets,
        mcp_servers,
        skills,
        prompts,
    }
}

pub(super) fn write_bundle(path: &Path, bundle: &ExtensionBundle) -> Result<(), String> {
    if path.extension().and_then(|value| value.to_str()) != Some("json") {
        return Err("配置包文件必须使用 .json 扩展名".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("无法创建配置包目录 {}: {error}", parent.display()))?;
    }
    let data = serde_json::to_vec_pretty(bundle)
        .map_err(|error| format!("无法生成扩展配置包: {error}"))?;
    if data.len() as u64 > MAX_BUNDLE_BYTES {
        return Err("扩展配置包超过 64 MB, 已拒绝导出".to_string());
    }
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, data)
        .map_err(|error| format!("无法写入扩展配置包 {}: {error}", temp.display()))?;
    set_private_permissions(&temp)?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("无法覆盖扩展配置包 {}: {error}", path.display()))?;
    }
    fs::rename(&temp, path)
        .map_err(|error| format!("无法提交扩展配置包 {}: {error}", path.display()))?;
    set_private_permissions(path)
}

pub(super) fn read_bundle(path: &Path) -> Result<ExtensionBundle, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("无法读取扩展配置包 {}: {error}", path.display()))?;
    if metadata.len() > MAX_BUNDLE_BYTES {
        return Err("扩展配置包超过 64 MB, 已拒绝导入".to_string());
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("无法读取扩展配置包 {}: {error}", path.display()))?;
    let bundle = serde_json::from_str::<ExtensionBundle>(&raw)
        .map_err(|error| format!("扩展配置包 JSON 无效: {error}"))?;
    validate_bundle(&bundle)?;
    Ok(bundle)
}

pub(super) fn collect_directory(root: &Path) -> Result<Vec<BundleFile>, String> {
    let mut files = Vec::new();
    if root.exists() {
        collect_directory_inner(root, root, &mut files)?;
    }
    Ok(files)
}

pub(super) fn restore_directory(files: &[BundleFile], destination: &Path) -> Result<(), String> {
    if files.len() > MAX_BUNDLE_FILES {
        return Err("配置包目录文件数量超过 1024".to_string());
    }
    let staging = destination.with_file_name(format!(
        ".{}.import-{}",
        destination
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("extension"),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    fs::create_dir_all(&staging)
        .map_err(|error| format!("无法创建导入暂存目录 {}: {error}", staging.display()))?;
    let staged = (|| {
        for file in files {
            let relative = validate_relative_path(&file.path)?;
            let data = STANDARD
                .decode(&file.data_base64)
                .map_err(|_| format!("配置包文件不是有效 Base64: {}", file.path))?;
            if data.len() as u64 > MAX_BUNDLE_FILE_BYTES {
                return Err(format!("配置包单文件超过 8 MB: {}", file.path));
            }
            let target = staging.join(relative);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("无法创建导入目录 {}: {error}", parent.display()))?;
            }
            fs::write(&target, data)
                .map_err(|error| format!("无法写入导入文件 {}: {error}", target.display()))?;
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = staged {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if destination.exists() {
        fs::remove_dir_all(destination)
            .map_err(|error| format!("无法替换扩展目录 {}: {error}", destination.display()))?;
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("无法创建扩展目录 {}: {error}", parent.display()))?;
    }
    fs::rename(&staging, destination)
        .map_err(|error| format!("无法提交导入目录 {}: {error}", destination.display()))
}

fn collect_directory_inner(
    root: &Path,
    current: &Path,
    files: &mut Vec<BundleFile>,
) -> Result<(), String> {
    for entry in fs::read_dir(current)
        .map_err(|error| format!("无法读取扩展目录 {}: {error}", current.display()))?
    {
        let entry = entry.map_err(|error| format!("无法读取扩展目录项: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("无法读取扩展文件信息 {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("配置包拒绝符号链接: {}", path.display()));
        }
        if metadata.is_dir() {
            collect_directory_inner(root, &path, files)?;
        } else if metadata.is_file() {
            if files.len() >= MAX_BUNDLE_FILES {
                return Err("配置包目录文件数量超过 1024".to_string());
            }
            if metadata.len() > MAX_BUNDLE_FILE_BYTES {
                return Err(format!("配置包单文件超过 8 MB: {}", path.display()));
            }
            let data = fs::read(&path)
                .map_err(|error| format!("无法读取扩展文件 {}: {error}", path.display()))?;
            files.push(BundleFile {
                path: path
                    .strip_prefix(root)
                    .map_err(|error| format!("扩展文件越出目录: {error}"))?
                    .to_string_lossy()
                    .replace('\\', "/"),
                data_base64: STANDARD.encode(data),
            });
        }
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(())
}

fn validate_bundle(bundle: &ExtensionBundle) -> Result<(), String> {
    if bundle.schema_version != 1 {
        return Err(format!("不支持的扩展配置包版本: {}", bundle.schema_version));
    }
    let total_files = bundle
        .skills
        .iter()
        .map(|skill| skill.files.len())
        .sum::<usize>();
    if total_files > MAX_BUNDLE_FILES {
        return Err("配置包文件数量超过 1024".to_string());
    }
    for skill in &bundle.skills {
        if skill.name.is_empty() || !skill.files.iter().any(|file| file.path == "SKILL.md") {
            return Err(format!("配置包 Skill 无效: {}", skill.name));
        }
        for file in &skill.files {
            validate_relative_path(&file.path)?;
        }
    }
    Ok(())
}

fn validate_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if value.is_empty()
        || value.len() > 260
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        Err(format!("配置包文件路径不安全: {value}"))
    } else {
        Ok(path.to_path_buf())
    }
}

#[cfg(unix)]
fn set_private_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("无法限制配置包文件权限 {}: {error}", path.display()))
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sandbox() -> PathBuf {
        std::env::temp_dir().join(format!(
            "i18n-workbench-transfer-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    #[test]
    fn round_trips_a_complete_skill_directory() {
        let root = sandbox();
        let source = root.join("source");
        fs::create_dir_all(source.join("scripts")).unwrap();
        fs::write(source.join("SKILL.md"), "# Demo").unwrap();
        fs::write(source.join("scripts/run.js"), "console.log('ok')").unwrap();
        let files = collect_directory(&source).unwrap();
        let destination = root.join("destination");
        restore_directory(&files, &destination).unwrap();
        assert_eq!(
            fs::read_to_string(destination.join("scripts/run.js")).unwrap(),
            "console.log('ok')"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn writes_and_reads_a_private_bundle() {
        let root = sandbox();
        let path = root.join("bundle.json");
        let bundle = new_bundle(
            "cursor".to_string(),
            "user".to_string(),
            false,
            Vec::new(),
            Vec::new(),
            Vec::new(),
        );
        write_bundle(&path, &bundle).unwrap();
        assert_eq!(read_bundle(&path).unwrap().schema_version, 1);
        let _ = fs::remove_dir_all(root);
    }
}
