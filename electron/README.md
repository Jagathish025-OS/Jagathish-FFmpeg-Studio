# Jagathish FFmpeg Studio — Windows desktop

This Electron shell reuses the React/Vite interface and runs a bundled native FFmpeg executable on the user's computer. Media is read from local paths and output is written beside the source files.

## Requirements
- Windows 10/11 64-bit for the packaged installer
- Node.js 20 or newer to build from source
- Internet access during initial dependency installation; media processing itself is offline

## Development
```bash
npm install
npm run desktop:dev
```

## Build Windows installer
```bash
npm run desktop:dist
```
The installer is written to `release/`. The GitHub Actions workflow also builds it on Windows and uploads the installer as a workflow artifact.

## Privacy and safety
The renderer has context isolation and no Node integration. Only a small, explicit IPC bridge is exposed. FFmpeg runs as a child process. Files are not sent to Jagathish.online or Render. Outputs are written to the source file's folder with a `-jagathish-` suffix. Ensure adequate free disk space before processing large videos.
