import { parse } from 'yaml';

export interface MarkdownDoc {
  data: Record<string, unknown>;
  body: string;
  /** Set when the frontmatter was not valid YAML and the line-based fallback was used. */
  warning?: string;
}

const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Splits a Markdown file into frontmatter and body. Community agent files often have unquoted colons in their
 * descriptions, which is invalid YAML, so a failed parse falls back to reading top-level `key: value` lines.
 */
export function parseFrontmatter(text: string): MarkdownDoc {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const match = FENCE.exec(source);
  if (!match) return { data: {}, body: source };
  const raw = match[1] ?? '';
  const body = source.slice(match[0].length);
  try {
    const data = parse(raw) as unknown;
    if (data && typeof data === 'object' && !Array.isArray(data)) return { data: data as Record<string, unknown>, body };
    return { data: {}, body, warning: 'frontmatter is not a mapping' };
  } catch (error) {
    const data: Record<string, unknown> = {};
    for (const line of raw.split(/\r?\n/)) {
      const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
      if (kv?.[1]) data[kv[1]] = (kv[2] ?? '').replace(/^["']|["']$/g, '');
    }
    return { data, body, warning: `frontmatter is not valid YAML (${(error as Error).message.split('\n')[0]}); read it line by line` };
  }
}

/** Reads a frontmatter value that may be a string or a YAML list of strings (as `tools` and `paths` can be). */
export function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
}
