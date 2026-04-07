@echo off
REM Protobuf code generation script for the project (Windows)
REM This script generates Go and TypeScript code from proto files

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set PROJECT_ROOT=%SCRIPT_DIR%..\..
set PROTO_DIR=%PROJECT_ROOT%\proto
set GO_OUT_DIR=%PROJECT_ROOT%\app\api\go\pb
set TS_OUT_DIR=%PROJECT_ROOT%\lib\pb

echo 📦 Generating Protobuf code...
echo Proto directory: %PROTO_DIR%
echo Go output: %GO_OUT_DIR%
echo TS output: %TS_OUT_DIR%

REM Create output directories
if not exist "%GO_OUT_DIR%" mkdir "%GO_OUT_DIR%"
if not exist "%TS_OUT_DIR%" mkdir "%TS_OUT_DIR%"

REM Generate Go code
echo 🔨 Generating Go code from .proto files...
cd /d "%PROTO_DIR%"

for %%f in (*.proto) do (
  echo   Processing: %%f
  protoc ^
    --go_out="%GO_OUT_DIR%" ^
    --go_opt=paths=source_relative ^
    %%f
)

echo ✅ Go code generated successfully!

REM Generate TypeScript code
echo 🔨 Generating TypeScript code from .proto files...
for %%f in (*.proto) do (
  echo   Processing: %%f
  protoc ^
    --ts_out="%TS_OUT_DIR%" ^
    --ts_opt="target=web,client_none" ^
    %%f
)

echo ✅ TypeScript code generated successfully!
echo ✨ All protobuf code generation complete!

pause
