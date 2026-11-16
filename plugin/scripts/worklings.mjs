// Starts the Worklings CLI that ships with the plugin (runtime/cli.mjs) once it has what it needs, so a missing piece
// gets one plain sentence instead of a stack trace. bin/worklings and bin/worklings.cmd run this file with node.
// Kept to syntax and APIs that Node 16 and later understand, so an old Node reaches the version check.
import { existsSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const NODE_MAJOR = 22;

if (Number(process.versions.node.split('.')[0]) < NODE_MAJOR) {
  process.stderr.write(
    `Worklings needs Node.js ${NODE_MAJOR} or later, and this is ${process.version}. Install a newer one from https://nodejs.org/, then start Claude Code again.\n`,
  );
  process.exit(1);
}

const cli = fileURLToPath(new URL('../runtime/cli.mjs', import.meta.url));
if (!existsSync(cli)) {
  process.stderr.write(
    'This copy of the Worklings plugin has no runtime. Reinstall it with `claude plugin install worklings@worklings`; in a clone of the repository, build it with `npm run build:plugin`.\n',
  );
  process.exit(1);
}

await import(pathToFileURL(cli).href);
