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

$driveRoot = if ($DriveLetter.EndsWith(":")) { "$DriveLetter\" } else { "$DriveLetter:\" }
$cleanLetter = $DriveLetter.TrimEnd('\')

# 2. If the disk already exists
if (Test-Path $driveRoot) {
    Write-Host "[1/4] [OK] Disk $cleanLetter is already mounted and ready." -ForegroundColor Green
} else {
    # Look for OSFMount or ImDisk
    $osfmountCli = "C:\Program Files\OSFMount\OSFMount.com"
    if (-not (Test-Path $osfmountCli) -and -not (Get-Command "imdisk" -ErrorAction SilentlyContinue)) {
        Write-Host "[1/4] Installing the virtual disk utility via winget..." -ForegroundColor Yellow
        try {
            Start-Process winget -ArgumentList "install PassMark.OSFMount --silent --accept-source-agreements --accept-package-agreements" -Wait -NoNewWindow
        } catch {
            Write-Warning "Could not install via winget automatically."
        }
    }

    if (Test-Path $osfmountCli) {
        Write-Host "[1/4] Creating the RAM disk via OSFMount..." -ForegroundColor Yellow
        & $osfmountCli -a -t vm -m $cleanLetter -o "format:ntfs:`"RAMDISK`",rw" -s $Size
    } elseif (Get-Command "imdisk" -ErrorAction SilentlyContinue) {
        Write-Host "[1/4] Creating the RAM disk via ImDisk..." -ForegroundColor Yellow
        imdisk -a -s $Size -m $cleanLetter -p "/fs:ntfs /q /y"
    } else {
        Write-Error "No RAM disk utility found (OSFMount or ImDisk)."
        exit 1
    }
    Write-Host "[OK] RAM disk $cleanLetter mounted successfully." -ForegroundColor Green
}

# 3. Creating the work folder and granting universal rights
$targetTmp = Join-Path $driveRoot $TmpFolder
Write-Host "[2/4] Configuring the $targetTmp folder and access rights..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $targetTmp | Out-Null
try {
    # The universal SID *S-1-1-0 (Everyone) works on any language edition of Windows
    icacls $targetTmp /grant "*S-1-1-0:(OI)(CI)F" /T /C /Q | Out-Null
    icacls $driveRoot /grant "*S-1-1-0:(OI)(CI)F" /T /C /Q | Out-Null
    Write-Host "[OK] Access rights on $targetTmp configured (Full Control)." -ForegroundColor Green
} catch {
    Write-Warning "Could not update the rights via icacls: $_"
}

# 4. Windows Defender exclusion
if ($isAdmin) {
    Write-Host "[3/4] Adding $driveRoot to the Windows Defender exclusions..." -ForegroundColor Yellow
    try {
        Add-MpPreference -ExclusionPath $driveRoot -ErrorAction SilentlyContinue
        Write-Host "[OK] $driveRoot added to the Defender exclusions." -ForegroundColor Green
    } catch {
        Write-Warning "Could not add to the Windows Defender exclusions."
    }
} else {
    Write-Host "[3/4] The Defender exclusion requires Administrator rights." -ForegroundColor DarkGray
}

# 5. Setting the FORMA_TEST_TMP environment variable
Write-Host "[4/4] Saving the FORMA_TEST_TMP environment variable..." -ForegroundColor Yellow
[Environment]::SetEnvironmentVariable("FORMA_TEST_TMP", $targetTmp, "User")
$env:FORMA_TEST_TMP = $targetTmp

Write-Host "`n[OK] Setup finished successfully!" -ForegroundColor Green
Write-Host "RAM disk $cleanLetter is ready. Tests now fly in main memory.`n"
