---
title: Electron and Tauri
department: engineering
stacks: [electron, tauri]
paths:
  - "electron/**"
  - "src/main/**"
  - "src/preload/**"
  - "main/**"
  - "preload/**"
  - "src-tauri/**"
  - "forge.config.{js,ts}"
  - "electron-builder.{yml,json}"
---
- Check the installed Electron or Tauri version; Electron ships a major every eight weeks, and Tauri 2 reworked Tauri 1's APIs.
- Electron renderers keep `contextIsolation` and the sandbox on and `nodeIntegration` off; never relax them to make code work.
- Preload scripts expose a small API through `contextBridge`: named functions, never `ipcRenderer` itself or a generic send.
- The main process validates every IPC call: the sender's frame and origin, the arguments, and whether the action is allowed.
- Privileged windows load only bundled content; block unexpected navigation and new windows.
- Open external links in the system browser, and only after checking the URL's scheme.
- Give every window a strict Content Security Policy.
- Tauri: grant each window only the capabilities and scopes it needs; keep file-system and shell scopes narrow.
- Tauri commands validate their arguments and return errors as `Result`; never panic on user input.
- Keep the main process and UI thread free: heavy work goes to utility processes, workers or async Rust.
- Store app data in the platform's app-data directory, never next to the executable; keep secrets in the OS keychain.
- Build paths with the platform's path APIs, and test paths with spaces and non-ASCII characters on Windows, macOS and Linux.
- Follow each platform's conventions for menus, shortcuts (Cmd on macOS, Ctrl elsewhere), tray icons and window controls.
- Remember window size and position, and handle several displays and DPI scaling.
- Use a single-instance lock, and validate deep links and file-open arguments like any other input.
- Updates come only through the framework's updater with signed artifacts; never download and run unsigned code.
- Code signing, and notarisation on macOS, are part of every release build; unsigned builds trigger OS warnings.
- Write logs and crash reports to a file people can find and send.
- Test the packaged app, not only dev mode; paths, permissions and packaging differ.
