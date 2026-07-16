use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use zeroize::{Zeroize, Zeroizing};

const MAX_BUNDLE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ENCRYPTED_BUNDLE_BYTES: u64 = 96 * 1024 * 1024;
const MAX_BUNDLE_FILES: usize = 1024;
const MAX_BUNDLE_FILE_BYTES: u64 = 8 * 1024 * 1024;
const ENCRYPTED_FORMAT: &str = "i18n-workbench-encrypted-bundle";
const ENCRYPTED_AAD: &[u8] = b"i18n-workbench-extension-bundle-v1";
const KDF_MEMORY_KIB: u32 = 19 * 1024;
const KDF_ITERATIONS: u32 = 2;
const KDF_PARALLELISM: u32 = 1;
const MIN_PASSWORD_BYTES: usize = 10;
const MAX_PASSWORD_BYTES: usize = 256;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedBundleEnvelope {
    schema_version: u32,
    format: String,
    kdf: EncryptedKdf,
    cipher: EncryptedCipher,
    ciphertext_base64: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedKdf {
    name: String,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
    salt_base64: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedCipher {
    name: String,
    nonce_base64: String,
}

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
    pub encrypted: bool,
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
    if bundle.includes_secrets {
        return Err("包含密钥的配置包必须使用密码加密导出".to_string());
    }
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("json"))
    {
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

pub(super) fn write_encrypted_bundle(
    path: &Path,
    bundle: &ExtensionBundle,
    password: &str,
) -> Result<(), String> {
    validate_password(password)?;
    if !bundle.includes_secrets {
        return Err("脱敏配置包不需要使用私密加密格式".to_string());
    }
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("iwbundle"))
    {
        return Err("加密配置包文件必须使用 .iwbundle 扩展名".to_string());
    }
    let mut plaintext = Zeroizing::new(
        serde_json::to_vec(bundle).map_err(|error| format!("无法生成扩展配置包: {error}"))?,
    );
    if plaintext.len() as u64 > MAX_BUNDLE_BYTES {
        return Err("扩展配置包超过 64 MB, 已拒绝导出".to_string());
    }
    let mut salt = [0_u8; 16];
    let mut nonce = [0_u8; 12];
    let mut rng = OsRng;
    rng.try_fill_bytes(&mut salt)
        .map_err(|_| "无法从系统安全随机源生成配置包盐值".to_string())?;
    rng.try_fill_bytes(&mut nonce)
        .map_err(|_| "无法从系统安全随机源生成配置包随机数".to_string())?;
    let mut key = Zeroizing::new(derive_key(
        password,
        &salt,
        KDF_MEMORY_KIB,
        KDF_ITERATIONS,
        KDF_PARALLELISM,
    )?);
    let cipher = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| "无法初始化配置包加密器".to_string())?;
    key.zeroize();
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: ENCRYPTED_AAD,
            },
        )
        .map_err(|_| "扩展配置包加密失败".to_string());
    plaintext.zeroize();
    let ciphertext = encrypted?;
    let envelope = EncryptedBundleEnvelope {
        schema_version: 1,
        format: ENCRYPTED_FORMAT.to_string(),
        kdf: EncryptedKdf {
            name: "argon2id".to_string(),
            memory_kib: KDF_MEMORY_KIB,
            iterations: KDF_ITERATIONS,
            parallelism: KDF_PARALLELISM,
            salt_base64: STANDARD.encode(salt),
        },
        cipher: EncryptedCipher {
            name: "aes-256-gcm".to_string(),
            nonce_base64: STANDARD.encode(nonce),
        },
        ciphertext_base64: STANDARD.encode(ciphertext),
    };
    let data = serde_json::to_vec_pretty(&envelope)
        .map_err(|error| format!("无法生成加密配置包: {error}"))?;
    if data.len() as u64 > MAX_ENCRYPTED_BUNDLE_BYTES {
        return Err("加密配置包超过 96 MB, 已拒绝导出".to_string());
    }
    write_private_file(path, &data, "iwbundle.tmp")
}

pub(super) fn read_bundle(
    path: &Path,
    password: Option<&str>,
) -> Result<(ExtensionBundle, bool), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("无法读取扩展配置包 {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("扩展配置包必须是普通文件, 不允许符号链接".to_string());
    }
    if metadata.len() > MAX_ENCRYPTED_BUNDLE_BYTES {
        return Err("扩展配置包超过 96 MB, 已拒绝导入".to_string());
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("无法读取扩展配置包 {}: {error}", path.display()))?;
    let value = serde_json::from_str::<Value>(&raw)
        .map_err(|error| format!("扩展配置包 JSON 无效: {error}"))?;
    let encrypted = value.get("format").and_then(Value::as_str) == Some(ENCRYPTED_FORMAT);
    let bundle = if encrypted {
        decrypt_bundle(value, password.unwrap_or_default())?
    } else {
        if metadata.len() > MAX_BUNDLE_BYTES {
            return Err("扩展配置包超过 64 MB, 已拒绝导入".to_string());
        }
        serde_json::from_value::<ExtensionBundle>(value)
            .map_err(|error| format!("扩展配置包格式无效: {error}"))?
    };
    validate_bundle(&bundle)?;
    Ok((bundle, encrypted))
}

