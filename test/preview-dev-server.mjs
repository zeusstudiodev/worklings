// A stand-in for a project's dev server (Vite and the like) for test/preview.test.ts. It listens on localhost only, as
// Vite does (on Windows that is ::1 alone), and never touches the network. Run as
// `node preview-dev-server.mjs <mode> [lifeline port]`:
//   serve   listens at a free port and prints its address as Vite 8 does on Windows: coloured, the port in bold inside
//           the URL, the line written in two pieces, after a debugger line with a ws:// address the office must not take
//   tree    the same, plus a child process of its own (mode child) that never ends, to show stopping kills the tree
//   silent  prints nothing and never ends
//   exit    prints an error and exits with code 3
//   https   prints only an https address, and never ends
//   child   the process tree starts: does nothing and never ends
// With a lifeline port, each process except exit's connects to 127.0.0.1 there once it is running, sends one JSON line
// {project (its folder's name), role (server or child), pid, port}, waits for the test's "ok" before it prints anything,
// and keeps the connection open, so the test knows it runs before the office can act on it, and sees it end (the system
// closes the connection when the process goes).
// HTTP: GET / is a page and sets a cookie; /echo answers with the method, path, headers and body it got, as JSON, and
// sets a cookie; /moved redirects to /echo at its own address. WebSocket at /hmr: says "hello", then answers each text
// message with "echo: <text>".
// Every mode gives up after five minutes, so a test run that dies can't leave it behind for long.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const GIVE_UP_MS = 5 * 60_000;
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const mode = process.argv[2] ?? 'serve';
const lifelinePort = Number(process.argv[3] ?? 0);
setTimeout(() => process.exit(0), GIVE_UP_MS);

/** Says hello on the lifeline and resolves once the test has answered; at once without a lifeline. */
function lifeline(role, port = null) {
  if (!lifelinePort) return Promise.resolve();
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: lifelinePort });
    // The test has gone already: there is nobody left to tell.
    socket.on('error', () => {
      socket.destroy();
      resolve();
    });
    socket.once('data', () => resolve());
    socket.write(`${JSON.stringify({ project: basename(process.cwd()), role, pid: process.pid, port })}\n`);
  });
}

/** A WebSocket text frame from the server: unmasked, short. */
function frame(text) {
  const payload = Buffer.from(text, 'utf8');
  const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  return Buffer.concat([header, payload]);
}

function hmr(req, socket) {
  if (req.url !== '/hmr' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
    return;
  }
  const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}${WEBSOCKET_GUID}`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.write(frame('hello'));
  let buffer = Buffer.alloc(0);
  // One frame from the client (always masked), or null until all of it has arrived.
  const take = () => {
    if (buffer.length < 2) return null;
    const opcode = buffer[0] & 0x0f;
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) return null;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      socket.destroy(); // the tests never send anything this big
      return null;
    }
    const mask = offset;
    offset += 4;
    if (buffer.length < offset + length) return null;
    const data = Buffer.from(buffer.subarray(offset, offset + length));
    for (let i = 0; i < data.length; i++) data[i] ^= buffer[mask + (i % 4)];
    buffer = buffer.subarray(offset + length);
    return { opcode, text: data.toString('utf8') };
  };
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (let message = take(); message; message = take()) {
      if (message.opcode === 8) {
        socket.end();
        return;
      }
      if (message.opcode === 1) socket.write(frame(`echo: ${message.text}`));
    }
  });
  socket.on('error', () => socket.destroy());
}

function serve() {
  let port = 0;
  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'session=from-the-app; Path=/' });
      res.end('<!doctype html><title>Fake app</title><h1>Hello from the fake app</h1>');
      return;
    }
    if (req.url === '/moved') {
      res.writeHead(302, { location: `http://localhost:${port}/echo?from=moved` });
      res.end();
      return;
    }
    if (req.url?.startsWith('/echo')) {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'set-cookie': 'tracker=1; Path=/' });
        res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }));
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });
  server.on('upgrade', hmr);
  server.listen(0, 'localhost', async () => {
    port = server.address().port;
    if (mode === 'tree') spawn(process.execPath, [fileURLToPath(import.meta.url), 'child', String(lifelinePort)], { stdio: 'ignore' });
    await lifeline('server', port);
    process.stderr.write('Debugger listening on ws://127.0.0.1:9229/0f4ce5e5-0000-4000-8000-00000000c1a0\n');
    process.stdout.write('\n  \u001b[32m\u001b[1mVITE\u001b[22m v8.3.5\u001b[39m  \u001b[2mready in \u001b[0m\u001b[1m42\u001b[22m\u001b[2m\u001b[0m ms\u001b[22m\n\n');
    process.stdout.write('  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:');
    setTimeout(() => {
      process.stdout.write(`\u001b[1m${port}\u001b[22m/\u001b[39m\n\u001b[2m  \u001b[32m➜\u001b[39m  \u001b[1mNetwork\u001b[22m\u001b[2m: use \u001b[22m\u001b[1m--host\u001b[22m\u001b[2m to expose\u001b[22m\n`);
    }, 20);
  });
}

if (mode === 'exit') {
  console.error('Error: the fake dev server failed on purpose');
  process.exit(3);
} else if (mode === 'silent') {
  await lifeline('server');
} else if (mode === 'https') {
  await lifeline('server');
  console.log('  ➜  Local:   https://localhost:5999/');
} else if (mode === 'child') {
  await lifeline('child');
} else {
  serve();
}
