use super::{
    hidden_command, ActionRequest, AppStatus, BackupRecord, LocaleOption, NodeRuntimeStatus,
    OperationResult, ProgressSink,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc;
use std::thread;

const ADAPTER_VERSION: &str = "0.3.6";
const MIN_NODE_MAJOR: u32 = 18;

struct BackupDetails {
    available: bool,
    path: Option<String>,
    files: usize,
    message: String,
}

struct CompatibilityDetails {
    compatible: bool,
    message: String,
}

const WORKBENCH_BUNDLE_MIN_SIZE: u64 = 64 * 1024;
const CURSOR_ANCHOR_TARGETS: [&str; 4] = [
    "out/vs/workbench/workbench.glass.main.js",
    "out/vs/workbench/workbench.desktop.main.js",
    "out/vs/workbench/workbench.anysphere-ui-automations.js",
    "out/main.js",
];

pub fn detect() -> AppStatus {
    let app_dir = cursor_app_dir();
    let root = engine_root();
    let node_runtime = node_runtime_status();
    let node = node_runtime
        .compatible
        .then(|| node_runtime.version.clone())
        .flatten();
    let version = app_dir.as_deref().and_then(read_version);
    let installed = app_dir.is_some();
    let compatibility = inspect_compatibility(app_dir.as_deref(), version.as_deref());
    let ready = installed && root.is_some() && node.is_some() && compatibility.compatible;
    let backup = match (&root, &version, &node) {
        (Some(root), Some(version), Some(_)) => inspect_backup(root, version),
        (Some(root), Some(version), None) => {
            let path = root.join("backup").join(version);
            BackupDetails {
                available: false,
                files: backup_file_count(&path),
                path: Some(path.to_string_lossy().into_owned()),
                message: format!("{}. Node.js 就绪后才能校验备份", node_runtime.message),
            }
        }
        _ => BackupDetails {
            available: false,
            path: None,
            files: 0,
            message: if installed {
                "Cursor 引擎或版本信息未就绪, 暂时无法创建备份".to_string()
            } else {
                "安装 Cursor 后才能创建版本备份".to_string()
            },
        },
    };
    let localized = match (&root, &version) {
        (Some(root), Some(version)) => root
            .join("backup")
            .join(version)
            .join("install-state.json")
            .is_file(),
        _ => false,
    };

    let reason = if !installed {
        Some("未找到 Cursor 的 resources/app 目录".to_string())
    } else if !compatibility.compatible {
        Some(compatibility.message.clone())
    } else if root.is_none() {
        Some("未找到 cursor-i18n-zh 引擎文件".to_string())
    } else if node.is_none() {
        Some(node_runtime.message.clone())
    } else {
        None
    };

    AppStatus {
        id: "cursor",
        name: "Cursor",
        description: "AI 代码编辑器中文适配器",
        installed,
        ready,
        path: app_dir.map(|path| path.to_string_lossy().into_owned()),
        version,
        state: if !compatibility.compatible && installed {
            "结构待适配".to_string()
        } else if localized {
            "已汉化".to_string()
        } else if ready {
            "自动兼容".to_string()
        } else if installed {
            "环境未就绪".to_string()
        } else {
            "未安装".to_string()
        },
        state_tone: if compatibility.compatible && (localized || ready) {
            "success"
        } else {
            "warning"
        },
        adapter_version: ADAPTER_VERSION,
        backup_available: backup.available,
        backup_path: backup.path,
        backup_files: backup.files,
        backup_message: backup.message,
        localized,
        auto_compatible: compatibility.compatible,
        compatibility_message: compatibility.message,
        reason,
        locales: vec![
            LocaleOption {
                id: "zh-cn",
                label: "简体中文",
                tag: "zh-CN",
            },
            LocaleOption {
                id: "zh-tw",
                label: "繁體中文",
                tag: "zh-TW",
            },
        ],
    }
}

fn inspect_compatibility(app_dir: Option<&Path>, version: Option<&str>) -> CompatibilityDetails {
    let Some(app_dir) = app_dir else {
        return CompatibilityDetails {
            compatible: false,
            message: "安装 Cursor 后自动检测资源结构".to_string(),
        };
    };
    let Some(version) = version else {
        return CompatibilityDetails {
            compatible: false,
            message: "Cursor product.json 缺少可识别版本, 已停止自动适配".to_string(),
        };
    };

    let mut targets = CURSOR_ANCHOR_TARGETS
        .iter()
        .filter(|relative| app_dir.join(relative).is_file())
        .map(|relative| relative.to_string())
        .collect::<std::collections::HashSet<_>>();
    let workbench = app_dir.join("out/vs/workbench");
    if let Ok(entries) = fs::read_dir(&workbench) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("workbench.")
                && name.ends_with(".js")
                && entry
                    .metadata()
                    .map(|metadata| {
                        metadata.is_file() && metadata.len() >= WORKBENCH_BUNDLE_MIN_SIZE
                    })
                    .unwrap_or(false)
            {
                targets.insert(format!("out/vs/workbench/{name}"));
            }
        }
    }

    if targets.is_empty() {
        CompatibilityDetails {
            compatible: false,
            message: format!(
                "Cursor {version} 未发现可补丁工作台入口, 资源结构可能已变化, 已停止自动适配"
            ),
        }
    } else {
        CompatibilityDetails {
            compatible: true,
            message: format!(
                "已按资源结构自动适配 Cursor {version}, 识别 {} 个入口包, 安装前仍会执行完整语法预检",
                targets.len()
            ),
        }
    }
}

