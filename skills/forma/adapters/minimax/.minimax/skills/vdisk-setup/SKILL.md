---
name: vdisk-setup
description: Mount and verify a virtual RAM disk for fast test execution, web page builds, script drafts, and high-volume I/O operations. Accelerates I/O by 2-8x, eliminates NAND flash wear, and prevents host disk clutter. Invoke before running test suites, generating visual artifacts, building pages, or during initial project setup if unmounted.
---

# vdisk-setup — virtual memory disk (RAM disk)

A core Forma protocol skill. Mounts and verifies an in-memory virtual RAM disk (`R:\forma-tmp` on Windows, `/dev/shm/forma-tmp` on Linux) to accelerate filesystem I/O and prevent disk clutter and physical SSD wear.

## Purpose and speed physics

1. **File operation speed (2–8x faster):**
   - Eliminates PCIe bus and SSD controller wait latency (*CPU I/O Wait*), transactional cache flushes, and filesystem metadata locks (MFT/inodes).
   - Storage requests are routed by the kernel driver (`OSFDisk.sys` / `imdisk.sys`) directly to processor memory copies via integrated memory controller (IMC, AVX instructions, `rep movsb`).
   - Real-hardware benchmarks:
     - Creating 2,000 files: **0.199s** (RAM disk) vs **1.493s** (NVMe SSD) — **7.5x faster**.
     - Deleting a folder with 2,000 files: **0.083s** vs **0.213s** — **2.6x faster**.
     - Parallel test execution: 16 test runner worker threads operate on private DDR memory pages without queuing up at physical NAND flash channels.
2. **Physical SSD protection from wear and clutter:**
   - Ephemeral test files, browser bundles, and scratch scripts do not write to physical SSD storage, preserving NAND flash endurance (TBW).
   - Any orphaned temporary files automatically vanish on unmount or system reboot without requiring manual cleanup of OS temp folders.

---

## When to invoke

- Before running test suites (`npm test`, `test-runner.cjs`, unit tests).
- When assembling or tuning web pages, compiling HTML/CSS/JS, or rendering heavy visual artifacts.
- When executing scripts with massive intermediate file churn.
- During the initial project setup wizard ([`project-setup`](../project-setup/SKILL.md)).

---

## How to check and configure

```
1. Check status ➔ 2. Prompt human (if unmounted) ➔ 3. Mount or fall back to soft degradation
```

### Step 1. Check RAM disk availability

Run verification from the project root:
```bash
node .forma/skills/vdisk-setup/scripts/check-vdisk.cjs --status
```
Or get JSON details:
```bash
node .forma/skills/vdisk-setup/scripts/check-vdisk.cjs --json
```
- If mounted and writable (`[OK]`): proceed normally.
- If not detected (`[!]`): proceed to Step 2.

### Step 2. Human prompt with justification

Ask the user an interactive question outlining the benefits:

> **Virtual RAM disk setup proposal:**
> The current task (*testing / web page build / file generation*) performs intensive filesystem I/O operations.
> - **Performance:** 2–8x faster I/O (up to 7.5x faster file operations via direct processor DDR access).
> - **SSD endurance:** protects your primary SSD from thousands of transient files and NAND cell wear.
>
> **Mount virtual RAM disk `R:\forma-tmp`?**
> 1. **Yes** — mount automatically (PowerShell script via OSFMount / ImDisk).
> 2. **No** — continue on standard disk in soft degradation mode (`os.tmpdir()`).

### Step 3. Execute choice

- **User selects "Yes":**
  Execute setup script (Windows):
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts/setup-ramdisk.ps1
  ```
  The script provisions drive `R:` (4 GB size, NTFS), creates directory `R:\forma-tmp`, sets full permissions (`icacls *S-1-1-0:(OI)(CI)F`), adds Windows Defender exclusion, and exports `FORMA_TEST_TMP`.

- **User selects "No":**
  Record refusal in the session history and continue in degradation mode using the physical drive via `os.tmpdir()` (`path.join(os.tmpdir(), 'forma-tmp')`). Never abort or throw an error due to RAM disk absence (soft degradation rule).

---

## Session and isolation rules

1. **Project and session subdirectories:**
   Every card or session must operate within its dedicated isolated directory:
   `R:\forma-tmp\<project-slug>\<card-NNN>\`
   Direct writes to root `R:\forma-tmp\` are prohibited. Resolving an isolated path:
   `node scripts/check-vdisk.cjs --ensure-slug <project-slug>/<card-NNN>`
2. **Mutex for full test suites (`npm test`):**
   Full test runs acquire a filesystem mutex on the RAM disk:
   `until mkdir 'R:/forma-tmp/npmtest-lock' 2>/dev/null; do sleep 30; done`
   Upon completion, `npmtest-lock` must be removed immediately (`rmdir`).
3. **Clean zone (Prohibition 16):**
   Only transient, regenerable files live on the RAM disk. Project source code, Git history, and credentials (`.env`) are never transferred to the RAM disk.
