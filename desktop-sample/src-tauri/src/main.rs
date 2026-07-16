#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod adapters;
mod extensions;
mod github;
mod market;
mod network;
mod release;
mod usage;

use adapters::{
    ActionRequest, AppStatus, BackupRecord, EnvironmentStatus, OperationResult, ProgressSink,
};
use release::UpdateStatus;
use tauri::AppHandle;
use usage::UsageOverview;

#[tauri::command]
fn detect_apps() -> Vec<AppStatus> {
    adapters::detect_all()
}

#[tauri::command]
fn environment_status() -> EnvironmentStatus {
    adapters::environment_status()
}

#[tauri::command]
async fn list_backups() -> Result<Vec<BackupRecord>, String> {
    tauri::async_runtime::spawn_blocking(adapters::list_backups)
        .await
        .map_err(|error| format!("备份扫描线程异常: {error}"))
}

#[tauri::command]
async fn cursor_usage() -> Result<UsageOverview, String> {
    tauri::async_runtime::spawn_blocking(usage::load_cursor_usage)
        .await
        .map_err(|error| format!("用量读取线程异常: {error}"))?
}

#[tauri::command]
async fn check_for_updates() -> Result<UpdateStatus, String> {
    tauri::async_runtime::spawn_blocking(release::check_for_updates)
        .await
        .map_err(|error| format!("版本检查线程异常: {error}"))?
}

#[tauri::command]
async fn github_projects() -> Result<Vec<github::GitHubProject>, String> {
    tauri::async_runtime::spawn_blocking(github::load_projects)
        .await
        .map_err(|error| format!("GitHub 项目读取线程异常: {error}"))?
}

#[tauri::command]
async fn extension_market(
    query: extensions::ExtensionQuery,
) -> Result<Vec<market::MarketItemStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || market::catalog_for(query))
        .await
        .map_err(|error| format!("扩展市场线程异常: {error}"))?
}

#[tauri::command]
async fn extension_install_market_item(
    request: market::MarketRequest,
) -> Result<market::MarketInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || market::install(request))
        .await
        .map_err(|error| format!("市场安装线程异常: {error}"))?
}

#[tauri::command]
fn extension_inventory(
    query: extensions::ExtensionQuery,
) -> Result<extensions::ExtensionInventory, String> {
    extensions::inventory(query)
}

#[tauri::command]
fn extension_mcp_details(
    request: extensions::McpLookupRequest,
) -> Result<extensions::McpServerDetails, String> {
    extensions::mcp_details(request)
}

#[tauri::command]
fn extension_save_mcp(
    request: extensions::McpSaveRequest,
) -> Result<extensions::ExtensionMutationResult, String> {
    extensions::save_mcp(request)
}

#[tauri::command]
fn extension_toggle_mcp(
    request: extensions::McpToggleRequest,
) -> Result<extensions::ExtensionMutationResult, String> {
    extensions::toggle_mcp(request)
}

#[tauri::command]
fn extension_delete_mcp(
    request: extensions::McpLookupRequest,
) -> Result<extensions::ExtensionMutationResult, String> {
    extensions::delete_mcp(request)
}

#[tauri::command]
fn extension_skill_details(
    request: extensions::SkillLookupRequest,
) -> Result<extensions::SkillDetails, String> {
    extensions::skill_details(request)
}

#[tauri::command]
fn extension_save_skill(
    request: extensions::SkillSaveRequest,
) -> Result<extensions::ExtensionMutationResult, String> {
    extensions::save_skill(request)
}

#[tauri::command]
fn extension_toggle_skill(
    request: extensions::SkillToggleRequest,
) -> Result<extensions::ExtensionMutationResult, String> {
    extensions::toggle_skill(request)
}

#[tauri::command]
fn extension_delete_skill(
    request: extensions::SkillLookupRequest,
) -> Result<extensions::ExtensionMutationResult, String> {
    extensions::delete_skill(request)
}

#[tauri::command]
fn extension_prompt_details(
    request: extensions::PromptLookupRequest,
) -> Result<extensions::PromptDetails, String> {
    extensions::prompt_details(request)
}

#[tauri::command]
fn extension_save_prompt(
    request: extensions::PromptSaveRequest,
) -> Result<extensions::ExtensionMutationResult, String> {
    extensions::save_prompt(request)
}

#[tauri::command]
fn extension_toggle_prompt(
    request: extensions::PromptToggleRequest,
) -> Result<extensions::ExtensionMutationResult, String> {
    extensions::toggle_prompt(request)
}

#[tauri::command]
fn extension_delete_prompt(
    request: extensions::PromptLookupRequest,
) -> Result<extensions::ExtensionMutationResult, String> {
    extensions::delete_prompt(request)
}

#[tauri::command]
fn open_extension_location(query: extensions::ExtensionQuery, kind: String) -> Result<(), String> {
    let path = extensions::location_for(&query, &kind)?;
    std::fs::create_dir_all(&path)
        .map_err(|error| format!("无法创建扩展目录 {}: {error}", path.display()))?;
    open_external(path.as_os_str(), "扩展目录")
}

#[tauri::command]
async fn choose_extension_workspace() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(choose_workspace)
        .await
        .map_err(|error| format!("工作区选择线程异常: {error}"))?
}