pub fn run(request: &ActionRequest, sink: ProgressSink) -> Result<OperationResult, String> {
    if !matches!(request.locale.as_str(), "zh-cn" | "zh-tw") {
        return Err(format!("Cursor 不支持目标语言: {}", request.locale));
    }
    let command = match request.action.as_str() {
        "preview" => "check",
        "backup" => "backup",
        "install" => "install",
        "restore" => "restore",
        other => return Err(format!("Cursor 不支持操作: {other}")),
    };
    let root = engine_root().ok_or_else(|| "未找到 cursor-i18n-zh 引擎目录".to_string())?;
    let node = node_version().ok_or_else(|| "未找到 Node.js 18 或更高版本".to_string())?;
    if request.action == "restore" {
        let current_version = cursor_app_dir()
            .as_deref()
            .and_then(read_version)
            .ok_or_else(|| "无法读取当前 Cursor 版本, 已停止恢复".to_string())?;
        if let Some(selected_version) = request
            .backup_version
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if selected_version != current_version {
                return Err(format!(
                    "备份版本 {selected_version} 与当前 Cursor {current_version} 不匹配, 已拒绝恢复"
                ));
            }
        }
    }
    sink.emit(8, "INFO", format!("Cursor 引擎已就绪, Node.js {node}."));

    if request.action == "install" {
        sink.emit(12, "INFO", "正在执行安装前备份完整性门禁.");
        require_install_backup(&root, &request.locale)?;
        sink.emit(16, "INFO", "当前版本备份已通过完整性门禁.");
    }

    let cli = root.join("src").join("cli.js");
    let mut child = hidden_command("node")
        .arg(cli)
        .arg(command)
        .args(["--locale", &request.locale])
        .current_dir(&root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 Cursor 汉化引擎: {error}"))?;

    let (sender, receiver) = mpsc::channel::<(&'static str, String)>();
    if let Some(stdout) = child.stdout.take() {
        let sender = sender.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = sender.send(("INFO", line));
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let sender = sender.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = sender.send(("WARN", line));
            }
        });
    }
    drop(sender);

    let mut progress = 15u8;
    let mut tail = Vec::new();
    for (level, line) in receiver {
        progress = progress.saturating_add(5).min(92);
        sink.emit(progress, level, &line);
        tail.push(line);
        if tail.len() > 8 {
            tail.remove(0);
        }
    }
    let status = child
        .wait()
        .map_err(|error| format!("等待 Cursor 汉化引擎失败: {error}"))?;
    if !status.success() {
        return Err(format!(
            "Cursor 操作失败, exit {:?}: {}",
            status.code(),
            tail.join("; ")
        ));
    }

    sink.emit(100, "DONE", "Cursor 操作已完成.");
    let title = match request.action.as_str() {
        "preview" => "Cursor 预检通过",
        "backup" => "Cursor 备份已校验",
        "install" => "Cursor 汉化完成",
        _ => "Cursor 已恢复原版",
    };
    let backup_path = if matches!(request.action.as_str(), "backup" | "install") {
        cursor_app_dir()
            .as_deref()
            .and_then(read_version)
            .map(|version| {
                root.join("backup")
                    .join(version)
                    .to_string_lossy()
                    .into_owned()
            })
    } else {
        None
    };
    Ok(OperationResult {
        app_id: "cursor".to_string(),
        action: request.action.clone(),
        title: title.to_string(),
        message: tail.last().cloned().unwrap_or_else(|| title.to_string()),
        files_changed: 0,
        replacements: 0,
        backup_path,
    })
}

