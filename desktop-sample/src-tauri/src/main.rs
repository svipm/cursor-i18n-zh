#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod adapters;
mod github;
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
fn open_project_page(page: String) -> Result<(), String> {
    let url = match page.as_str() {
        "repository" => release::PROJECT_REPOSITORY_URL,
        "releases" => release::PROJECT_RELEASES_URL,
        _ => return Err(format!("不支持的项目页面: {page}")),
    };
    adapters::hidden_command("explorer.exe")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开默认浏览器: {error}"))
}

#[tauri::command]
fn open_github_url(url: String) -> Result<(), String> {
    if !github::is_safe_project_url(&url) {
        return Err("仅允许打开 svipm 名下的 GitHub 仓库".to_string());
    }
    adapters::hidden_command("explorer.exe")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开默认浏览器: {error}"))
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
    let escaped = executable.to_string_lossy().replace('\'', "''");
    let command = format!("Start-Process -FilePath '{escaped}' -Verb RunAs");
    let status = adapters::hidden_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &command])
        .status()
        .map_err(|error| format!("无法请求管理员权限: {error}"))?;
    if !status.success() {
        return Err(format!("管理员启动请求失败, exit {:?}", status.code()));
    }
    app.exit(0);
    Ok(())
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
            open_project_page,
            open_github_url,
            restart_as_admin,
            run_app_action
        ])
        .run(tauri::generate_context!())
        .expect("failed to run localization workbench");
}
