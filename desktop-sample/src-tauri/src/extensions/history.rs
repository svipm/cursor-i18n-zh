use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static HISTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const MAX_HISTORY_RECORDS: usize = 100;

#[derive(Clone, Debug)]
pub(super) struct ManagedPath {
    pub key: String,
    pub path: PathBuf,
}

#[derive(Clone, Debug)]
pub(super) struct HistoryContext {
    pub base_root: PathBuf,
    pub target: String,
    pub target_label: String,
    pub scope: String,
    pub workspace: Option<String>,
    pub managed: Vec<ManagedPath>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryChange {
    pub path: String,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionHistoryRecord {
    pub id: String,
    pub created_at_unix: u64,
    pub target: String,
    pub target_label: String,
    pub scope: String,
    pub workspace: Option<String>,
    pub action: String,
    pub summary: String,
    pub changes: Vec<HistoryChange>,
    pub can_restore: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct HistoryMetadata {
    #[serde(flatten)]
    record: ExtensionHistoryRecord,
    before_manifest: BTreeMap<String, String>,
    #[serde(default)]
    after_manifest: BTreeMap<String, String>,
}

pub(super) struct HistoryTransaction {
    root: PathBuf,
    metadata: HistoryMetadata,
}

pub(super) fn begin(
    context: &HistoryContext,
    action: &str,
    summary: &str,
) -> Result<HistoryTransaction, String> {
    let created_at_unix = now_unix();
    let id = format!(
        "{}-{}-{}",
        created_at_unix,
        now_nanos(),
        HISTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let root = context_root(context).join(&id);
    let before = root.join("before");
    fs::create_dir_all(&before)
        .map_err(|error| format!("无法创建扩展历史目录 {}: {error}", before.display()))?;
    let snapshot = (|| {
        for managed in &context.managed {
            if managed.path.exists() {
                copy_entry(&managed.path, &before.join(&managed.key))?;
            }
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = snapshot {
        let _ = fs::remove_dir_all(&root);
        return Err(format!("创建完整扩展快照失败, 已取消修改: {error}"));
    }
    let metadata = HistoryMetadata {
        record: ExtensionHistoryRecord {
            id,
            created_at_unix,
            target: context.target.clone(),
            target_label: context.target_label.clone(),
            scope: context.scope.clone(),
            workspace: context.workspace.clone(),
            action: action.to_string(),
            summary: summary.to_string(),
            changes: Vec::new(),
            can_restore: true,
        },
        before_manifest: manifest_for_snapshot(&before)?,
        after_manifest: BTreeMap::new(),
    };
    write_metadata(&root, &metadata)?;
    Ok(HistoryTransaction { root, metadata })
}

pub(super) fn finish(
    context: &HistoryContext,
    transaction: &mut HistoryTransaction,
) -> Result<ExtensionHistoryRecord, String> {
    transaction.metadata.after_manifest = manifest_for_live(context)?;
    transaction.metadata.record.changes = compare_manifests(
        &transaction.metadata.before_manifest,
        &transaction.metadata.after_manifest,
    );
    write_metadata(&transaction.root, &transaction.metadata)?;
    prune(context)?;
    Ok(transaction.metadata.record.clone())
}

pub(super) fn discard(transaction: HistoryTransaction) {
    let _ = fs::remove_dir_all(transaction.root);
}

pub(super) fn rollback(
    context: &HistoryContext,
    transaction: &HistoryTransaction,
) -> Result<(), String> {
    restore_snapshot(context, &transaction.root)
}

pub(super) fn list(context: &HistoryContext) -> Result<Vec<ExtensionHistoryRecord>, String> {
    let root = context_root(context);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut records = Vec::new();
    for entry in fs::read_dir(&root)
        .map_err(|error| format!("无法读取扩展历史目录 {}: {error}", root.display()))?
        .flatten()
    {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Ok(metadata) = read_metadata(&path) {
            records.push(metadata.record);
        }
    }
    records.sort_by(|left, right| {
        right
            .created_at_unix
            .cmp(&left.created_at_unix)
            .then_with(|| right.id.cmp(&left.id))
    });
    Ok(records)
}

pub(super) fn restore(
    context: &HistoryContext,
    id: &str,
) -> Result<ExtensionHistoryRecord, String> {
    validate_history_id(id)?;
    let target_root = context_root(context).join(id);
    let target_metadata = read_metadata(&target_root)?;
    let mut rollback = begin(
        context,
        "restore",
        &format!("恢复历史记录 {}", target_metadata.record.summary),
    )?;
    if let Err(error) = restore_snapshot(context, &target_root) {
        let rollback_result = restore_snapshot(context, &rollback.root);
        discard(rollback);
        return Err(match rollback_result {
            Ok(()) => format!("恢复扩展历史失败, 当前配置已回滚: {error}"),
            Err(rollback_error) => {
                format!("恢复扩展历史失败, 且回滚当前配置失败: {error}; {rollback_error}")
            }
        });
    }
    finish(context, &mut rollback)
}

fn restore_snapshot(context: &HistoryContext, record_root: &Path) -> Result<(), String> {
    let before = record_root.join("before");
    if !before.is_dir() {
        return Err(format!("扩展历史缺少快照目录: {}", before.display()));
    }
    for managed in &context.managed {
        remove_entry(&managed.path)?;
        let source = before.join(&managed.key);
        if source.exists() {
            copy_entry(&source, &managed.path)?;
        }
    }
    Ok(())
}

fn context_root(context: &HistoryContext) -> PathBuf {
    let identity = format!(
        "{}|{}|{}",
        context.target,
        context.scope,
        context.workspace.as_deref().unwrap_or("")
    );
    let digest = Sha256::digest(identity.as_bytes());
    context
        .base_root
        .join(format!("{}-{}", context.target, &hex_digest(&digest)[..16]))
}

fn manifest_for_live(context: &HistoryContext) -> Result<BTreeMap<String, String>, String> {
    let mut result = BTreeMap::new();
    for managed in &context.managed {
        if managed.path.exists() {
            collect_manifest(&managed.path, Path::new(&managed.key), &mut result)?;
        }
    }
    Ok(result)
}

fn manifest_for_snapshot(root: &Path) -> Result<BTreeMap<String, String>, String> {
    let mut result = BTreeMap::new();
    if root.exists() {
        for entry in fs::read_dir(root)
            .map_err(|error| format!("无法读取扩展快照 {}: {error}", root.display()))?
        {
            let entry = entry.map_err(|error| format!("无法读取扩展快照目录项: {error}"))?;
            collect_manifest(&entry.path(), Path::new(&entry.file_name()), &mut result)?;
        }
    }
    Ok(result)
}

fn collect_manifest(
    path: &Path,
    logical: &Path,
    result: &mut BTreeMap<String, String>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("无法读取扩展文件信息 {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("扩展快照拒绝符号链接: {}", path.display()));
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path)
            .map_err(|error| format!("无法读取扩展目录 {}: {error}", path.display()))?
        {
            let entry = entry.map_err(|error| format!("无法读取扩展目录项: {error}"))?;
            collect_manifest(&entry.path(), &logical.join(entry.file_name()), result)?;
        }
    } else if metadata.is_file() {
        result.insert(
            logical.to_string_lossy().replace('\\', "/"),
            hash_file(path)?,
        );
    }
    Ok(())
}

fn compare_manifests(
    before: &BTreeMap<String, String>,
    after: &BTreeMap<String, String>,
) -> Vec<HistoryChange> {
    let paths = before
        .keys()
        .chain(after.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    paths
        .into_iter()
        .filter_map(|path| match (before.get(&path), after.get(&path)) {
            (None, Some(_)) => Some(HistoryChange {
                path,
                kind: "added".to_string(),
            }),
            (Some(_), None) => Some(HistoryChange {
                path,
                kind: "deleted".to_string(),
            }),
            (Some(left), Some(right)) if left != right => Some(HistoryChange {
                path,
                kind: "modified".to_string(),
            }),
            _ => None,
        })
        .collect()
}

fn copy_entry(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("无法读取扩展快照源 {}: {error}", source.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("扩展快照拒绝符号链接: {}", source.display()));
    }
    if metadata.is_dir() {
        fs::create_dir_all(destination)
            .map_err(|error| format!("无法创建扩展快照目录 {}: {error}", destination.display()))?;
        for entry in fs::read_dir(source)
            .map_err(|error| format!("无法读取扩展目录 {}: {error}", source.display()))?
        {
            let entry = entry.map_err(|error| format!("无法读取扩展目录项: {error}"))?;
            copy_entry(&entry.path(), &destination.join(entry.file_name()))?;
        }
    } else if metadata.is_file() {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建扩展快照父目录 {}: {error}", parent.display()))?;
        }
        fs::copy(source, destination).map_err(|error| {
            format!(
                "无法复制扩展快照 {} 到 {}: {error}",
                source.display(),
                destination.display()
            )
        })?;
    }
    Ok(())
}

fn remove_entry(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("无法读取待恢复扩展路径 {}: {error}", path.display()))?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("无法清理扩展目录 {}: {error}", path.display()))
    } else {
        fs::remove_file(path)
            .map_err(|error| format!("无法清理扩展文件 {}: {error}", path.display()))
    }
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("无法读取扩展文件 {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("无法校验扩展文件 {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex_digest(&hasher.finalize()))
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn write_metadata(root: &Path, metadata: &HistoryMetadata) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(metadata)
        .map_err(|error| format!("无法生成扩展历史元数据: {error}"))?;
    let path = root.join("metadata.json");
    let temp = root.join(".metadata.json.tmp");
    fs::write(&temp, data)
        .map_err(|error| format!("无法写入扩展历史元数据 {}: {error}", temp.display()))?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("无法替换扩展历史元数据 {}: {error}", path.display()))?;
    }
    fs::rename(&temp, &path)
        .map_err(|error| format!("无法提交扩展历史元数据 {}: {error}", path.display()))
}

fn read_metadata(root: &Path) -> Result<HistoryMetadata, String> {
    let path = root.join("metadata.json");
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取扩展历史元数据 {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("扩展历史元数据无效 {}: {error}", path.display()))
}

fn validate_history_id(id: &str) -> Result<(), String> {
    if !id.is_empty()
        && id.len() <= 100
        && id.bytes().all(|byte| byte.is_ascii_digit() || byte == b'-')
    {
        Ok(())
    } else {
        Err("扩展历史记录 ID 无效".to_string())
    }
}

fn prune(context: &HistoryContext) -> Result<(), String> {
    let mut records = list(context)?;
    if records.len() <= MAX_HISTORY_RECORDS {
        return Ok(());
    }
    for record in records.drain(MAX_HISTORY_RECORDS..) {
        let _ = fs::remove_dir_all(context_root(context).join(record.id));
    }
    Ok(())
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn now_nanos() -> u128 {
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
            "i18n-workbench-history-test-{}-{}",
            std::process::id(),
            now_nanos()
        ))
    }

    #[test]
    fn records_changes_and_restores_a_complete_snapshot() {
        let root = sandbox();
        let managed_root = root.join("managed");
        let config = managed_root.join("mcp.json");
        let skill = managed_root.join("skills/demo/SKILL.md");
        fs::create_dir_all(skill.parent().unwrap()).unwrap();
        fs::write(&config, "before").unwrap();
        fs::write(&skill, "skill-before").unwrap();
        let context = HistoryContext {
            base_root: root.join("history"),
            target: "cursor".to_string(),
            target_label: "Cursor".to_string(),
            scope: "user".to_string(),
            workspace: None,
            managed: vec![
                ManagedPath {
                    key: "mcp.json".to_string(),
                    path: config.clone(),
                },
                ManagedPath {
                    key: "skills".to_string(),
                    path: managed_root.join("skills"),
                },
            ],
        };

        let mut transaction = begin(&context, "save-mcp", "保存 MCP demo").unwrap();
        fs::write(&config, "after").unwrap();
        fs::remove_dir_all(managed_root.join("skills")).unwrap();
        let record = finish(&context, &mut transaction).unwrap();
        assert!(record
            .changes
            .iter()
            .any(|change| change.path == "mcp.json" && change.kind == "modified"));
        assert!(record
            .changes
            .iter()
            .any(|change| change.path.ends_with("SKILL.md") && change.kind == "deleted"));

        restore(&context, &record.id).unwrap();
        assert_eq!(fs::read_to_string(&config).unwrap(), "before");
        assert_eq!(fs::read_to_string(&skill).unwrap(), "skill-before");
        assert_eq!(list(&context).unwrap().len(), 2);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_to_snapshot_symbolic_links() {
        #[cfg(unix)]
        {
            let root = sandbox();
            fs::create_dir_all(root.join("managed")).unwrap();
            fs::write(root.join("outside"), "secret").unwrap();
            std::os::unix::fs::symlink(root.join("outside"), root.join("managed/link")).unwrap();
            let context = HistoryContext {
                base_root: root.join("history"),
                target: "cursor".to_string(),
                target_label: "Cursor".to_string(),
                scope: "user".to_string(),
                workspace: None,
                managed: vec![ManagedPath {
                    key: "skills".to_string(),
                    path: root.join("managed"),
                }],
            };
            assert!(begin(&context, "save", "save").is_err());
            let _ = fs::remove_dir_all(root);
        }
    }
}
