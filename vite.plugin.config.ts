import { defineConfig } from 'vite';
import { thirdPartyNotices } from './scripts/third-party-notices.ts';

// Bundles the CLI and its dependencies into one file for the Claude Code plugin, so the plugin runs with nothing but
// Node installed. scripts/build-plugin.mjs puts the web app and the library next to it.
export default defineConfig({
  build: {
    ssr: 'src/cli.ts',
    outDir: 'plugin/runtime',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    // The office's look at a running app (src/company/app-look.ts) imports Playwright only where it is installed, and says
    // so where it isn't; the plugin leaves that import to run time rather than bundle a browser driver.
    rolldownOptions: { external: ['@playwright/test'], output: { entryFileNames: 'cli.mjs', format: 'es' } },
  },
  plugins: [thirdPartyNotices('cli')],
  ssr: { noExternal: true },
});
