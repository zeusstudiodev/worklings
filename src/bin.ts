#!/usr/bin/env node
// The `worklings` command as npm installs it (package.json's bin). It checks Node's version before it loads anything
// else: the CLI's modules need Node 22, and an older Node stops on them with an error that says nothing useful. So this
// file keeps to syntax that every Node from 12 on reads, and loads the CLI only once the version passes.
const needed = 22;
const running = process.versions.node;
if (Number(running.split('.')[0]) < needed) {
  process.stderr.write(
    'Worklings needs Node.js ' + needed + ' or newer, and this is Node.js ' + running + '. ' +
      'Install the current LTS from https://nodejs.org, then run the command again.\n',
  );
  process.exitCode = 1;
} else {
  import('./cli.ts').catch(function (error: unknown) {
    process.stderr.write('Worklings could not start: ' + (error instanceof Error ? error.stack || error.message : String(error)) + '\n');
    process.exitCode = 1;
  });
}
