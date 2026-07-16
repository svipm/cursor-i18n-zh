use super::{
    hidden_command, is_elevated, local_app_data, ActionRequest, AppStatus, BackupRecord,
    LocaleOption, OperationResult, ProgressSink,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Output;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const ADAPTER_VERSION: &str = "0.1.0";
const MEMORY_VERSION: &str = "20260711180535";
const TRANSLATION_MEMORY: &str = include_str!("../../../resources/claude/translation_memory.json");
const RESOURCE_FILES: [&str; 3] = [
    "en-US.json",
    "ion-dist/i18n/en-US.json",
    "ion-dist/i18n/dynamic/en-US.json",
];

#[derive(Clone, Debug)]
struct ClaudeInstall {
    install_location: PathBuf,
    resources: PathBuf,
    version: String,
    package_name: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeState {
    schema: u8,
    version: String,
    package_name: String,
    current_state: String,
    backup_path: String,
    last_action: String,
    updated_at_unix: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    schema: u8,
    app_id: String,
    version: String,
    package_name: String,
    created_at_unix: u64,
    translation_memory_version: String,
    translation_memory_sha256: String,
    files: Vec<BackupFile>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupFile {
    relative_path: String,
    bytes: u64,
    sha256: String,
}

#[derive(Default)]
struct TranslationStats {
    total_strings: usize,
    replaced: usize,
    unmatched: usize,
}

struct PreparedFile {
    relative_path: &'static str,
    data: Vec<u8>,
    stats: TranslationStats,
}

pub fn detect() -> AppStatus {
    match resolve_install() {
        Ok(install) => {
            let root = data_root();
            let backup = backup_dir(&root, &install);
            let backup_files = backup_manifest_file_count(&backup);
            let (backup_available, backup_message) = if !backup.is_dir() {
                (
                    false,
                    "未创建当前 Claude Desktop 版本的原始备份".to_string(),
                )
            } else {
                match validate_backup(&backup, &install) {
                    Ok(()) => (
                        true,
                        "3 个资源文件的版本, 文件大小和 SHA256 校验通过".to_string(),
                    ),
                    Err(error) => (false, format!("备份校验失败: {error}")),
                }
            };
            let state = read_state(&root, &install).unwrap_or_default();
            let localized = state.current_state == "patched";
            AppStatus {
                id: "claude",
                name: "Claude Desktop",
                description: "轻量 JSON 资源汉化",
                installed: true,
                ready: true,
                path: Some(install.resources.to_string_lossy().into_owned()),
                version: Some(install.version.clone()),
                state: if localized {
                    "已汉化".to_string()
                } else {
                    "适配器可用".to_string()
                },
                state_tone: "success",
                adapter_version: ADAPTER_VERSION,
                backup_available,
                backup_path: Some(backup.to_string_lossy().into_owned()),
                backup_files,
                backup_message,
                localized,
                auto_compatible: true,
                compatibility_message: format!(
                    "已按资源结构自动适配 Claude Desktop {}, 3 个 JSON 已通过结构校验",
                    install.version
                ),
                reason: None,
                locales: vec![LocaleOption {
                    id: "zh-cn",
                    label: "简体中文",
                    tag: "zh-CN",
                }],
            }
        }
        Err(error) => {
            let installed = error.starts_with("已找到最新 Claude Desktop");
            AppStatus {
                id: "claude",
                name: "Claude Desktop",
                description: "轻量 JSON 资源汉化",
                installed,
                ready: false,
                path: None,
                version: None,
                state: if installed {
                    "结构待适配".to_string()
                } else {
                    "未安装".to_string()
                },
                state_tone: "warning",
                adapter_version: ADAPTER_VERSION,
                backup_available: false,
                backup_path: None,
                backup_files: 0,
                backup_message: if installed {
                    "当前 Claude Desktop 资源结构未通过兼容性校验, 禁止创建错误备份".to_string()
                } else {
                    "安装 Claude Desktop 后才能创建版本备份".to_string()
                },
                localized: false,
                auto_compatible: false,
                compatibility_message: error.clone(),
                reason: Some(error),
                locales: vec![LocaleOption {
                    id: "zh-cn",
                    label: "简体中文",
                    tag: "zh-CN",
                }],
            }
        }
    }
}

pub fn run(request: &ActionRequest, sink: ProgressSink) -> Result<OperationResult, String> {
    if request.locale != "zh-cn" {
        return Err(format!(
            "Claude Desktop 暂不支持目标语言: {}",
            request.locale
        ));
    }
    let install = resolve_install()?;
    let root = data_root();
    sink.emit(
        8,
        "INFO",
        format!(
            "已检测 Claude Desktop {} @ {}.",
            install.version,
            install.install_location.display()
        ),
    );

    match request.action.as_str() {
        "preview" => preview(&install, &root, request, sink),
        "backup" => create_backup(&install, &root, request, sink),
        "install" => install_patch(&install, &root, request, sink),
        "restore" => restore(&install, &root, request, sink),
        other => Err(format!("Claude Desktop 不支持操作: {other}")),
    }
}

fn create_backup(
    install: &ClaudeInstall,
    root: &Path,
    request: &ActionRequest,
    sink: ProgressSink,
) -> Result<OperationResult, String> {
    let memory = load_translation_memory()?;
    sink.emit(22, "INFO", "正在关闭 Claude Desktop 并准备原始资源备份.");
    stop_claude()?;
    sink.emit(
        45,
        "INFO",
        "Claude Desktop 已退出, 正在创建不可覆盖的版本备份.",
    );
    let backup = ensure_backup(root, install, &memory)?;
    validate_backup(&backup, install)?;
    sink.emit(100, "DONE", "Claude Desktop 原始资源备份已完成校验.");
    Ok(OperationResult {
        app_id: "claude".to_string(),
        action: request.action.clone(),
        title: "Claude Desktop 备份已校验".to_string(),
        message: format!(
            "3 个资源文件已完成版本, 文件大小和 SHA256 校验: {}",
            backup.display()
        ),
        files_changed: 0,
        replacements: 0,
        backup_path: Some(backup.to_string_lossy().into_owned()),
    })
}

pub fn data_root() -> PathBuf {
    local_app_data().join("I18nWorkbench")
}

fn preview(
    install: &ClaudeInstall,
    root: &Path,
    request: &ActionRequest,
    sink: ProgressSink,
) -> Result<OperationResult, String> {
    let memory = load_translation_memory()?;
    sink.emit(
        24,
        "INFO",
        format!("翻译记忆库已加载, {} 条.", memory.len()),
    );
    let source = source_root(root, install)?;
    let stats = preview_resources(&source, &memory)?;
    let replacements = stats.iter().map(|(_, stat)| stat.replaced).sum();
    let total: usize = stats.iter().map(|(_, stat)| stat.total_strings).sum();
    for (index, (relative, stat)) in stats.iter().enumerate() {
        sink.emit(
            38 + index as u8 * 18,
            "INFO",
            format!(
                "{relative}: 预计替换 {}/{} 条.",
                stat.replaced, stat.total_strings
            ),
        );
    }
    sink.emit(100, "DONE", "Claude Desktop 资源预检通过.");
    Ok(OperationResult {
        app_id: "claude".to_string(),
        action: request.action.clone(),
        title: "Claude Desktop 预检通过".to_string(),
        message: format!("3 个资源文件共可替换 {replacements}/{total} 条文本."),
        files_changed: 0,
        replacements,
        backup_path: backup_dir(root, install)
            .is_dir()
            .then(|| backup_dir(root, install).to_string_lossy().into_owned()),
    })
}

fn install_patch(
    install: &ClaudeInstall,
    root: &Path,
    request: &ActionRequest,
    sink: ProgressSink,
) -> Result<OperationResult, String> {
    let backup = require_install_backup(root, install)?;
    sink.emit(
        18,
        "INFO",
        format!("安装前备份完整性门禁通过: {}", backup.display()),
    );
    let memory = load_translation_memory()?;
    sink.emit(
        30,
        "INFO",
        format!("翻译记忆库已加载, {} 条.", memory.len()),
    );

    let prepared = prepare_translations(&backup, &memory)?;
    let replacements = prepared.iter().map(|file| file.stats.replaced).sum();
    if replacements == 0 {
        return Err("原始资源没有命中翻译记忆库, 已停止安装".to_string());
    }
    sink.emit(
        56,
        "INFO",
        format!("已生成 3 个资源文件, 共替换 {replacements} 条."),
    );

    stop_claude()?;
    sink.emit(68, "INFO", "Claude Desktop 已退出, 正在检查写入权限.");
    for file in &prepared {
        ensure_write_access(&install.resources.join(file.relative_path))?;
    }
    commit_prepared(&install.resources, &backup, &prepared)?;
    sink.emit(92, "INFO", "资源文件已写入并完成回读校验.");

    write_state(
        root,
        install,
        ClaudeState {
            schema: 1,
            version: install.version.clone(),
            package_name: install.package_name.clone(),
            current_state: "patched".to_string(),
            backup_path: backup.to_string_lossy().into_owned(),
            last_action: "install".to_string(),
            updated_at_unix: now_unix(),
        },
    )?;
    sink.emit(100, "DONE", "Claude Desktop 汉化完成, 重新打开后生效.");
    Ok(OperationResult {
        app_id: "claude".to_string(),
        action: request.action.clone(),
        title: "Claude Desktop 汉化完成".to_string(),
        message: format!("仅修改 3 个 en-US.json, 共替换 {replacements} 条文本."),
        files_changed: RESOURCE_FILES.len(),
        replacements,
        backup_path: Some(backup.to_string_lossy().into_owned()),
    })
}

fn restore(
    install: &ClaudeInstall,
    root: &Path,
    request: &ActionRequest,
    sink: ProgressSink,
) -> Result<OperationResult, String> {
    if let Some(selected_version) = request
        .backup_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if selected_version != install.version {
            return Err(format!(
                "备份版本 {selected_version} 与当前 Claude Desktop {} 不匹配, 已拒绝恢复",
                install.version
            ));
        }
    }
    let backup = backup_dir(root, install);
    validate_backup(&backup, install)?;
    sink.emit(
        30,
        "INFO",
        format!("备份完整性校验通过: {}", backup.display()),
    );
    stop_claude()?;
    sink.emit(48, "INFO", "Claude Desktop 已退出, 准备恢复原始资源.");

    let prepared = RESOURCE_FILES
        .iter()
        .map(|relative| {
            fs::read(backup.join(relative))
                .map(|data| PreparedFile {
                    relative_path: relative,
                    data,
                    stats: TranslationStats::default(),
                })
                .map_err(|error| format!("读取备份失败 {relative}: {error}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    for file in &prepared {
        ensure_write_access(&install.resources.join(file.relative_path))?;
    }
    commit_prepared(&install.resources, &backup, &prepared)?;
    sink.emit(90, "INFO", "3 个原始资源文件已恢复并完成校验.");

    write_state(
        root,
        install,
        ClaudeState {
            schema: 1,
            version: install.version.clone(),
            package_name: install.package_name.clone(),
            current_state: "restored".to_string(),
            backup_path: backup.to_string_lossy().into_owned(),
            last_action: "restore".to_string(),
            updated_at_unix: now_unix(),
        },
    )?;
    sink.emit(100, "DONE", "Claude Desktop 已恢复原版.");
    Ok(OperationResult {
        app_id: "claude".to_string(),
        action: request.action.clone(),
        title: "Claude Desktop 已恢复原版".to_string(),
        message: "3 个 en-US.json 已从版本备份恢复.".to_string(),
        files_changed: RESOURCE_FILES.len(),
        replacements: 0,
        backup_path: Some(backup.to_string_lossy().into_owned()),
    })
}

pub fn list_backups() -> Vec<BackupRecord> {
    let root = data_root().join("backups").join("claude");
    let current_install = resolve_install().ok();
    let Ok(entries) = fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut records = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .map(|entry| claude_backup_record(&entry.path().join("original"), current_install.as_ref()))
        .collect::<Vec<_>>();
    records.sort_by(|left, right| right.version.cmp(&left.version));
    records
}

fn claude_backup_record(path: &Path, current_install: Option<&ClaudeInstall>) -> BackupRecord {
    let directory_version = path
        .parent()
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "未知".to_string());
    let manifest = read_backup_manifest(path);
    let mut version = directory_version.clone();
    let mut created_at_unix = None;
    let mut files = 0usize;
    let validation = match manifest {
        Ok(manifest) => {
            version = manifest.version.clone();
            created_at_unix = Some(manifest.created_at_unix);
            files = manifest.files.len();
            validate_backup_contents(path, &manifest, Some(&directory_version)).and_then(|_| {
                if let Some(install) = current_install.filter(|install| install.version == version)
                {
                    if manifest.package_name != install.package_name {
                        return Err("备份清单与当前 Claude 安装包不匹配".to_string());
                    }
                }
                Ok(())
            })
        }
        Err(error) => Err(error),
    };
    let valid = validation.is_ok();
    let current = current_install
        .map(|install| install.version == version)
        .unwrap_or(false);
    let can_restore = valid && current;
    let (status, detail) = match validation {
        Ok(()) if current => (
            "可恢复".to_string(),
            "完整性校验通过, 与当前安装版本匹配".to_string(),
        ),
        Ok(()) => (
            "历史备份".to_string(),
            "完整性校验通过, 仅支持恢复到相同软件版本".to_string(),
        ),
        Err(error) => ("校验失败".to_string(), error),
    };
    BackupRecord {
        id: format!("claude:{directory_version}"),
        app_id: "claude".to_string(),
        app_name: "Claude Desktop".to_string(),
        version,
        created_at_iso: None,
        created_at_unix,
        path: path.to_string_lossy().into_owned(),
        files,
        valid,
        current,
        can_restore,
        status,
        detail,
    }
}

fn load_translation_memory() -> Result<HashMap<String, String>, String> {
    let memory: HashMap<String, String> = serde_json::from_str(TRANSLATION_MEMORY)
        .map_err(|error| format!("翻译记忆库格式错误: {error}"))?;
    if memory.is_empty() {
        return Err("翻译记忆库为空".to_string());
    }
    Ok(memory)
}

fn preview_resources(
    source_root: &Path,
    memory: &HashMap<String, String>,
) -> Result<Vec<(String, TranslationStats)>, String> {
    RESOURCE_FILES
        .iter()
        .map(|relative| {
            let mut value = read_json(&source_root.join(relative))?;
            let mut stats = TranslationStats::default();
            translate_json(&mut value, memory, &mut stats);
            Ok((relative.to_string(), stats))
        })
        .collect()
}

fn prepare_translations(
    source_root: &Path,
    memory: &HashMap<String, String>,
) -> Result<Vec<PreparedFile>, String> {
    RESOURCE_FILES
        .iter()
        .map(|relative| {
            let mut value = read_json(&source_root.join(relative))?;
            let mut stats = TranslationStats::default();
            translate_json(&mut value, memory, &mut stats);
            let mut text = serde_json::to_string_pretty(&value)
                .map_err(|error| format!("生成 JSON 失败 {relative}: {error}"))?;
            text.push('\n');
            serde_json::from_str::<Value>(&text)
                .map_err(|error| format!("生成结果校验失败 {relative}: {error}"))?;
            Ok(PreparedFile {
                relative_path: relative,
                data: text.into_bytes(),
                stats,
            })
        })
        .collect()
}

fn translate_json(
    value: &mut Value,
    memory: &HashMap<String, String>,
    stats: &mut TranslationStats,
) {
    match value {
        Value::String(text) => {
            stats.total_strings += 1;
            if let Some(translated) = memory.get(text) {
                *text = translated.clone();
                stats.replaced += 1;
            } else {
                stats.unmatched += 1;
            }
        }
        Value::Array(items) => {
            for item in items {
                translate_json(item, memory, stats);
            }
        }
        Value::Object(object) => {
            for item in object.values_mut() {
                translate_json(item, memory, stats);
            }
        }
        _ => {}
    }
}

fn count_known_translations(value: &Value, translations: &HashSet<&str>) -> usize {
    match value {
        Value::String(text) => usize::from(translations.contains(text.as_str())),
        Value::Array(items) => items
            .iter()
            .map(|item| count_known_translations(item, translations))
            .sum(),
        Value::Object(object) => object
            .values()
            .map(|item| count_known_translations(item, translations))
            .sum(),
        _ => 0,
    }
}

fn contains_cjk(value: &str) -> bool {
    value
        .chars()
        .any(|ch| matches!(ch, '\u{3400}'..='\u{9fff}' | '\u{f900}'..='\u{faff}'))
}

fn ensure_backup(
    root: &Path,
    install: &ClaudeInstall,
    memory: &HashMap<String, String>,
) -> Result<PathBuf, String> {
    let target = backup_dir(root, install);
    if target.exists() {
        validate_backup(&target, install)?;
        return Ok(target);
    }

    assert_resource_files(&install.resources)?;
    let known_translations = memory
        .values()
        .filter(|value| contains_cjk(value))
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let localized_values = RESOURCE_FILES.iter().try_fold(0usize, |total, relative| {
        let value = read_json(&install.resources.join(relative))?;
        Ok::<_, String>(total + count_known_translations(&value, &known_translations))
    })?;
    if localized_values > 0 {
        return Err(format!(
            "当前 Claude 资源已包含 {localized_values} 个已知中文译文, 已拒绝将其保存为原始备份"
        ));
    }
    let stats = preview_resources(&install.resources, memory)?;
    if stats.iter().map(|(_, stat)| stat.replaced).sum::<usize>() == 0 {
        return Err(
            "当前 Claude 资源没有命中翻译记忆库, 疑似已汉化, 已拒绝创建原始备份".to_string(),
        );
    }

    let parent = target
        .parent()
        .ok_or_else(|| "备份目录无父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("创建备份目录失败: {error}"))?;
    let staging = parent.join(format!(
        ".original.tmp-{}-{}",
        std::process::id(),
        now_unix()
    ));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|error| format!("清理临时备份目录失败: {error}"))?;
    }

    let result = (|| {
        let mut files = Vec::new();
        for relative in RESOURCE_FILES {
            let source = install.resources.join(relative);
            let destination = staging.join(relative);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("创建备份子目录失败: {error}"))?;
            }
            fs::copy(&source, &destination)
                .map_err(|error| format!("备份失败 {}: {error}", source.display()))?;
            let bytes = fs::metadata(&destination)
                .map_err(|error| format!("读取备份元数据失败: {error}"))?
                .len();
            files.push(BackupFile {
                relative_path: relative.to_string(),
                bytes,
                sha256: sha256_file(&destination)?,
            });
        }
        let manifest = BackupManifest {
            schema: 1,
            app_id: "claude".to_string(),
            version: install.version.clone(),
            package_name: install.package_name.clone(),
            created_at_unix: now_unix(),
            translation_memory_version: MEMORY_VERSION.to_string(),
            translation_memory_sha256: sha256_bytes(TRANSLATION_MEMORY.as_bytes()),
            files,
        };
        write_json(&staging.join("manifest.json"), &manifest)?;
        validate_backup(&staging, install)?;
        fs::rename(&staging, &target).map_err(|error| format!("提交备份目录失败: {error}"))?;
        if let Err(error) = validate_backup(&target, install) {
            let cleanup = fs::remove_dir_all(&target)
                .err()
                .map(|cleanup| format!("; 清理无效备份失败: {cleanup}"))
                .unwrap_or_default();
            return Err(format!("正式备份提交后复验失败: {error}{cleanup}"));
        }
        Ok(target.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn read_backup_manifest(path: &Path) -> Result<BackupManifest, String> {
    let raw = fs::read_to_string(path.join("manifest.json"))
        .map_err(|error| format!("备份清单不可读: {error}"))?;
    serde_json::from_str(&raw).map_err(|error| format!("备份清单格式错误: {error}"))
}

fn validate_backup_contents(
    path: &Path,
    manifest: &BackupManifest,
    expected_version: Option<&str>,
) -> Result<(), String> {
    if manifest.schema != 1 || manifest.app_id != "claude" {
        return Err("备份清单身份无效".to_string());
    }
    if expected_version.is_some_and(|version| manifest.version != version) {
        return Err("备份目录版本与清单版本不匹配".to_string());
    }
    if manifest.files.len() != RESOURCE_FILES.len() {
        return Err(format!(
            "备份清单文件数量错误: 期望 {}, 实际 {}",
            RESOURCE_FILES.len(),
            manifest.files.len()
        ));
    }
    for relative in RESOURCE_FILES {
        let entry = manifest
            .files
            .iter()
            .find(|entry| entry.relative_path.replace('\\', "/") == relative)
            .ok_or_else(|| format!("备份清单缺少文件: {relative}"))?;
        let file = path.join(relative);
        let bytes = fs::metadata(&file)
            .map_err(|error| format!("备份文件不可读 {relative}: {error}"))?
            .len();
        if bytes != entry.bytes || sha256_file(&file)? != entry.sha256 {
            return Err(format!("备份文件完整性校验失败: {relative}"));
        }
        read_json(&file)?;
    }
    Ok(())
}

fn validate_backup(path: &Path, install: &ClaudeInstall) -> Result<(), String> {
    let manifest = read_backup_manifest(path)?;
    validate_backup_contents(path, &manifest, Some(&install.version))?;
    if manifest.package_name != install.package_name {
        return Err("备份清单与当前 Claude 安装包不匹配".to_string());
    }
    Ok(())
}

fn require_install_backup(root: &Path, install: &ClaudeInstall) -> Result<PathBuf, String> {
    let backup = backup_dir(root, install);
    if !backup.is_dir() {
        return Err(
            "安装已停止: 当前 Claude Desktop 版本没有完整备份. 请先前往备份选项卡创建并校验备份"
                .to_string(),
        );
    }
    validate_backup(&backup, install).map_err(|error| {
        format!(
            "安装已停止: 当前 Claude Desktop 版本的备份未通过完整校验. 请先前往备份选项卡处理备份. 详情: {error}"
        )
    })?;
    Ok(backup)
}

fn backup_manifest_file_count(path: &Path) -> usize {
    fs::read_to_string(path.join("manifest.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<BackupManifest>(&raw).ok())
        .map(|manifest| manifest.files.len())
        .unwrap_or(0)
}

fn commit_prepared(
    target_root: &Path,
    rollback_root: &Path,
    files: &[PreparedFile],
) -> Result<(), String> {
    let mut attempted = Vec::new();
    for file in files {
        attempted.push(file.relative_path);
        let target = target_root.join(file.relative_path);
        if let Err(error) = write_target(&target, &file.data) {
            let rollback_errors = rollback_files(target_root, rollback_root, &attempted);
            return Err(if rollback_errors.is_empty() {
                format!("写入失败 {}, 已自动回滚: {error}", file.relative_path)
            } else {
                format!(
                    "写入失败 {}: {error}; 自动回滚异常: {}",
                    file.relative_path,
                    rollback_errors.join("; ")
                )
            });
        }
        let verification = (|| {
            let live = fs::read(&target)
                .map_err(|error| format!("写入后回读失败 {}: {error}", file.relative_path))?;
            if sha256_bytes(&live) != sha256_bytes(&file.data) {
                return Err(format!("写入后哈希不一致: {}", file.relative_path));
            }
            read_json(&target)?;
            Ok(())
        })();
        if let Err(error) = verification {
            let rollback_errors = rollback_files(target_root, rollback_root, &attempted);
            return Err(format!(
                "{error}{}",
                if rollback_errors.is_empty() {
                    ", 已自动回滚".to_string()
                } else {
                    format!("; 自动回滚异常: {}", rollback_errors.join("; "))
                }
            ));
        }
    }
    Ok(())
}

fn rollback_files(
    target_root: &Path,
    rollback_root: &Path,
    relative_files: &[&str],
) -> Vec<String> {
    let mut errors = Vec::new();
    for relative in relative_files.iter().rev() {
        match fs::read(rollback_root.join(relative))
            .map_err(|error| error.to_string())
            .and_then(|data| write_target(&target_root.join(relative), &data))
        {
            Ok(()) => {}
            Err(error) => errors.push(format!("{relative}: {error}")),
        }
    }
    errors
}

fn write_target(path: &Path, data: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(data).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

fn ensure_write_access(path: &Path) -> Result<(), String> {
    if fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .is_ok()
    {
        return Ok(());
    }
    if !is_elevated() {
        return Err(format!(
            "没有写入权限: {}. 请使用界面中的管理员权限重启按钮",
            path.display()
        ));
    }

    let command_path = windows_tool_path(path);
    let takeown = hidden_command("takeown.exe")
        .arg("/F")
        .arg(&command_path)
        .arg("/A")
        .output()
        .map_err(|error| format!("takeown 启动失败: {error}"))?;
    if !takeown.status.success() {
        return Err(format!(
            "takeown 失败: {}. {}",
            path.display(),
            command_failure_detail(&takeown)
        ));
    }
    let icacls = hidden_command("icacls.exe")
        .arg(&command_path)
        .args(["/grant", "*S-1-5-32-544:(F)", "/C"])
        .output()
        .map_err(|error| format!("icacls 启动失败: {error}"))?;
    if !icacls.status.success() {
        return Err(format!(
            "icacls 授权失败: {}. {}",
            path.display(),
            command_failure_detail(&icacls)
        ));
    }
    let _ = hidden_command("attrib.exe")
        .arg("-R")
        .arg(&command_path)
        .status();
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map(|_| ())
        .map_err(|error| format!("权限处理后仍无法写入 {}: {error}", path.display()))
}

fn windows_tool_path(path: &Path) -> String {
    path.as_os_str().to_string_lossy().replace('/', "\\")
}

fn command_failure_detail(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let text = [stderr.trim(), stdout.trim()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        format!("exit {:?}", output.status.code())
    } else {
        let mut chars = normalized.chars();
        let preview = chars.by_ref().take(420).collect::<String>();
        if chars.next().is_some() {
            format!("exit {:?}: {preview}...", output.status.code())
        } else {
            format!("exit {:?}: {preview}", output.status.code())
        }
    }
}

fn stop_claude() -> Result<(), String> {
    let _ = hidden_command("taskkill.exe")
        .args(["/IM", "Claude.exe", "/F"])
        .status();
    std::thread::sleep(Duration::from_millis(350));
    let output = hidden_command("tasklist.exe")
        .args(["/FI", "IMAGENAME eq Claude.exe", "/NH", "/FO", "CSV"])
        .output()
        .map_err(|error| format!("无法确认 Claude.exe 状态: {error}"))?;
    if String::from_utf8_lossy(&output.stdout)
        .to_ascii_lowercase()
        .contains("claude.exe")
    {
        return Err("Claude.exe 仍在运行, 请手动完全退出后重试".to_string());
    }
    Ok(())
}

fn resolve_install() -> Result<ClaudeInstall, String> {
    if let Some(resources) = std::env::var_os("CLAUDE_RESOURCES_DIR").map(PathBuf::from) {
        return install_from_resources(resources, "manual".to_string());
    }

    let script = "$p=Get-AppxPackage -Name Claude -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1; if ($p) { [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Write-Output $p.InstallLocation; Write-Output $p.Version; Write-Output $p.PackageFullName }";
    if let Ok(output) = hidden_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
    {
        if output.status.success() {
            let lines = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>();
            if let Some(location) = lines.first() {
                let install_location = PathBuf::from(location);
                let resources = install_location.join("app").join("resources");
                let version = lines
                    .get(1)
                    .cloned()
                    .unwrap_or_else(|| version_from_path(Path::new(location)));
                validate_resource_structure(&resources).map_err(|error| {
                    format!(
                        "已找到最新 Claude Desktop {version}, 但资源结构不兼容: {error}. 已停止自动适配"
                    )
                })?;
                return Ok(ClaudeInstall {
                    install_location,
                    resources,
                    version,
                    package_name: lines
                        .get(2)
                        .cloned()
                        .unwrap_or_else(|| "Claude".to_string()),
                });
            }
        }
    }

    let mut candidates = Vec::new();
    let windows_apps = std::env::var_os("ProgramFiles")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"))
        .join("WindowsApps");
    if let Ok(entries) = fs::read_dir(windows_apps) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("Claude_") && name.ends_with("__pzs8sxrjxfjjc") {
                candidates.push(entry.path());
            }
        }
    }
    candidates.sort_by_key(|path| version_parts(&version_from_path(path)));
    candidates.reverse();
    for install_location in candidates {
        let resources = install_location.join("app").join("resources");
        let version = version_from_path(&install_location);
        validate_resource_structure(&resources).map_err(|error| {
            format!(
                "已找到最新 Claude Desktop {version}, 但资源结构不兼容: {error}. 已停止自动适配"
            )
        })?;
        return Ok(ClaudeInstall {
            version,
            package_name: install_location
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Claude".to_string()),
            install_location,
            resources,
        });
    }

    let local_candidate = local_app_data().join("Programs/Claude/resources");
    if validate_resource_structure(&local_candidate).is_ok() {
        return install_from_resources(local_candidate, "Claude".to_string());
    }
    Err("未找到 Claude Desktop 的 3 个目标资源文件".to_string())
}

fn install_from_resources(
    resources: PathBuf,
    package_name: String,
) -> Result<ClaudeInstall, String> {
    validate_resource_structure(&resources)?;
    let install_location = resources
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| resources.clone());
    Ok(ClaudeInstall {
        version: version_from_path(&install_location),
        install_location,
        resources,
        package_name,
    })
}

fn assert_resource_files(resources: &Path) -> Result<(), String> {
    let missing = RESOURCE_FILES
        .iter()
        .filter(|relative| !resources.join(relative).is_file())
        .copied()
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!("Claude 资源结构缺少文件: {}", missing.join(", ")))
    }
}

fn validate_resource_structure(resources: &Path) -> Result<usize, String> {
    assert_resource_files(resources)?;
    let mut total_strings = 0usize;
    for relative in RESOURCE_FILES {
        let value = read_json(&resources.join(relative))?;
        if !value.is_object() && !value.is_array() {
            return Err(format!("Claude 资源文件根节点必须是对象或数组: {relative}"));
        }
        let strings = count_string_values(&value);
        if strings == 0 {
            return Err(format!("Claude 资源文件不包含可翻译字符串: {relative}"));
        }
        total_strings += strings;
    }
    Ok(total_strings)
}

fn count_string_values(value: &Value) -> usize {
    match value {
        Value::String(_) => 1,
        Value::Array(items) => items.iter().map(count_string_values).sum(),
        Value::Object(items) => items.values().map(count_string_values).sum(),
        _ => 0,
    }
}

fn source_root(root: &Path, install: &ClaudeInstall) -> Result<PathBuf, String> {
    let backup = backup_dir(root, install);
    if backup.exists() {
        validate_backup(&backup, install)?;
        Ok(backup)
    } else {
        assert_resource_files(&install.resources)?;
        Ok(install.resources.clone())
    }
}

fn backup_dir(root: &Path, install: &ClaudeInstall) -> PathBuf {
    root.join("backups")
        .join("claude")
        .join(safe_segment(&install.version))
        .join("original")
}

fn state_path(root: &Path, install: &ClaudeInstall) -> PathBuf {
    root.join("state")
        .join("claude")
        .join(format!("{}.json", safe_segment(&install.version)))
}

fn read_state(root: &Path, install: &ClaudeInstall) -> Result<ClaudeState, String> {
    let path = state_path(root, install);
    if !path.is_file() {
        return Ok(ClaudeState::default());
    }
    let raw =
        fs::read_to_string(&path).map_err(|error| format!("读取 Claude 状态失败: {error}"))?;
    serde_json::from_str(&raw).map_err(|error| format!("Claude 状态格式错误: {error}"))
}

fn write_state(root: &Path, install: &ClaudeInstall, state: ClaudeState) -> Result<(), String> {
    write_json(&state_path(root, install), &state)
}

fn read_json(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("读取 JSON 失败 {}: {error}", path.display()))?;
    serde_json::from_str(&raw).map_err(|error| format!("JSON 格式错误 {}: {error}", path.display()))
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建目录失败 {}: {error}", parent.display()))?;
    }
    let mut text =
        serde_json::to_string_pretty(value).map_err(|error| format!("生成 JSON 失败: {error}"))?;
    text.push('\n');
    fs::write(path, text).map_err(|error| format!("写入 JSON 失败 {}: {error}", path.display()))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    fs::read(path)
        .map(|data| sha256_bytes(&data))
        .map_err(|error| format!("读取文件哈希失败 {}: {error}", path.display()))
}

fn sha256_bytes(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}

fn version_from_path(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    name.strip_prefix("Claude_")
        .and_then(|value| value.split('_').next())
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown")
        .to_string()
}

fn version_parts(version: &str) -> Vec<u64> {
    version
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}

fn safe_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sandbox() -> PathBuf {
        std::env::temp_dir().join(format!(
            "i18n-workbench-claude-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    fn write_resources(root: &Path) {
        for relative in RESOURCE_FILES {
            let path = root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, r#"{"title":"Copy","nested":["Edit",42]}"#).unwrap();
        }
    }

    #[test]
    fn normalizes_nested_resource_paths_for_windows_tools() {
        let resources =
            PathBuf::from(r"C:\Program Files\WindowsApps\Claude_1.0.0.0_x64__test\app\resources");
        for relative in &RESOURCE_FILES[1..] {
            let normalized = windows_tool_path(&resources.join(relative));
            assert!(!normalized.contains('/'));
            assert!(normalized.ends_with(&relative.replace('/', "\\")));
        }
    }

    #[cfg(windows)]
    #[test]
    fn preserves_external_command_failure_details() {
        let output = hidden_command("cmd.exe")
            .args(["/D", "/C", "echo takeown diagnostic 1>&2 & exit /b 7"])
            .output()
            .unwrap();
        let detail = command_failure_detail(&output);
        assert!(detail.contains("Some(7)"));
        assert!(detail.contains("takeown diagnostic"));
    }

    #[test]
    fn translates_nested_json_values_only() {
        let mut value: Value =
            serde_json::from_str(r#"{"Copy":"Copy","items":["Edit",1]}"#).unwrap();
        let memory = HashMap::from([
            ("Copy".to_string(), "复制".to_string()),
            ("Edit".to_string(), "编辑".to_string()),
        ]);
        let mut stats = TranslationStats::default();
        translate_json(&mut value, &memory, &mut stats);
        assert_eq!(value["Copy"], "复制");
        assert_eq!(value["items"][0], "编辑");
        assert_eq!(stats.replaced, 2);
    }

    #[test]
    fn accepts_future_version_when_resource_structure_is_compatible() {
        let root = sandbox();
        let resources = root.join("Claude_99.0.0.0_x64__pzs8sxrjxfjjc/app/resources");
        write_resources(&resources);

        let strings = validate_resource_structure(&resources).unwrap();
        assert_eq!(strings, 6);

        fs::write(resources.join("ion-dist/i18n/en-US.json"), "not-json").unwrap();
        let error = validate_resource_structure(&resources).unwrap_err();
        assert!(error.contains("JSON"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn creates_and_validates_immutable_version_backup() {
        let root = sandbox();
        let resources = root.join("app/resources");
        let data = root.join("data");
        write_resources(&resources);
        let install = ClaudeInstall {
            install_location: root.join("Claude_1.2.3.4_x64__pzs8sxrjxfjjc"),
            resources: resources.clone(),
            version: "1.2.3.4".to_string(),
            package_name: "Claude_test".to_string(),
        };
        let memory = HashMap::from([
            ("Copy".to_string(), "复制".to_string()),
            ("Edit".to_string(), "编辑".to_string()),
        ]);

        let backup = ensure_backup(&data, &install, &memory).unwrap();
        validate_backup(&backup, &install).unwrap();
        assert_eq!(require_install_backup(&data, &install).unwrap(), backup);
        fs::write(resources.join("en-US.json"), "{}").unwrap();
        let same_backup = ensure_backup(&data, &install, &memory).unwrap();
        assert_eq!(backup, same_backup);
        assert!(fs::read_to_string(backup.join("en-US.json"))
            .unwrap()
            .contains("Copy"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn install_gate_rejects_missing_backup() {
        let root = sandbox();
        let resources = root.join("app/resources");
        let data = root.join("data");
        write_resources(&resources);
        let install = ClaudeInstall {
            install_location: root.clone(),
            resources,
            version: "3.0.0.0".to_string(),
            package_name: "Claude_test".to_string(),
        };

        let error = require_install_backup(&data, &install).unwrap_err();
        assert!(error.contains("备份选项卡"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn install_gate_rejects_damaged_backup() {
        let root = sandbox();
        let resources = root.join("app/resources");
        let data = root.join("data");
        write_resources(&resources);
        let install = ClaudeInstall {
            install_location: root.clone(),
            resources,
            version: "4.0.0.0".to_string(),
            package_name: "Claude_test".to_string(),
        };
        let memory = HashMap::from([
            ("Copy".to_string(), "复制".to_string()),
            ("Edit".to_string(), "编辑".to_string()),
        ]);
        let backup = ensure_backup(&data, &install, &memory).unwrap();
        fs::write(backup.join("en-US.json"), "{}").unwrap();

        let error = require_install_backup(&data, &install).unwrap_err();
        assert!(error.contains("完整性校验失败"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_to_backup_partially_translated_resources() {
        let root = sandbox();
        let resources = root.join("app/resources");
        let data = root.join("data");
        write_resources(&resources);
        fs::write(
            resources.join("en-US.json"),
            r#"{"title":"复制","other":"Edit"}"#,
        )
        .unwrap();
        let install = ClaudeInstall {
            install_location: root.clone(),
            resources,
            version: "2.0.0.0".to_string(),
            package_name: "Claude_test".to_string(),
        };
        let memory = HashMap::from([
            ("Copy".to_string(), "复制".to_string()),
            ("Edit".to_string(), "编辑".to_string()),
        ]);

        let error = ensure_backup(&data, &install, &memory).unwrap_err();
        assert!(error.contains("已知中文译文"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn backup_history_marks_only_matching_version_as_restorable() {
        let root = sandbox();
        let resources = root.join("app/resources");
        let data = root.join("data");
        write_resources(&resources);
        let install = ClaudeInstall {
            install_location: root.join("Claude_5.0.0.0_x64__pzs8sxrjxfjjc"),
            resources: resources.clone(),
            version: "5.0.0.0".to_string(),
            package_name: "Claude_test".to_string(),
        };
        let memory = HashMap::from([
            ("Copy".to_string(), "复制".to_string()),
            ("Edit".to_string(), "编辑".to_string()),
        ]);
        let backup = ensure_backup(&data, &install, &memory).unwrap();

        let current = claude_backup_record(&backup, Some(&install));
        assert!(current.valid);
        assert!(current.current);
        assert!(current.can_restore);
        assert_eq!(current.files, RESOURCE_FILES.len());

        let newer_install = ClaudeInstall {
            install_location: root.join("Claude_6.0.0.0_x64__pzs8sxrjxfjjc"),
            resources,
            version: "6.0.0.0".to_string(),
            package_name: "Claude_test".to_string(),
        };
        let historical = claude_backup_record(&backup, Some(&newer_install));
        assert!(historical.valid);
        assert!(!historical.current);
        assert!(!historical.can_restore);
        assert_eq!(historical.status, "历史备份");
        let _ = fs::remove_dir_all(root);
    }
}