pub fn list_backups() -> Vec<BackupRecord> {
    let Some(root) = engine_root() else {
        return Vec::new();
    };
    let backup_root = root.join("backup");
    let current_version = cursor_app_dir().as_deref().and_then(read_version);
    let Ok(entries) = fs::read_dir(&backup_root) else {
        return Vec::new();
    };
    let mut records = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .map(|entry| cursor_backup_record(&entry.path(), current_version.as_deref()))
        .collect::<Vec<_>>();
    records.sort_by(|left, right| right.version.cmp(&left.version));
    records
}

fn cursor_backup_record(path: &Path, current_version: Option<&str>) -> BackupRecord {
    let directory_version = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "未知".to_string());
    let mut version = directory_version.clone();
    let mut created_at_iso = None;
    let mut files = 0usize;
    let validation = (|| {
        let raw = fs::read_to_string(path.join("meta.json"))
            .map_err(|error| format!("备份元数据不可读: {error}"))?;
        let meta: Value =
            serde_json::from_str(&raw).map_err(|error| format!("备份元数据格式错误: {error}"))?;
        version = meta
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or(&directory_version)
            .to_string();
        created_at_iso = meta
            .get("createdAt")
            .and_then(Value::as_str)
            .map(str::to_string);
        if version != directory_version {
            return Err("备份目录版本与元数据不一致".to_string());
        }
        let manifest_files = meta
            .get("files")
            .and_then(Value::as_object)
            .ok_or_else(|| "备份元数据缺少文件清单".to_string())?;
        files = manifest_files.len();
        if files == 0 {
            return Err("备份文件清单为空".to_string());
        }
        for (relative, expected) in manifest_files {
            let relative_path = Path::new(relative);
            if relative_path.is_absolute()
                || relative_path
                    .components()
                    .any(|part| !matches!(part, Component::Normal(_)))
            {
                return Err(format!("备份文件路径不安全: {relative}"));
            }
            let source = path.join("files").join(relative_path);
            let expected_size = expected
                .get("size")
                .and_then(Value::as_u64)
                .ok_or_else(|| format!("备份文件缺少大小记录: {relative}"))?;
            let expected_hash = expected
                .get("sha256")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("备份文件缺少哈希记录: {relative}"))?;
            let actual_size = fs::metadata(&source)
                .map_err(|error| format!("备份文件不可读 {relative}: {error}"))?
                .len();
            if actual_size != expected_size {
                return Err(format!("备份文件大小不匹配: {relative}"));
            }
            if sha256_file_base64(&source)? != expected_hash {
                return Err(format!("备份文件 SHA256 不匹配: {relative}"));
            }
        }
        Ok(())
    })();
    let valid = validation.is_ok();
    let current = current_version == Some(version.as_str());
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
        id: format!("cursor:{directory_version}"),
        app_id: "cursor".to_string(),
        app_name: "Cursor".to_string(),
        version,
        created_at_iso,
        created_at_unix: None,
        path: path.to_string_lossy().into_owned(),
        files,
        valid,
        current,
        can_restore,
        status,
        detail,
    }
}

fn sha256_file_base64(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("读取备份文件失败 {}: {error}", path.display()))?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("读取备份文件失败 {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(STANDARD.encode(hash.finalize()))
}

fn inspect_backup(root: &Path, version: &str) -> BackupDetails {
    let path = root.join("backup").join(version);
    let display_path = Some(path.to_string_lossy().into_owned());
    let files = backup_file_count(&path);
    if !path.is_dir() {
        return BackupDetails {
            available: false,
            path: display_path,
            files: 0,
            message: "未创建当前 Cursor 版本的原始备份".to_string(),
        };
    }

    match run_cli_quiet(root, "backup-check", "zh-cn") {
        Ok(message) => BackupDetails {
            available: true,
            path: display_path,
            files,
            message: if message.is_empty() {
                "备份身份, 版本, commit, 文件大小和 SHA256 校验通过".to_string()
            } else {
                message
            },
        },
        Err(error) => BackupDetails {
            available: false,
            path: display_path,
            files,
            message: format!("备份校验失败: {error}"),
        },
    }
}

