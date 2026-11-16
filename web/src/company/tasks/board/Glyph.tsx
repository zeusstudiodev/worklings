// The board's glyphs, drawn as design-hud's set is (a 20-unit grid, 1.8 stroke, round caps and joins, currentColor).
// Every glyph is decorative: the words beside it, or its key's name, say what it means.

const PATHS = {
  flag: 'M5.5 17.5V3.5M5.5 4.2h8.6l-2 3.4 2 3.4H5.5',
  dots: 'M4.6 10h.01M10 10h.01M15.4 10h.01',
  check: 'M5 10.5l3.2 3.1L15 6.8',
  plus: 'M10 4v12M4 10h12',
  filter: 'M3.5 5h13l-5 6.2v4.6l-3 1.4v-6z',
  search: 'M8.6 3.6a5 5 0 1 0 0 10a5 5 0 1 0 0-10M12.3 12.3l4.2 4.2',
  up: 'M6 12l4-4 4 4',
  down: 'M6 8l4 4 4-4',
  top: 'M5.5 5h9M6 14l4-4 4 4',
  bottom: 'M5.5 15h9M6 6l4 4 4-4',
  pick: 'M10 15V4.5M6.5 8l3.5-3.5L13.5 8M5 16.5h10',
  pause: 'M7.5 5v10M12.5 5v10',
  resume: 'M7 4.8l8 5.2-8 5.2z',
  person: 'M6.7 6.3a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0-6.6 0M3.8 17.5c.4-3.6 2.9-6 6.2-6s5.8 2.4 6.2 6',
  close: 'M5.5 5.5l9 9M14.5 5.5l-9 9',
  open: 'M8 5l5 5-5 5',
  caret: 'M6 8l4 4 4-4',
} as const;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, className = 'tb-glyph' }: { name: GlyphName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} strokeWidth={name === 'dots' ? 3 : undefined} />
    </svg>
  );
}
