use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

use super::{ExtensionPaths, Scope, Target};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionTargetDescriptor {
    pub id: String,
    pub label: String,
    pub adapter_version: String,
    pub description: String,
    pub user_capabilities: Vec<String>,
    pub project_capabilities: Vec<String>,
}

pub(super) trait ExtensionTargetAdapter: Sync {
    fn id(&self) -> &'static str;
    fn label(&self) -> &'static str;
    fn version(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn user_paths(&self, home: &Path) -> AdapterPaths;
    fn project_paths(&self, workspace: &Path) -> AdapterPaths;
    fn read_only_skill_roots(
        &self,
        scope: Scope,
        home: &Path,
        workspace: Option<&Path>,
    ) -> Vec<(PathBuf, String)>;
    fn prompt_editable(&self, scope: Scope) -> bool;
    fn prompt_note(&self, scope: Scope) -> String;
    fn normalize_mcp(&self, value: &mut Value, transport: &str);
    fn capabilities(&self, scope: Scope) -> Vec<String>;
}

pub(super) struct AdapterPaths {
    pub mcp_config: PathBuf,
    pub mcp_disabled: PathBuf,
    pub skill_root: PathBuf,
    pub skill_disabled_root: PathBuf,
    pub prompt_root: PathBuf,
    pub prompt_disabled_root: PathBuf,
}

struct CursorAdapter;
struct ClaudeCodeAdapter;

static CURSOR: CursorAdapter = CursorAdapter;
static CLAUDE_CODE: ClaudeCodeAdapter = ClaudeCodeAdapter;

pub(super) fn adapter(target: Target) -> &'static dyn ExtensionTargetAdapter {
    match target {
        Target::Cursor => &CURSOR,
        Target::ClaudeCode => &CLAUDE_CODE,
    }
}

pub(super) fn descriptors() -> Vec<ExtensionTargetDescriptor> {
    [adapter(Target::Cursor), adapter(Target::ClaudeCode)]
        .into_iter()
        .map(|adapter| ExtensionTargetDescriptor {
            id: adapter.id().to_string(),
            label: adapter.label().to_string(),
            adapter_version: adapter.version().to_string(),
            description: adapter.description().to_string(),
            user_capabilities: adapter.capabilities(Scope::User),
            project_capabilities: adapter.capabilities(Scope::Project),
        })
        .collect()
}

pub(super) fn resolve_paths(
    target: Target,
    scope: Scope,
    workspace: Option<PathBuf>,
    home: &Path,
) -> ExtensionPaths {
    let adapter = adapter(target);
    let paths = match scope {
        Scope::User => adapter.user_paths(home),
        Scope::Project => adapter.project_paths(
            workspace
                .as_deref()
                .expect("project scope workspace was validated"),
        ),
    };
    let read_only_skill_roots = adapter.read_only_skill_roots(scope, home, workspace.as_deref());
    ExtensionPaths {
        target,
        scope,
        workspace,
        mcp_config: paths.mcp_config,
        mcp_disabled: paths.mcp_disabled,
        skill_root: paths.skill_root,
        skill_disabled_root: paths.skill_disabled_root,
        prompt_root: paths.prompt_root,
        prompt_disabled_root: paths.prompt_disabled_root,
        read_only_skill_roots,
    }
}

impl ExtensionTargetAdapter for CursorAdapter {
    fn id(&self) -> &'static str {
        "cursor"
    }

    fn label(&self) -> &'static str {
        "Cursor"
    }

    fn version(&self) -> &'static str {
        "1.0.0"
    }

    fn description(&self) -> &'static str {
        "管理 Cursor MCP、Agent Skills 和项目级规则"
    }

    fn user_paths(&self, home: &Path) -> AdapterPaths {
        AdapterPaths {
            mcp_config: home.join(".cursor/mcp.json"),
            mcp_disabled: home.join(".cursor/mcp.disabled.json"),
            skill_root: home.join(".cursor/skills"),
            skill_disabled_root: home.join(".cursor/skills-disabled"),
            prompt_root: home.join(".cursor/rules"),
            prompt_disabled_root: home.join(".cursor/rules-disabled"),
        }
    }

    fn project_paths(&self, workspace: &Path) -> AdapterPaths {
        AdapterPaths {
            mcp_config: workspace.join(".cursor/mcp.json"),
            mcp_disabled: workspace.join(".cursor/mcp.disabled.json"),
            skill_root: workspace.join(".cursor/skills"),
            skill_disabled_root: workspace.join(".cursor/skills-disabled"),
            prompt_root: workspace.join(".cursor/rules"),
            prompt_disabled_root: workspace.join(".cursor/rules-disabled"),
        }
    }

    fn read_only_skill_roots(
        &self,
        scope: Scope,
        home: &Path,
        workspace: Option<&Path>,
    ) -> Vec<(PathBuf, String)> {
        match scope {
            Scope::User => vec![
                (
                    home.join(".cursor/skills-cursor"),
                    "Cursor 内置".to_string(),
                ),
                (home.join(".claude/skills"), "Claude 兼容".to_string()),
                (home.join(".agents/skills"), "Agents 共享".to_string()),
            ],
            Scope::Project => {
                let root = workspace.expect("project scope workspace was validated");
                vec![
                    (root.join(".claude/skills"), "Claude 兼容".to_string()),
                    (root.join(".agents/skills"), "Agents 共享".to_string()),
                ]
            }
        }
    }

    fn prompt_editable(&self, scope: Scope) -> bool {
        scope == Scope::Project
    }

    fn prompt_note(&self, scope: Scope) -> String {
        if scope == Scope::User {
            "Cursor 全局 User Rules 只能在 Customize > Rules 中维护. 工作台仅管理项目级 .cursor/rules/*.mdc, 避免写入未公开的私有数据库".to_string()
        } else {
            "Cursor 项目规则写入 .cursor/rules/*.mdc, 可以纳入版本控制".to_string()
        }
    }

    fn normalize_mcp(&self, value: &mut Value, _transport: &str) {
        if let Some(object) = value.as_object_mut() {
            object.remove("type");
            object.remove("_i18nWorkbench");
        }
    }

    fn capabilities(&self, scope: Scope) -> Vec<String> {
        let mut values = vec![
            "mcp".to_string(),
            "skills".to_string(),
            "health-check".to_string(),
            "transfer".to_string(),
        ];
        if self.prompt_editable(scope) {
            values.push("prompts".to_string());
        }
        values
    }
}

