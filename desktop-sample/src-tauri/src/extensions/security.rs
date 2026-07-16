use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_AUDIT_FILES: usize = 512;
const MAX_AUDIT_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillAudit {
    pub risk_level: String,
    pub risk_score: u8,
    pub findings: Vec<String>,
    pub missing_references: Vec<String>,
    pub file_count: usize,
    pub total_bytes: u64,
    pub sha256: String,
    pub frontmatter_valid: bool,
    pub has_scripts: bool,
    pub has_network_access: bool,
    pub has_shell_commands: bool,
    pub trusted_source: bool,
}

pub(super) fn audit_skill(
    root: &Path,
    skill_content: &str,
    repository: Option<&str>,
    revision: Option<&str>,
) -> SkillAudit {
    let mut findings = Vec::new();
    let frontmatter_valid = valid_frontmatter(skill_content);
    if !frontmatter_valid {
        findings.push("SKILL.md 缺少有效的 name 和 description frontmatter".to_string());
    }
    let missing_references = missing_markdown_references(root, skill_content);
    if !missing_references.is_empty() {
        findings.push(format!(
            "发现 {} 个缺失的本地引用文件",
            missing_references.len()
        ));
    }

    let mut files = Vec::new();
    let mut scan_findings = Vec::new();
    if let Err(error) = collect_files(root, root, &mut files, &mut scan_findings) {
        scan_findings.push(error);
    }
    findings.extend(scan_findings);
    let file_count = files.len();
    let total_bytes = files
        .iter()
        .filter_map(|path| fs::metadata(path).ok().map(|metadata| metadata.len()))
        .sum::<u64>();
    if file_count > MAX_AUDIT_FILES {
        findings.push(format!("Skill 文件数量超过安全审计上限 {MAX_AUDIT_FILES}"));
    }
    if total_bytes > MAX_AUDIT_BYTES {
        findings.push("Skill 总大小超过 32 MB".to_string());
    }

    let has_scripts = files.iter().any(|path| is_script(path));
    let mut has_network_access = false;
    let mut has_shell_commands = false;
    for path in &files {
        if let Ok(text) = read_text_limited(path) {
            let lower = text.to_ascii_lowercase();
            has_network_access |= [
                "http://",
                "https://",
                "curl ",
                "wget ",
                "invoke-webrequest",
                "webfetch",
                "fetch(",
                "requests.",
            ]
            .iter()
            .any(|pattern| lower.contains(pattern));
            has_shell_commands |= [
                "powershell",
                "cmd.exe",
                "bash ",
                "sh ",
                "sudo ",
                "rm -",
                "del /",
                "start-process",
                "child_process",
                "subprocess.",
                "os.system",
            ]
            .iter()
            .any(|pattern| lower.contains(pattern));
        }
    }
    if has_scripts {
        findings.push("包含可执行脚本或二进制文件, 安装前应审查内容".to_string());
    }
    if has_network_access {
        findings.push("内容包含网络访问能力或外部 URL".to_string());
    }
    if has_shell_commands {
        findings.push("内容包含 Shell 或外部进程调用".to_string());
    }
    let trusted_source = repository.is_some_and(|value| value.starts_with("https://github.com/"))
        && revision.is_some_and(|value| {
            value.len() >= 7 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        });
    if !trusted_source {
        findings.push("没有可验证的 GitHub 固定提交来源".to_string());
    }

    let mut risk_score = 0u8;
    if !frontmatter_valid {
        risk_score = risk_score.saturating_add(40);
    }
    risk_score = risk_score.saturating_add((missing_references.len().min(2) as u8) * 15);
    if has_scripts {
        risk_score = risk_score.saturating_add(15);
    }
    if has_network_access {
        risk_score = risk_score.saturating_add(20);
    }
    if has_shell_commands {
        risk_score = risk_score.saturating_add(20);
    }
    if !trusted_source {
        risk_score = risk_score.saturating_add(10);
    }
    if file_count > MAX_AUDIT_FILES || total_bytes > MAX_AUDIT_BYTES {
        risk_score = risk_score.saturating_add(30);
    }
    let risk_level = if !frontmatter_valid {
        "invalid"
    } else if risk_score >= 50 {
        "high"
    } else if risk_score >= 20 {
        "medium"
    } else {
        "low"
    }
    .to_string();

    SkillAudit {
        risk_level,
        risk_score,
        findings,
        missing_references,
        file_count,
        total_bytes,
        sha256: hash_directory(root, &files).unwrap_or_default(),
        frontmatter_valid,
        has_scripts,
        has_network_access,
        has_shell_commands,
        trusted_source,
    }
}

