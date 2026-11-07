# scripts/setup-ramdisk.ps1
# Автоматическая настройка RAM-диска для быстрого выполнения тестов протокола Forma
# Рекомендуется запускать в PowerShell от имени Администратора.

[CmdletBinding()]
param (
    [string]$DriveLetter = "R:",
    [string]$Size = "4G",
    [string]$TmpFolder = "forma-tmp"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Настройка адаптивного RAM-диска Forma ===" -ForegroundColor Cyan

# 1. Проверка прав администратора
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "Скрипт запущен без прав Администратора. Некоторые шаги могут потребовать повышенных привилегий."
}

$driveRoot = if ($DriveLetter.EndsWith(":")) { "$DriveLetter\" } else { "$DriveLetter:\" }
$cleanLetter = $DriveLetter.TrimEnd('\')

# 2. Если диск уже существует
if (Test-Path $driveRoot) {
    Write-Host "[1/4] ✓ Диск $cleanLetter уже смонтирован и готов." -ForegroundColor Green
} else {
    # Проверяем OSFMount или ImDisk
    $osfmountCli = "C:\Program Files\OSFMount\OSFMount.com"
    if (-not (Test-Path $osfmountCli) -and -not (Get-Command "imdisk" -ErrorAction SilentlyContinue)) {
        Write-Host "[1/4] Установка утилиты виртуального диска через winget..." -ForegroundColor Yellow
        try {
            Start-Process winget -ArgumentList "install PassMark.OSFMount --silent --accept-source-agreements --accept-package-agreements" -Wait -NoNewWindow
        } catch {
            Write-Warning "Не удалось установить через winget автоматически."
        }
    }

    if (Test-Path $osfmountCli) {
        Write-Host "[1/4] Создание RAM-диска через OSFMount..." -ForegroundColor Yellow
        & $osfmountCli -a -t vm -m $cleanLetter -o "format:ntfs:`"RAMDISK`",rw" -s $Size
    } elseif (Get-Command "imdisk" -ErrorAction SilentlyContinue) {
        Write-Host "[1/4] Создание RAM-диска через ImDisk..." -ForegroundColor Yellow
        imdisk -a -s $Size -m $cleanLetter -p "/fs:ntfs /q /y"
    } else {
        Write-Error "Не найдена утилита для создания RAM-диска (OSFMount или ImDisk)."
        exit 1
    }
    Write-Host "✓ RAM-диск $cleanLetter успешно смонтирован." -ForegroundColor Green
}

# 3. Создание рабочей папки и выдача универсальных прав
$targetTmp = Join-Path $driveRoot $TmpFolder
Write-Host "[2/4] Настройка папки $targetTmp и прав доступа..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $targetTmp | Out-Null
try {
    # Универсальный SID *S-1-1-0 (Все / Everyone) работает на любых языковых версиях Windows
    icacls $targetTmp /grant "*S-1-1-0:(OI)(CI)F" /T /C /Q | Out-Null
    icacls $driveRoot /grant "*S-1-1-0:(OI)(CI)F" /T /C /Q | Out-Null
    Write-Host "✓ Права доступа на $targetTmp настроены (Full Control)." -ForegroundColor Green
} catch {
    Write-Warning "Не удалось обновить права через icacls: $_"
}

# 4. Исключение из Защитника Windows
if ($isAdmin) {
    Write-Host "[3/4] Добавление $driveRoot в исключения Защитника Windows..." -ForegroundColor Yellow
    try {
        Add-MpPreference -ExclusionPath $driveRoot -ErrorAction SilentlyContinue
        Write-Host "✓ $driveRoot добавлен в исключения Defender." -ForegroundColor Green
    } catch {
        Write-Warning "Не удалось добавить в исключения Windows Defender."
    }
} else {
    Write-Host "[3/4] Для исключения из Защитника требуются права Администратора." -ForegroundColor DarkGray
}

# 5. Установка переменной среды FORMA_TEST_TMP
Write-Host "[4/4] Сохранение переменной среды FORMA_TEST_TMP..." -ForegroundColor Yellow
[Environment]::SetEnvironmentVariable("FORMA_TEST_TMP", $targetTmp, "User")
$env:FORMA_TEST_TMP = $targetTmp

Write-Host "`n✓ Настройка завершена успешно!" -ForegroundColor Green
Write-Host "RAM-диск $cleanLetter готов к работе. Тесты теперь летают в оперативной памяти.`n"
