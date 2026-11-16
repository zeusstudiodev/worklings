#!/usr/bin/env node
// npm run build:plugin: builds plugin/runtime from the bundled CLI, dist/web (which npm run build:web has just built)
// and the library, so `claude --plugin-dir ./plugin` runs this checkout. The work is in scripts/plugin-runtime.ts;
// the release step, which builds the web app itself and checks the install, is scripts/release-plugin.ts.
import { buildRuntime } from './plugin-runtime.ts';

const manifest = buildRuntime();
console.log(`plugin runtime ${manifest.version} built in plugin/runtime: ${manifest.files.length} files, ${(manifest.bytes / 1024 / 1024).toFixed(1)} MB`);
