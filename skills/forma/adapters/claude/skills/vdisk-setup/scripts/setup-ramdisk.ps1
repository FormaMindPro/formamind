# scripts/setup-ramdisk.ps1
# Automatic RAM disk setup for fast Forma protocol test runs
# Recommended: run in PowerShell as Administrator.

[CmdletBinding()]
param (
    [string]$DriveLetter = "R:",
    [string]$Size = "4G",
    [string]$TmpFolder = "forma-tmp"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Adaptive Forma RAM disk setup ===" -ForegroundColor Cyan

# 1. Administrator rights check
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "The script runs without Administrator rights. Some steps may require elevated privileges."
}

# Normalize drive letter
$cleanLetter = $DriveLetter.TrimEnd('\').TrimEnd(':').ToUpper() + ":"
$driveRoot = "$cleanLetter\"

# 2. Check if requested drive exists and whether it is already our RAM disk
$driveAlreadyReady = $false
$existingDisk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$cleanLetter'" -ErrorAction SilentlyContinue

if ($existingDisk) {
    $isRamDisk = ($existingDisk.VolumeName -eq "RAMDISK") -or (Test-Path (Join-Path $driveRoot $TmpFolder))
    if ($isRamDisk) {
        Write-Host "[1/4] [OK] RAM disk $cleanLetter is already mounted (Volume: $($existingDisk.VolumeName)) and ready." -ForegroundColor Green
        $driveAlreadyReady = $true
    } else {
        # Letter is occupied by a non-RAM drive (e.g. physical disk, USB, network share)
        Write-Warning "Drive letter $cleanLetter is already occupied by an existing drive ($($existingDisk.VolumeName), $($existingDisk.Description))."
        Write-Host "Searching for the next available drive letter for RAM disk..." -ForegroundColor Yellow

        $busyLetters = [System.IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name.Substring(0, 1).ToUpper() }
        # Try letters starting from Z down to E
        $candidate = ('Z', 'Y', 'X', 'W', 'V', 'U', 'T', 'S', 'Q', 'P', 'O', 'N', 'M', 'L', 'K', 'J', 'I', 'H', 'G', 'F', 'E') |
            Where-Object { $_ -notin $busyLetters } |
            Select-Object -First 1

        if (-not $candidate) {
            Write-Error "No free drive letters available to mount RAM disk."
            exit 1
        }

        $cleanLetter = "$candidate`:"
        $driveRoot = "$cleanLetter\"
        Write-Host "[1/4] Adaptive choice: selected free drive letter $cleanLetter" -ForegroundColor Cyan
    }
}

if (-not $driveAlreadyReady) {
    # Look for OSFMount or ImDisk
    $osfmountCli = "C:\Program Files\OSFMount\OSFMount.com"
    if (-not (Test-Path $osfmountCli) -and -not (Get-Command "imdisk" -ErrorAction SilentlyContinue)) {
        Write-Host "[1/4] Installing virtual disk utility via winget..." -ForegroundColor Yellow
        try {
            Start-Process winget -ArgumentList "install PassMark.OSFMount --silent --accept-source-agreements --accept-package-agreements" -Wait -NoNewWindow
        } catch {
            Write-Warning "Could not install via winget automatically."
        }
    }

    if (Test-Path $osfmountCli) {
        Write-Host "[1/4] Creating RAM disk $cleanLetter via OSFMount..." -ForegroundColor Yellow
        & $osfmountCli -a -t vm -m $cleanLetter -o "format:ntfs:`"RAMDISK`",rw" -s $Size
    } elseif (Get-Command "imdisk" -ErrorAction SilentlyContinue) {
        Write-Host "[1/4] Creating RAM disk $cleanLetter via ImDisk..." -ForegroundColor Yellow
        imdisk -a -s $Size -m $cleanLetter -p "/fs:ntfs /v:RAMDISK /q /y"
    } else {
        Write-Error "No RAM disk utility found (OSFMount or ImDisk)."
        exit 1
    }
    Write-Host "[OK] RAM disk $cleanLetter mounted successfully." -ForegroundColor Green
}

# 3. Creating the work folder and granting universal rights
$targetTmp = Join-Path $driveRoot $TmpFolder
Write-Host "[2/4] Configuring $targetTmp folder and access rights..." -ForegroundColor Yellow
if (-not (Test-Path $targetTmp)) {
    New-Item -ItemType Directory -Force -Path $targetTmp | Out-Null
    try {
        # Universal SID *S-1-1-0 (Everyone) with container/object inheritance, non-recursive to avoid stalling on existing files
        cmd.exe /c "icacls `"$targetTmp`" /grant *S-1-1-0:(OI)(CI)F /Q" | Out-Null
        cmd.exe /c "icacls `"$driveRoot`" /grant *S-1-1-0:(OI)(CI)F /Q" | Out-Null
    } catch {
        Write-Warning "Could not update rights via icacls: $_"
    }
}
Write-Host "[OK] Access rights on $targetTmp configured." -ForegroundColor Green

# 4. Windows Defender exclusion
if ($isAdmin) {
    Write-Host "[3/4] Adding $targetTmp to Windows Defender exclusions..." -ForegroundColor Yellow
    try {
        # Add both the specific tmp directory and the RAM disk root
        Add-MpPreference -ExclusionPath $targetTmp -ErrorAction SilentlyContinue
        Add-MpPreference -ExclusionPath $driveRoot -ErrorAction SilentlyContinue
        Write-Host "[OK] $targetTmp and $cleanLetter added to Defender exclusions." -ForegroundColor Green
    } catch {
        Write-Warning "Could not add to Windows Defender exclusions: $_"
    }
} else {
    Write-Host "[3/4] Defender exclusion requires Administrator rights." -ForegroundColor DarkGray
}

# 5. Setting the FORMA_TEST_TMP environment variable
Write-Host "[4/4] Saving FORMA_TEST_TMP environment variable ($targetTmp)..." -ForegroundColor Yellow
[Environment]::SetEnvironmentVariable("FORMA_TEST_TMP", $targetTmp, "User")
$env:FORMA_TEST_TMP = $targetTmp

Write-Host "`n[OK] Setup finished successfully!" -ForegroundColor Green
Write-Host "RAM disk $cleanLetter ($targetTmp) is ready. Tests now fly in main memory.`n"
