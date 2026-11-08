# Setup

Machine setup notes for running this protocol comfortably. Everything here is optional — the protocol works without any of it, degraded where noted.

## RAM disk for test temp files (recommended on Windows)

Disk-heavy test runs create thousands of small temporary files; they are much faster when temp data lives in RAM.

- The test runner (`scripts/test-runner.cjs`) resolves the temp base in order: `FORMA_TEST_TMP` → detected RAM disk (`R:\forma-tmp` on Windows, `/dev/shm/forma-tmp` on Linux) → `os.tmpdir()`. Each project gets its own subdirectory derived from the repository name, so several open projects never share one temp directory.
- An explicit `FORMA_TEST_TMP` is checked for existence even when set: a dead path falls through with a warning and is never trusted blindly.
- One-time Windows provisioning: run `powershell -File scripts/setup-ramdisk.ps1` from an administrator terminal — it mounts a RAM disk and creates the temp folder. Re-running it is safe when the disk already exists.
- Only regenerable data goes there: test fixtures, scratch builds, isolated `forma init` runs, heavy script drafts. The project tree, git history and credentials never do. Global user `TEMP`/`TMP` are never redirected — the redirection is per-process, where the runner or the kit sets it.
- Sessions: a node checks the disk at session start; if the machine's provision mechanism (scheduled task or script) cannot bring it up, the work degrades to `os.tmpdir()` and says so to the human.
- Architecture & benchmarks: detailed subsystem operation, CPU interaction (IMC, zero I/O wait), and hardware speed comparisons (4.2x–7.5x speedup on small files) are documented in [FUNCTIONS.md](skills/forma/core/manual/en/03-protocol/FUNCTIONS.md).