fn backup_file_count(path: &Path) -> usize {
    fs::read_to_string(path.join("meta.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|meta| {
            meta.get("files")
                .and_then(Value::as_object)
                .map(|files| files.len())
        })
        .unwrap_or(0)
}

fn require_install_backup(root: &Path, locale: &str) -> Result<(), String> {
    run_cli_quiet(root, "backup-check", locale)
        .map(|_| ())
        .map_err(|error| {
            format!(
                "安装已停止: 当前 Cursor 版本的备份未通过完整校验. 请先前往备份选项卡创建并校验备份. 详情: {error}"
            )
        })
}

fn run_cli_quiet(root: &Path, command: &str, locale: &str) -> Result<String, String> {
    let output = hidden_command("node")
        .arg(root.join("src").join("cli.js"))
        .arg(command)
        .args(["--locale", locale])
        .current_dir(root)
        .output()
        .map_err(|error| format!("无法启动 Cursor 汉化引擎: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("; ");
    if output.status.success() {
        Ok(detail)
    } else if detail.is_empty() {
        Err(format!("backup-check 退出码 {:?}", output.status.code()))
    } else {
        Err(detail)
    }
}

pub fn engine_root() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CURSOR_I18N_ROOT").map(PathBuf::from) {
        if is_engine_root(&path) {
            return Some(path);
        }
    }

    let mut starts = Vec::new();
    if let Ok(path) = std::env::current_exe() {
        starts.push(path);
    }
    if let Ok(path) = std::env::current_dir() {
        starts.push(path);
    }
    for start in starts {
        for ancestor in start.ancestors() {
            if is_engine_root(ancestor) {
                return Some(ancestor.to_path_buf());
            }
        }
    }
    None
}

pub fn node_version() -> Option<String> {
    let status = node_runtime_status();
    if status.compatible {
        status.version
    } else {
        None
    }
}

pub fn node_runtime_status() -> NodeRuntimeStatus {
    let executable = node_executable_path();
    let Ok(output) = hidden_command("node").arg("--version").output() else {
        return NodeRuntimeStatus {
            installed: false,
            compatible: false,
            version: None,
            executable,
            required_version: ">=18",
            message: "未检测到 Node.js. Cursor 汉化需要 Node.js 18 或更高版本".to_string(),
        };
    };
    if !output.status.success() {
        return NodeRuntimeStatus {
            installed: false,
            compatible: false,
            version: None,
            executable,
            required_version: ">=18",
            message: "Node.js 命令无法正常运行. Cursor 汉化需要 Node.js 18 或更高版本".to_string(),
        };
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let parsed = parse_node_version(&raw);
    let Some((version, major)) = parsed else {
        return NodeRuntimeStatus {
            installed: true,
            compatible: false,
            version: None,
            executable,
            required_version: ">=18",
            message: "已检测到 Node.js, 但无法识别版本. Cursor 汉化需要 Node.js 18 或更高版本"
                .to_string(),
        };
    };
    let compatible = major >= MIN_NODE_MAJOR;
    NodeRuntimeStatus {
        installed: true,
        compatible,
        version: Some(version.clone()),
        executable,
        required_version: ">=18",
        message: if compatible {
            format!("Node.js {version} 已就绪, 可以使用 Cursor 汉化功能")
        } else {
            format!("Node.js {version} 版本过低, 请升级到 18 或更高版本")
        },
    }
}

fn parse_node_version(raw: &str) -> Option<(String, u32)> {
    let version = raw.trim().trim_start_matches('v').to_string();
    let major = version.split('.').next()?.parse::<u32>().ok()?;
    Some((version, major))
}

fn node_executable_path() -> Option<String> {
    let output = hidden_command("where.exe").arg("node").output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn is_engine_root(path: &Path) -> bool {
    path.join("src").join("cli.js").is_file()
        && path.join("dict").is_dir()
        && path.join("package.json").is_file()
}

fn cursor_app_dir() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CURSOR_APP_DIR").map(PathBuf::from) {
        if is_cursor_app_dir(&path) {
            return Some(path);
        }
    }

    if let Some(exe) = std::env::var_os("CURSOR_EXE").map(PathBuf::from) {
        if let Some(path) = app_dir_from_exe(&exe) {
            return Some(path);
        }
    }

    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let program = std::env::var_os("ProgramFiles").map(PathBuf::from);
    let program_x86 = std::env::var_os("ProgramFiles(x86)").map(PathBuf::from);
    [
        local.map(|path| path.join("Programs/Cursor/resources/app")),
        program.map(|path| path.join("Cursor/resources/app")),
        program_x86.map(|path| path.join("Cursor/resources/app")),
    ]
    .into_iter()
    .flatten()
    .find(|path| is_cursor_app_dir(path))
}

