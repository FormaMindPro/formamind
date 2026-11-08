# Codex check-card: a wrapper over .codex/scripts/codex-hooks.cjs (AGENTS.md section 1, .codex/CODEX-8.md). Never blocks.
$repoRoot = Split-Path -Parent (Split-Path $PSScriptRoot -Parent)
if (Get-Command node -ErrorAction SilentlyContinue) { $input | & node (Join-Path $repoRoot '.codex\scripts\codex-hooks.cjs') check-card }
exit 0
