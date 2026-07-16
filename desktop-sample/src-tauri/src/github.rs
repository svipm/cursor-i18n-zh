use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::time::Duration;
use ureq::Error;

use crate::network;

const GITHUB_OWNER: &str = "svipm";
const GITHUB_REPOSITORIES_API: &str =
    "https://api.github.com/users/svipm/repos?per_page=100&type=owner&sort=updated";
const MAX_PROJECTS: usize = 6;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubProject {
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
    pub html_url: String,
    pub language: Option<String>,
    pub stars: u64,
    pub forks: u64,
    pub topics: Vec<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RepositoryResponse {
    name: String,
    full_name: String,
    description: Option<String>,
    html_url: String,
    language: Option<String>,
    #[serde(default)]
    stargazers_count: u64,
    #[serde(default)]
    forks_count: u64,
    #[serde(default)]
    topics: Vec<String>,
    updated_at: Option<String>,
    #[serde(default)]
    fork: bool,
    #[serde(default)]
    archived: bool,
    owner: RepositoryOwner,
}

#[derive(Debug, Deserialize)]
struct RepositoryOwner {
    login: String,
}

pub fn load_projects() -> Result<Vec<GitHubProject>, String> {
    let agent = network::platform_agent(Duration::from_secs(10));
    let mut response = network::with_retry(|| {
        agent
            .get(GITHUB_REPOSITORIES_API)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "cursor-i18n-zh-workbench")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .call()
    })
    .map_err(github_error)?;
    let repositories = response
        .body_mut()
        .read_json::<Vec<RepositoryResponse>>()
        .map_err(|error| format!("GitHub 项目响应格式错误: {error}"))?;
    Ok(select_projects(repositories))
}

pub fn is_safe_project_url(url: &str) -> bool {
    let Some(path) = url.strip_prefix("https://github.com/svipm/") else {
        return false;
    };
    let repository = path.strip_suffix('/').unwrap_or(path);
    !repository.is_empty()
        && !repository.contains('/')
        && repository
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn select_projects(repositories: Vec<RepositoryResponse>) -> Vec<GitHubProject> {
    let mut projects = repositories
        .into_iter()
        .filter(|repository| {
            !repository.fork
                && !repository.archived
                && repository.owner.login == GITHUB_OWNER
                && repository.full_name == format!("{GITHUB_OWNER}/{}", repository.name)
                && is_safe_project_url(&repository.html_url)
        })
        .map(|repository| GitHubProject {
            name: repository.name,
            full_name: repository.full_name,
            description: repository
                .description
                .map(|description| description.trim().to_string())
                .filter(|description| !description.is_empty()),
            html_url: repository.html_url,
            language: repository
                .language
                .map(|language| language.trim().to_string())
                .filter(|language| !language.is_empty()),
            stars: repository.stargazers_count,
            forks: repository.forks_count,
            topics: repository
                .topics
                .into_iter()
                .map(|topic| topic.trim().to_string())
                .filter(|topic| !topic.is_empty())
                .take(6)
                .collect(),
            updated_at: repository.updated_at,
        })
        .collect::<Vec<_>>();
    projects.sort_by(compare_projects);
    projects.truncate(MAX_PROJECTS);
    projects
}

fn compare_projects(left: &GitHubProject, right: &GitHubProject) -> Ordering {
    right
        .stars
        .cmp(&left.stars)
        .then_with(|| right.forks.cmp(&left.forks))
        .then_with(|| right.updated_at.cmp(&left.updated_at))
        .then_with(|| left.name.cmp(&right.name))
}

fn github_error(error: Error) -> String {
    match error {
        Error::StatusCode(403 | 429) => "GitHub 项目接口暂时受限, 请稍后重试".to_string(),
        Error::StatusCode(code) => format!("GitHub 项目接口返回 HTTP {code}"),
        other => format!("连接 GitHub 获取项目失败: {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repository(name: &str, stars: u64, forks: u64, updated_at: &str) -> RepositoryResponse {
        RepositoryResponse {
            name: name.to_string(),
            full_name: format!("svipm/{name}"),
            description: Some(format!("{name} description")),
            html_url: format!("https://github.com/svipm/{name}"),
            language: Some("Rust".to_string()),
            stargazers_count: stars,
            forks_count: forks,
            topics: vec!["desktop".to_string()],
            updated_at: Some(updated_at.to_string()),
            fork: false,
            archived: false,
            owner: RepositoryOwner {
                login: "svipm".to_string(),
            },
        }
    }

    #[test]
    fn selects_owned_active_projects_by_popularity() {
        let mut fork = repository("forked", 100, 100, "2026-07-16T00:00:00Z");
        fork.fork = true;
        let mut foreign = repository("foreign", 99, 99, "2026-07-16T00:00:00Z");
        foreign.owner.login = "someone-else".to_string();
        let projects = select_projects(vec![
            repository("recent", 8, 1, "2026-07-16T00:00:00Z"),
            repository("popular", 12, 2, "2026-07-15T00:00:00Z"),
            repository("forks", 8, 3, "2026-07-14T00:00:00Z"),
            fork,
            foreign,
        ]);
        assert_eq!(
            projects
                .iter()
                .map(|project| project.name.as_str())
                .collect::<Vec<_>>(),
            vec!["popular", "forks", "recent"]
        );
    }

    #[test]
    fn accepts_only_direct_owner_repository_urls() {
        assert!(is_safe_project_url(
            "https://github.com/svipm/cursor-i18n-zh"
        ));
        assert!(is_safe_project_url(
            "https://github.com/svipm/cursor-i18n-zh/"
        ));
        assert!(!is_safe_project_url("https://github.com/other/project"));
        assert!(!is_safe_project_url(
            "https://github.com/svipm/project/issues"
        ));
        assert!(!is_safe_project_url(
            "https://github.com/svipm/project?next=https://example.com"
        ));
    }

    #[test]
    #[ignore = "requires access to GitHub"]
    fn loads_public_projects_from_github() {
        let projects = load_projects().expect("GitHub project request should succeed");
        assert!(!projects.is_empty());
        assert!(projects
            .iter()
            .all(|project| is_safe_project_url(&project.html_url)));
    }
}