fn app_dir_from_exe(exe: &Path) -> Option<PathBuf> {
    let path = exe.parent()?.join("resources").join("app");
    is_cursor_app_dir(&path).then_some(path)
}

fn is_cursor_app_dir(path: &Path) -> bool {
    path.join("product.json").is_file() && path.join("out").is_dir()
}

fn read_version(app_dir: &Path) -> Option<String> {
    let raw = fs::read_to_string(app_dir.join("product.json")).ok()?;
    let product: Value = serde_json::from_str(&raw).ok()?;
    product.get("version")?.as_str().map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sandbox() -> PathBuf {
        std::env::temp_dir().join(format!(
            "i18n-workbench-cursor-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    fn write_backup(path: &Path, version: &str) {
        let relative = "out/test.js";
        let source = path.join("files").join(relative);
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, b"console.log('original');\n").unwrap();
        let size = fs::metadata(&source).unwrap().len();
        let sha256 = sha256_file_base64(&source).unwrap();
        let meta = serde_json::json!({
            "version": version,
            "commit": "test-commit",
            "createdAt": "2026-07-15T12:00:00.000Z",
            "files": {
                (relative): { "size": size, "sha256": sha256 }
            }
        });
        fs::write(
            path.join("meta.json"),
            serde_json::to_vec_pretty(&meta).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn backup_record_validates_sha256_and_current_version() {
        let root = sandbox();
        let backup = root.join("3.11.19");
        write_backup(&backup, "3.11.19");

        let record = cursor_backup_record(&backup, Some("3.11.19"));
        assert!(record.valid);
        assert!(record.current);
        assert!(record.can_restore);
        assert_eq!(record.files, 1);
        assert_eq!(
            record.created_at_iso.as_deref(),
            Some("2026-07-15T12:00:00.000Z")
        );

        fs::write(backup.join("files/out/test.js"), b"damaged").unwrap();
        let damaged = cursor_backup_record(&backup, Some("3.11.19"));
        assert!(!damaged.valid);
        assert!(!damaged.can_restore);
        assert_eq!(damaged.status, "校验失败");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn backup_record_rejects_restore_to_different_version() {
        let root = sandbox();
        let backup = root.join("3.10.0");
        write_backup(&backup, "3.10.0");

        let record = cursor_backup_record(&backup, Some("3.11.19"));
        assert!(record.valid);
        assert!(!record.current);
        assert!(!record.can_restore);
        assert_eq!(record.status, "历史备份");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn detects_unknown_future_workbench_bundle_by_structure() {
        let root = sandbox();
        let workbench = root.join("out/vs/workbench");
        fs::create_dir_all(&workbench).unwrap();
        fs::write(
            workbench.join("workbench.future-shell.main.js"),
            vec![b'x'; WORKBENCH_BUNDLE_MIN_SIZE as usize + 1],
        )
        .unwrap();

        let compatibility = inspect_compatibility(Some(&root), Some("99.0.0"));
        assert!(compatibility.compatible);
        assert!(compatibility.message.contains("自动适配 Cursor 99.0.0"));

        fs::remove_file(workbench.join("workbench.future-shell.main.js")).unwrap();
        let incompatible = inspect_compatibility(Some(&root), Some("99.0.0"));
        assert!(!incompatible.compatible);
        assert!(incompatible.message.contains("已停止自动适配"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn parses_supported_node_versions() {
        assert_eq!(
            parse_node_version("v24.18.0\r\n"),
            Some(("24.18.0".to_string(), 24))
        );
        assert_eq!(
            parse_node_version("18.20.8"),
            Some(("18.20.8".to_string(), 18))
        );
    }

    #[test]
    fn rejects_unrecognizable_node_versions() {
        assert_eq!(parse_node_version("node-current"), None);
        assert_eq!(parse_node_version(""), None);
    }
}
