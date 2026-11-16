// The shell's glyphs (docs/design-hud.md, "Icons"): drawn on a 20-unit grid, 1.8 stroke, round caps and joins, in the
// current colour. Never alone without a name: the key around a glyph always carries words or an accessible name.

const PATHS = {
  lobby: 'M6.7 6.3a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0-6.6 0M3.8 17.5c.4-3.6 2.9-6 6.2-6s5.8 2.4 6.2 6z',
  office: 'M10 2.8 17 6.6v6.8L10 17.2 3 13.4V6.6zM3 6.6l7 3.8 7-3.8M10 10.4v6.8',
  progress: 'm3 5.5 1.6 1.6 2.6-3M3 13.5l1.6 1.6 2.6-3M10 6h7M10 14h7M10 10h4.5',
  org: 'M8.2 2.5h3.6a1.2 1.2 0 0 1 1.2 1.2v2.1a1.2 1.2 0 0 1-1.2 1.2H8.2A1.2 1.2 0 0 1 7 5.8V3.7a1.2 1.2 0 0 1 1.2-1.2zM10 7v6M4.5 13v-3h11v3M3.5 13h2a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V14a1 1 0 0 1 1-1zM9 13h2a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V14a1 1 0 0 1 1-1zM14.5 13h2a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V14a1 1 0 0 1 1-1z',
  tasks: 'M7 3.5h9a.5.5 0 0 1 .5.5v9M3.5 6.5h9.5a.5.5 0 0 1 .5.5v6.5l-3 3H4a.5.5 0 0 1-.5-.5zM13.5 13.5h-3v3',
  dashboards: 'M2.5 16.5h15M5 16.5v-5M9 16.5V5.5M13 16.5v-8M16.5 16.5V3.5',
  inbox: 'M3 11.5 5 4.5h10l2 7v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 11.5h4l1 2h4l1-2h4',
  preview: 'M4.5 4h11A1.5 1.5 0 0 1 17 5.5V12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 12V5.5A1.5 1.5 0 0 1 4.5 4zM7.5 17h5M10 13.5V17',
  menu: 'M4 6h12M4 10h12M4 14h12',
  down: 'm6 8 4 4 4-4',
  left: 'm12 5-5 5 5 5',
  close: 'm5 5 10 10M15 5 5 15',
  hide: 'M5 3.5h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM12.5 3.5v13M6.3 8l2 2-2 2',
  panel: 'M5 3.5h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM12.5 3.5v13',
  fit: 'M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4',
  full: 'M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5M3 3l5 5M17 3l-5 5M17 17l-5-5M3 17l5-5',
  exitFull: 'M7.5 3v4.5H3M12.5 3v4.5H17M17 12.5h-4.5V17M3 12.5h4.5V17',
  plus: 'M10 4v12M4 10h12',
  minus: 'M4 10h12',
  check: 'm4.5 10.5 3.5 3.5 7.5-8',
  filter: 'M3 4.5h14l-5.5 6.5v5l-3 1.5v-6.5z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: 16 | 20; className?: string }) {
  return (
    <svg className={`shell-icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
