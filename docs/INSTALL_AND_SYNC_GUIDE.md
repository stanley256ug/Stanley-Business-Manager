# STANLEY BUSINESS MANAGER — Installation, Packaging & Cloud Sync Guide

This guide explains how **STANLEY BUSINESS MANAGER** operates across **Web/PWA**, **Windows Desktop (Electron + SQLite)**, and **Android Mobile (Capacitor)** with full offline operation and Firebase Cloud Synchronization.

---

## 1. Architecture Overview

- **Local Persistence (Windows & Web Server)**: SQLite (`better-sqlite3`) stored safely in `./data/stanley_business.db` (or `%APPDATA%\STANLEY BUSINESS MANAGER\data\stanley_business.db` on Windows Desktop).
- **Offline Browser & Mobile Outbox**: IndexedDB (`stanley_business_offline_db`) stores a complete encrypted-origin local snapshot plus a duplicate-safe outbox queue (`client_sync_id`).
- **Cloud Sync & Backup**: Firebase Authentication (Google Sign-In) + Cloud Firestore (`/workspaces/{uid}/...`) synchronizes settings, products, customers, orders, sales/receipts, and expenses across your Windows PC and Android phone.

---

## 2. Offline-First Operation & Duplicate Prevention

When you have no internet connection:
1. You can **record sales**, **generate electronic receipts**, **record expenses**, **register customers**, **create/update orders**, and **view reports**.
2. Every offline record is assigned a unique `client_sync_id` and saved immediately to local IndexedDB.
3. Receipt numbers increment sequentially offline and are preserved when synced back online.
4. When internet connectivity returns, pending operations flush automatically without deleting any local business records—even if a sync attempt fails mid-way.

---

## 3. Cloud Sync Between Windows & Android

1. Open **Settings & Security** in **STANLEY BUSINESS MANAGER**.
2. In **Cloud Synchronization & Offline Queue**, click **Connect Google Account** and sign in with your Google account.
3. On your first device (e.g., Windows PC), click **Push to Cloud** to upload your studio catalog, receipts, customers, orders, and expenses.
4. On your second device (e.g., Android smartphone), connect the same Google account and click **Pull & Merge**.
5. Any offline transactions queued on either device are merged idempotently using `client_sync_id`.

---

## 4. Building Standalone Windows Installers (`.exe`, `.msi`, Portable)

Requirements on a Windows 10/11 build machine (or via `.github/workflows/release-builds.yml`):
- Node.js 22+
- Visual Studio Build Tools (for native `better-sqlite3` addon compilation)

```bash
# 1. Install dependencies and compile frontend + backend bundle
npm ci
npm run build

# 2. Install Electron packager and rebuild better-sqlite3 for Electron
cd electron
npm install
npx electron-rebuild -f -w better-sqlite3 -m ..
cd ..

# 3. Build Windows NSIS Setup (.exe), Windows Installer (.msi), and Portable (.exe)
npx --prefix electron electron-builder --config electron-builder.yml --win nsis msi portable
```

Output installers are written to `release/windows/`:
- `StanleyBusinessManager-Setup-1.0.0-x64.exe` (creates Desktop & Start Menu shortcuts + Uninstaller)
- `StanleyBusinessManager-1.0.0-x64.msi` (enterprise Windows Installer package)
- `StanleyBusinessManager-Portable-1.0.0-x64.exe` (no installation required)

---

## 5. Building Android APK & Google Play App Bundle (`.aab`)

Requirements (Android Studio / Linux CI runner with Java 17 + Android SDK, or via `.github/workflows/release-builds.yml`):
- Minimum supported OS: **Android 8.0 (API 26)**

```bash
# 1. Build the production web bundle
npm ci
npm run build

# 2. Add and sync Capacitor Android project
npm install --no-save @capacitor/core @capacitor/cli @capacitor/android @capacitor/splash-screen
npx cap add android
npx cap sync android

# 3. Copy splash graphic & permissions from android-templates/
cp public/pwa-512x512.png android/app/src/main/res/drawable/splash.png
# Merge android-templates/AndroidManifest.permissions.xml and minSdkVersion=26 in android/variables.gradle

# 4. Generate a release keystore (first time only)
keytool -genkey -v -keystore stanley-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias stanley

# 5. Build Release APK (direct install) & AAB (Google Play Store)
cd android
./gradlew assembleRelease bundleRelease
```

Outputs:
- Direct install APK: `android/app/build/outputs/apk/release/app-release.apk`
- Play Store Bundle: `android/app/build/outputs/bundle/release/app-release.aab`

---

## 6. Installing Immediately as a Standalone App (PWA)

Even without running the native CI builders, Chrome/Edge on Windows 10/11 and Chrome on Android can install **STANLEY BUSINESS MANAGER** directly via the **Install App** button inside the sidebar or top header.

---

## 7. Security & Keyboard Shortcuts

- **Inactivity Auto-Lock**: Configurable in **Settings & Security** (`5m`, `15m`, `30m`, `1h`, or `Disabled`).
- **Desktop Keyboard Shortcuts**:
  - `Alt + N` — New Sale & Receipt
  - `Alt + E` — New Expense
  - `Alt + O` — New Order
  - `Alt + C` — New Customer
  - `Alt + D` — Dashboard
  - `Alt + R` — Receipts
  - `Alt + P` — Print Active Receipt
