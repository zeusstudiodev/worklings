// Follows a growing transcript file and turns what was appended into usage events.
import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import type { OfficeEvent } from '../core/events.ts';
import { readUsage, type TranscriptContext, type TranscriptCursor } from '../core/transcript.ts';

const CHUNK = 256 * 1024;
/** The most one tail reads per poll: a long transcript catches up over a few polls instead of blocking hook replies. */
const PER_READ = 16 * 1024 * 1024;

export class TranscriptTail {
  readonly path: string;
  private readonly ctx: Omit<TranscriptContext, 'fallbackTime'>;
  private offset = 0;
  private readonly cursor: TranscriptCursor;
  private decoder = new StringDecoder('utf8');

  /** `seen` can be shared by every tail of a session, so a message is counted once whichever file it shows up in. */
  constructor(path: string, ctx: Omit<TranscriptContext, 'fallbackTime'>, seen = new Set<string>()) {
    this.path = path;
    this.ctx = ctx;
    this.cursor = { pending: '', skipping: false, seen };
  }

  /**
   * Reads what was appended since the last call, up to PER_READ bytes; `more` says whether there is still more to read.
   * A missing file (not written yet) reads as nothing.
   */
  read(now: number): { events: OfficeEvent[]; more: boolean } {
    if (!existsSync(this.path)) return { events: [], more: false };
    const fd = openSync(this.path, 'r');
    try {
      const size = fstatSync(fd).size;
      if (size < this.offset) {
        // The file was replaced or truncated: start over, keeping the seen message ids so nothing counts twice.
        this.offset = 0;
        this.cursor.pending = '';
        this.cursor.skipping = false;
        this.decoder = new StringDecoder('utf8');
      }
      const events: OfficeEvent[] = [];
      const buffer = Buffer.alloc(CHUNK);
      const stop = Math.min(size, this.offset + PER_READ);
      while (this.offset < stop) {
        const n = readSync(fd, buffer, 0, Math.min(CHUNK, stop - this.offset), this.offset);
        if (n <= 0) break;
        this.offset += n;
        for (const event of readUsage(this.decoder.write(buffer.subarray(0, n)), this.cursor, { ...this.ctx, fallbackTime: now })) events.push(event);
      }
      return { events, more: this.offset < size };
    } finally {
      closeSync(fd);
    }
  }
}
