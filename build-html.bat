@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ==================================================
echo  ストリップ勇者伝 - 単体HTMLビルドツール
echo ==================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [エラー] Node.js が見つかりませんでした。
  echo Node.js ^(LTS^) をインストールしてから再度実行してください。
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/2] 初回のみ依存パッケージをインストールしています...
  call npm install
  if errorlevel 1 (
    echo.
    echo [エラー] npm install に失敗しました。
    pause
    exit /b 1
  )
)

echo [2/2] 単体HTMLファイルを生成しています...
call npm run build:html
if errorlevel 1 (
  echo.
  echo [エラー] HTMLビルドに失敗しました。
  pause
  exit /b 1
)

echo.
echo ==================================================
echo  完了しました！
echo  出力先: %~dp0dist\strip-hero.html
echo  このHTMLファイルをダブルクリックするだけで遊べます。
echo ==================================================
echo.
pause