#[cfg(target_os = "windows")]
fn choose_workspace() -> Result<Option<String>, String> {
    let script = "Add-Type -AssemblyName System.Windows.Forms; $dialog=New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description='选择要管理 MCP, Skill 和提示词的工作区'; $dialog.ShowNewFolderButton=$false; if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Write-Output $dialog.SelectedPath}";
    workspace_from_output(
        adapters::hidden_command("powershell.exe")
            .args(["-NoProfile", "-STA", "-Command", script])
            .output(),
    )
}

#[cfg(target_os = "macos")]
fn choose_workspace() -> Result<Option<String>, String> {
    workspace_from_output(
        adapters::hidden_command("osascript")
            .args([
                "-e",
                "POSIX path of (choose folder with prompt \"选择要管理 MCP, Skill 和提示词的工作区\")",
            ])
            .output(),
    )
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn choose_workspace() -> Result<Option<String>, String> {
    workspace_from_output(
        adapters::hidden_command("zenity")
            .args(["--file-selection", "--directory", "--title=选择工作区"])
            .output(),
    )
}

fn workspace_from_output(
    output: std::io::Result<std::process::Output>,
) -> Result<Option<String>, String> {
    let output = output.map_err(|error| format!("无法打开工作区选择器: {error}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let path = String::from_utf8_lossy(&output.stdout)
        .trim()
        .trim_end_matches(['/', '\\'])
        .to_string();
    Ok((!path.is_empty()).then_some(path))
}

#[tauri::command]
fn open_project_page(page: String) -> Result<(), String> {
    let url = match page.as_str() {
        "repository" => release::PROJECT_REPOSITORY_URL,
        "releases" => release::PROJECT_RELEASES_URL,
        _ => return Err(format!("不支持的项目页面: {page}")),
    };
    open_external(std::ffi::OsStr::new(url), "默认浏览器")
}

#[tauri::command]
fn open_github_url(url: String) -> Result<(), String> {
    if !github::is_safe_project_url(&url) && !market::is_safe_repository_url(&url) {
        return Err("仅允许打开经过校验的 GitHub 仓库首页".to_string());
    }
    open_external(std::ffi::OsStr::new(&url), "默认浏览器")
}

fn open_external(target: &std::ffi::OsStr, label: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = adapters::hidden_command("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = adapters::hidden_command("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = adapters::hidden_command("xdg-open");
    command
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开{label}: {error}"))
}

#[tauri::command]
async fn run_app_action(app: AppHandle, request: ActionRequest) -> Result<OperationResult, String> {
    let sink = ProgressSink::new(app, &request);
    tauri::async_runtime::spawn_blocking(move || adapters::run_action(request, sink))
        .await
        .map_err(|error| format!("操作线程异常: {error}"))?
}

#[tauri::command]
fn restart_as_admin(app: AppHandle) -> Result<(), String> {
    if adapters::is_elevated() {
        return Ok(());
    }

    let executable =
        std::env::current_exe().map_err(|error| format!("无法获取当前程序路径: {error}"))?;
    let status = restart_elevated(&executable)?;
    if !status.success() {
        return Err(format!("管理员启动请求失败, exit {:?}", status.code()));
    }
    app.exit(0);
    Ok(())
}

#[cfg(target_os = "windows")]
fn restart_elevated(executable: &std::path::Path) -> Result<std::process::ExitStatus, String> {
    let escaped = executable.to_string_lossy().replace('\'', "''");
    let command = format!("Start-Process -FilePath '{escaped}' -Verb RunAs");
    adapters::hidden_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &command])
        .status()
        .map_err(|error| format!("无法请求管理员权限: {error}"))
}

#[cfg(target_os = "macos")]
fn restart_elevated(executable: &std::path::Path) -> Result<std::process::ExitStatus, String> {
    let path = executable
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    let home = std::env::var("I18N_WORKBENCH_USER_HOME")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    let uid = adapters::hidden_command("id")
        .arg("-u")
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default();
    let gid = adapters::hidden_command("id")
        .arg("-g")
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default();
    let script = format!(
        "do shell script (\"HOME=\" & quoted form of \"{home}\" & \" I18N_WORKBENCH_USER_HOME=\" & quoted form of \"{home}\" & \" I18N_WORKBENCH_USER_UID={uid} I18N_WORKBENCH_USER_GID={gid} \" & quoted form of \"{path}\" & \" > /dev/null 2>&1 &\") with administrator privileges"
    );
    adapters::hidden_command("osascript")
        .args(["-e", &script])
        .status()
        .map_err(|error| format!("无法请求 macOS 管理员权限: {error}"))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn restart_elevated(executable: &std::path::Path) -> Result<std::process::ExitStatus, String> {
    adapters::hidden_command("pkexec")
        .arg(executable)
        .status()
        .map_err(|error| format!("无法请求管理员权限: {error}"))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            detect_apps,
            environment_status,
            list_backups,
            cursor_usage,
            check_for_updates,
            github_projects,
            extension_market,
            extension_install_market_item,
            extension_inventory,
            extension_mcp_details,
            extension_save_mcp,
            extension_toggle_mcp,
            extension_delete_mcp,
            extension_skill_details,
            extension_save_skill,
            extension_toggle_skill,
            extension_delete_skill,
            extension_prompt_details,
            extension_save_prompt,
            extension_toggle_prompt,
            extension_delete_prompt,
            open_extension_location,
            choose_extension_workspace,
            open_project_page,
            open_github_url,
            restart_as_admin,
            run_app_action
        ])
        .run(tauri::generate_context!())
        .expect("failed to run localization workbench");
}
