@echo off
setlocal
cd /d "%~dp0"
title Groupe GTA - Serveur local

echo ============================================================
echo    GROUPE GTA - Demarrage du serveur local
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable sur cette machine.
  echo Installez-le depuis https://nodejs.org puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

if not exist ".env.local" (
  echo [ATTENTION] Le fichier .env.local est absent :
  echo la connexion se fera en mode hors-ligne uniquement.
  echo.
)

rem --- Le serveur tourne-t-il deja sur le port 3000 ? ---
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:3000/page/formulaire.html' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul

if errorlevel 1 (
  echo Demarrage du serveur...
  start "GTA serveur local" /min cmd /c "node scripts\local-server.js"
  timeout /t 3 /nobreak >nul
) else (
  echo Le serveur est deja en cours d'execution.
)

echo Ouverture de la page de connexion dans le navigateur...
start "" "http://127.0.0.1:3000/page/formulaire.html"

echo.
echo ------------------------------------------------------------
echo   Page de connexion : http://127.0.0.1:3000/page/formulaire.html
echo.
echo   Administrateur absolu  :  ceejay  /  yajeec
echo   Admin secondaire       :  lepere  /  peregta
echo ------------------------------------------------------------
echo.
echo IMPORTANT : ne double-cliquez PAS les fichiers .html du dossier page.
echo Ils s'ouvriraient en mode hors-ligne (bandeau rouge en bas de page).
echo.
echo Laissez cette fenetre ouverte pendant l'utilisation du site.
echo Pour arreter le serveur, fermez la fenetre "GTA serveur local".
echo.
pause
endlocal
