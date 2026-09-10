# scripts/build-native-win.ps1
#
# Compiles the original offzip / packzip C sources into standalone Windows
# binaries and drops them into bin\win32-x64\. Run this after placing the
# original .c files under native\offzip\src and native\packzip\src.
#
# Prereqs (either one):
#   - MSVC: run this from a "Developer PowerShell for VS" so cl.exe is on PATH.
#   - MinGW-w64: gcc.exe on PATH (e.g. via MSYS2 `pacman -S mingw-w64-x86_64-gcc`).
#
# Both offzip and packzip link against zlib. Point ZLIB_DIR at a folder
# containing zlib.h/zconf.h and a prebuilt zlib static lib (zlibstatic.lib for
# MSVC, libz.a for MinGW), e.g. one built from https://zlib.net or installed
# via vcpkg (`vcpkg install zlib:x64-windows-static`).

param(
    [string]$ZlibDir = "$PSScriptRoot\..\native\zlib"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path "$PSScriptRoot\.."
$outDir = Join-Path $root "bin\win32-x64"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Get-CSources($tool) {
    $srcDir = Join-Path $root "native\$tool\src"
    if (-not (Test-Path $srcDir)) {
        throw "No sources found in $srcDir -- copy the original $tool .c/.h files there first."
    }
    $files = Get-ChildItem -Path $srcDir -Filter *.c
    if ($files.Count -eq 0) {
        throw "$srcDir has no .c files. See native\$tool\README.md."
    }
    return $files.FullName
}

function Build-WithMsvc($tool, $sources) {
    Write-Host "Building $tool with MSVC (cl.exe)..." -ForegroundColor Cyan
    $outExe = Join-Path $outDir "$tool.exe"
    $includeDir = Join-Path $root "native\$tool\src"
    $args = @(
        "/nologo", "/O2", "/W3",
        "/I", $includeDir,
        "/I", $ZlibDir
    ) + $sources + @(
        "/Fe:$outExe",
        "/link", "/LIBPATH:$ZlibDir", "zlibstatic.lib"
    )
    & cl.exe @args
    if ($LASTEXITCODE -ne 0) { throw "cl.exe failed for $tool (exit $LASTEXITCODE)" }
}

function Build-WithMingw($tool, $sources) {
    Write-Host "Building $tool with MinGW (gcc)..." -ForegroundColor Cyan
    $outExe = Join-Path $outDir "$tool.exe"
    $includeDir = Join-Path $root "native\$tool\src"
    $args = @(
        "-O2", "-o", $outExe,
        "-I", $includeDir,
        "-I", $ZlibDir
    ) + $sources + @(
        "-L", $ZlibDir, "-lz", "-static"
    )
    & gcc @args
    if ($LASTEXITCODE -ne 0) { throw "gcc failed for $tool (exit $LASTEXITCODE)" }
}

function Build-Tool($tool) {
    $sources = Get-CSources $tool
    if (Get-Command cl.exe -ErrorAction SilentlyContinue) {
        Build-WithMsvc $tool $sources
    } elseif (Get-Command gcc.exe -ErrorAction SilentlyContinue) {
        Build-WithMingw $tool $sources
    } else {
        throw "Neither cl.exe (MSVC) nor gcc.exe (MinGW) was found on PATH."
    }
    Write-Host "-> $tool.exe written to $outDir" -ForegroundColor Green
}

Build-Tool "offzip"
Build-Tool "packzip"

Write-Host "`nDone. Run each binary with no arguments to print its usage/help text," -ForegroundColor Yellow
Write-Host "then verify src/main/engine.js's flag maps match what you see." -ForegroundColor Yellow