fn valid_frontmatter(content: &str) -> bool {
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return false;
    }
    let mut name = false;
    let mut description = false;
    let mut closed = false;
    for line in lines {
        let line = line.trim();
        if line == "---" {
            closed = true;
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            let value = value.trim().trim_matches(['"', '\'']);
            if key.trim() == "name" && !value.is_empty() {
                name = true;
            }
            if key.trim() == "description" && !value.is_empty() {
                description = true;
            }
        }
    }
    closed && name && description
}

fn missing_markdown_references(root: &Path, content: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut offset = 0usize;
    while let Some(start) = content[offset..].find("](") {
        let value_start = offset + start + 2;
        let Some(end) = content[value_start..].find(')') else {
            break;
        };
        let raw = content[value_start..value_start + end]
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_matches(['<', '>', '"', '\'']);
        offset = value_start + end + 1;
        if raw.is_empty()
            || raw.starts_with('#')
            || raw.starts_with("http://")
            || raw.starts_with("https://")
            || raw.starts_with("mailto:")
        {
            continue;
        }
        let relative = Path::new(raw);
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            result.push(raw.to_string());
            continue;
        }
        if !root.join(relative).exists() && !result.iter().any(|value| value == raw) {
            result.push(raw.to_string());
        }
    }
    result
}

fn collect_files(
    root: &Path,
    current: &Path,
    result: &mut Vec<PathBuf>,
    findings: &mut Vec<String>,
) -> Result<(), String> {
    if result.len() > MAX_AUDIT_FILES {
        return Ok(());
    }
    for entry in fs::read_dir(current)
        .map_err(|error| format!("无法扫描 Skill 目录 {}: {error}", current.display()))?
    {
        let entry = entry.map_err(|error| format!("无法读取 Skill 目录项: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("无法读取 Skill 文件信息 {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            let relative = path.strip_prefix(root).unwrap_or(&path).display();
            findings.push(format!("包含符号链接, 已拒绝跟随: {relative}"));
        } else if metadata.is_dir() {
            collect_files(root, &path, result, findings)?;
        } else if metadata.is_file() {
            result.push(path);
        }
    }
    Ok(())
}

fn is_script(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "sh" | "bash"
            | "zsh"
            | "fish"
            | "ps1"
            | "cmd"
            | "bat"
            | "js"
            | "mjs"
            | "cjs"
            | "ts"
            | "py"
            | "rb"
            | "pl"
            | "exe"
            | "dll"
            | "so"
            | "dylib"
    )
}

fn read_text_limited(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > 1024 * 1024 {
        return Err("文件过大".to_string());
    }
    fs::read_to_string(path).map_err(|error| error.to_string())
}

fn hash_directory(root: &Path, files: &[PathBuf]) -> Result<String, String> {
    let mut sorted = files.to_vec();
    sorted.sort();
    let mut hasher = Sha256::new();
    for path in sorted {
        let relative = path
            .strip_prefix(root)
            .map_err(|error| format!("Skill 文件越出根目录: {error}"))?;
        hasher.update(relative.to_string_lossy().replace('\\', "/").as_bytes());
        hasher.update([0]);
        let mut file = fs::File::open(&path)
            .map_err(|error| format!("无法读取 Skill 文件 {}: {error}", path.display()))?;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| format!("无法校验 Skill 文件 {}: {error}", path.display()))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        hasher.update([0xff]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sandbox() -> PathBuf {
        std::env::temp_dir().join(format!(
            "i18n-workbench-skill-audit-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn reports_scripts_network_shell_and_missing_references() {
        let root = sandbox();
        fs::create_dir_all(root.join("scripts")).unwrap();
        let content = "---\nname: demo\ndescription: Demo\n---\n[missing](references/missing.md)\n";
        fs::write(root.join("SKILL.md"), content).unwrap();
        fs::write(
            root.join("scripts/run.ps1"),
            "Invoke-WebRequest https://example.com; Start-Process cmd.exe",
        )
        .unwrap();
        let audit = audit_skill(&root, content, None, None);
        assert_eq!(audit.risk_level, "high");
        assert!(audit.has_scripts);
        assert!(audit.has_network_access);
        assert!(audit.has_shell_commands);
        assert_eq!(audit.missing_references, vec!["references/missing.md"]);
        assert_eq!(audit.sha256.len(), 64);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn accepts_a_pinned_document_only_skill() {
        let root = sandbox();
        let content = "---\nname: demo\ndescription: Demo\n---\n# Safe\n";
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("SKILL.md"), content).unwrap();
        let audit = audit_skill(
            &root,
            content,
            Some("https://github.com/example/demo"),
            Some("0123456789abcdef"),
        );
        assert_eq!(audit.risk_level, "low");
        assert!(audit.trusted_source);
        let _ = fs::remove_dir_all(root);
    }
}