impl ExtensionTargetAdapter for ClaudeCodeAdapter {
    fn id(&self) -> &'static str {
        "claude-code"
    }

    fn label(&self) -> &'static str {
        "Claude Code"
    }

    fn version(&self) -> &'static str {
        "1.0.0"
    }

    fn description(&self) -> &'static str {
        "管理 Claude Code MCP、Agent Skills 和个人或项目规则"
    }

    fn user_paths(&self, home: &Path) -> AdapterPaths {
        AdapterPaths {
            mcp_config: home.join(".claude.json"),
            mcp_disabled: home.join(".claude/mcp.disabled.json"),
            skill_root: home.join(".claude/skills"),
            skill_disabled_root: home.join(".claude/skills-disabled"),
            prompt_root: home.join(".claude/rules"),
            prompt_disabled_root: home.join(".claude/rules-disabled"),
        }
    }

    fn project_paths(&self, workspace: &Path) -> AdapterPaths {
        AdapterPaths {
            mcp_config: workspace.join(".mcp.json"),
            mcp_disabled: workspace.join(".mcp.disabled.json"),
            skill_root: workspace.join(".claude/skills"),
            skill_disabled_root: workspace.join(".claude/skills-disabled"),
            prompt_root: workspace.join(".claude/rules"),
            prompt_disabled_root: workspace.join(".claude/rules-disabled"),
        }
    }

    fn read_only_skill_roots(
        &self,
        _scope: Scope,
        _home: &Path,
        _workspace: Option<&Path>,
    ) -> Vec<(PathBuf, String)> {
        Vec::new()
    }

    fn prompt_editable(&self, _scope: Scope) -> bool {
        true
    }

    fn prompt_note(&self, scope: Scope) -> String {
        if scope == Scope::User {
            "Claude Code 官方支持 ~/.claude/rules/*.md 作为所有项目生效的个人规则".to_string()
        } else {
            "Claude Code 项目规则写入 .claude/rules/*.md, 可以纳入版本控制".to_string()
        }
    }

    fn normalize_mcp(&self, value: &mut Value, transport: &str) {
        if let Some(object) = value.as_object_mut() {
            object.remove("_i18nWorkbench");
            object.insert("type".to_string(), Value::String(transport.to_string()));
        }
    }

    fn capabilities(&self, _scope: Scope) -> Vec<String> {
        vec![
            "mcp".to_string(),
            "skills".to_string(),
            "prompts".to_string(),
            "health-check".to_string(),
            "transfer".to_string(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_target_specific_paths_and_capabilities() {
        let home = Path::new("/home/demo");
        let cursor = adapter(Target::Cursor);
        let cursor_paths = cursor.user_paths(home);
        assert!(cursor_paths.mcp_config.ends_with(".cursor/mcp.json"));
        assert!(!cursor.prompt_editable(Scope::User));
        assert!(!cursor
            .capabilities(Scope::User)
            .contains(&"prompts".to_string()));

        let claude = adapter(Target::ClaudeCode);
        let claude_paths = claude.user_paths(home);
        assert!(claude_paths.mcp_config.ends_with(".claude.json"));
        assert!(claude.prompt_editable(Scope::User));
        assert!(claude
            .capabilities(Scope::User)
            .contains(&"prompts".to_string()));
    }

    #[test]
    fn exposes_stable_descriptors_for_the_frontend() {
        let descriptors = descriptors();
        assert_eq!(descriptors.len(), 2);
        assert_eq!(descriptors[0].id, "cursor");
        assert_eq!(descriptors[0].adapter_version, "1.0.0");
        assert!(descriptors[1]
            .user_capabilities
            .contains(&"prompts".to_string()));
    }
}