fn decrypt_bundle(value: Value, password: &str) -> Result<ExtensionBundle, String> {
    validate_password(password).map_err(|_| "请输入正确的配置包密码".to_string())?;
    let envelope = serde_json::from_value::<EncryptedBundleEnvelope>(value)
        .map_err(|error| format!("加密配置包格式无效: {error}"))?;
    validate_envelope(&envelope)?;
    let salt = STANDARD
        .decode(&envelope.kdf.salt_base64)
        .map_err(|_| "加密配置包盐值无效".to_string())?;
    let nonce = STANDARD
        .decode(&envelope.cipher.nonce_base64)
        .map_err(|_| "加密配置包随机数无效".to_string())?;
    if salt.len() != 16 || nonce.len() != 12 {
        return Err("加密配置包参数长度无效".to_string());
    }
    let ciphertext = STANDARD
        .decode(&envelope.ciphertext_base64)
        .map_err(|_| "加密配置包密文无效".to_string())?;
    if ciphertext.len() as u64 > MAX_BUNDLE_BYTES + 16 {
        return Err("加密配置包解密内容超过 64 MB".to_string());
    }
    let mut key = Zeroizing::new(derive_key(
        password,
        &salt,
        envelope.kdf.memory_kib,
        envelope.kdf.iterations,
        envelope.kdf.parallelism,
    )?);
    let cipher = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| "无法初始化配置包解密器".to_string())?;
    key.zeroize();
    let mut plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: ENCRYPTED_AAD,
                },
            )
            .map_err(|_| "配置包密码错误或文件已损坏".to_string())?,
    );
    if plaintext.len() as u64 > MAX_BUNDLE_BYTES {
        return Err("解密后的配置包超过 64 MB".to_string());
    }
    let bundle = serde_json::from_slice::<ExtensionBundle>(&plaintext)
        .map_err(|error| format!("解密后的配置包格式无效: {error}"));
    plaintext.zeroize();
    bundle
}

fn validate_envelope(envelope: &EncryptedBundleEnvelope) -> Result<(), String> {
    if envelope.schema_version != 1
        || envelope.format != ENCRYPTED_FORMAT
        || envelope.kdf.name != "argon2id"
        || envelope.cipher.name != "aes-256-gcm"
        || !(8 * 1024..=64 * 1024).contains(&envelope.kdf.memory_kib)
        || !(1..=5).contains(&envelope.kdf.iterations)
        || !(1..=4).contains(&envelope.kdf.parallelism)
    {
        return Err("不支持或不安全的加密配置包参数".to_string());
    }
    Ok(())
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.as_bytes().len() < MIN_PASSWORD_BYTES {
        return Err("配置包密码至少需要 10 个字节".to_string());
    }
    if password.as_bytes().len() > MAX_PASSWORD_BYTES {
        return Err("配置包密码不能超过 256 个字节".to_string());
    }
    Ok(())
}

fn derive_key(
    password: &str,
    salt: &[u8],
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
) -> Result<[u8; 32], String> {
    let params = Params::new(memory_kib, iterations, parallelism, Some(32))
        .map_err(|_| "加密配置包 KDF 参数无效".to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0_u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|_| "无法派生配置包加密密钥".to_string())?;
    Ok(key)
}

fn write_private_file(path: &Path, data: &[u8], temp_extension: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("无法创建配置包目录 {}: {error}", parent.display()))?;
    }
    let temp = path.with_extension(temp_extension);
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
    fn writes_and_reads_a_redacted_bundle() {
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
        let (read, encrypted) = read_bundle(&path, None).unwrap();
        assert_eq!(read.schema_version, 1);
        assert!(!encrypted);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn encrypts_private_bundles_and_rejects_wrong_passwords() {
        let root = sandbox();
        let path = root.join("private.iwbundle");
        let bundle = new_bundle(
            "cursor".to_string(),
            "user".to_string(),
            true,
            vec![BundleMcp {
                name: "demo".to_string(),
                enabled: true,
                value: serde_json::json!({ "env": { "TOKEN": "secret-value" } }),
                repository: None,
                revision: None,
            }],
            Vec::new(),
            Vec::new(),
        );
        assert!(write_bundle(&root.join("unsafe.json"), &bundle).is_err());
        write_encrypted_bundle(&path, &bundle, "correct horse battery staple").unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("secret-value"));
        assert!(read_bundle(&path, Some("wrong-password")).is_err());
        let (read, encrypted) = read_bundle(&path, Some("correct horse battery staple")).unwrap();
        assert!(encrypted);
        assert_eq!(read.mcp_servers[0].value["env"]["TOKEN"], "secret-value");

        let mut envelope = serde_json::from_str::<Value>(&raw).unwrap();
        let ciphertext = envelope["ciphertextBase64"].as_str().unwrap().to_string();
        let mut changed = ciphertext.into_bytes();
        changed[0] = if changed[0] == b'A' { b'B' } else { b'A' };
        envelope["ciphertextBase64"] = Value::String(String::from_utf8(changed).unwrap());
        let tampered = root.join("tampered.iwbundle");
        fs::write(&tampered, serde_json::to_vec(&envelope).unwrap()).unwrap();
        assert!(read_bundle(&tampered, Some("correct horse battery staple")).is_err());

        let mut unsafe_params = serde_json::from_str::<Value>(&raw).unwrap();
        unsafe_params["kdf"]["memoryKib"] = Value::from(1024_u64 * 1024);
        let unsafe_path = root.join("unsafe-params.iwbundle");
        fs::write(&unsafe_path, serde_json::to_vec(&unsafe_params).unwrap()).unwrap();
        let error = read_bundle(&unsafe_path, Some("correct horse battery staple")).unwrap_err();
        assert!(error.contains("不支持或不安全"));
        let _ = fs::remove_dir_all(root);
    }
}
