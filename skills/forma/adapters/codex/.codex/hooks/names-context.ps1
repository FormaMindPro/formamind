# Codex names-context: a wrapper over .codex/scripts/codex-hooks.cjs (AGENTS.md section 1, prohibition 20). Never blocks.
$repoRoot = Split-Path -Parent (Split-Path $PSScriptRoot -Parent)
if (Get-Command node -ErrorAction SilentlyContinue) { $input | & node (Join-Path $repoRoot '.codex\scripts\codex-hooks.cjs') names-context }
exit 0
