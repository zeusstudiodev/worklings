// A theme as a small picture: its floor and its accent (docs/game-feel.md, "Themes"). The lobby's phone rows show it
// at 56 px in place of the 3D world; Customize uses the same colours for its swatches.
import type { CSSProperties } from 'react';
import type { Theme } from '../../../../src/core/looks.ts';

/** Each theme's floor, the colour of its building, and a mark dark enough to stand on the panel (3:1 or better). */
export const THEME_SWATCH: Record<Theme, { floor: string; accent: string; mark: string; pattern: 'tiles' | 'checks' | 'boards' | 'grass' | 'stars' }> = {
  office: { floor: '#e7e2d6', accent: '#8a9a92', mark: '#6b7a73', pattern: 'tiles' },
  cafe: { floor: '#2b2b2b', accent: '#c99a6b', mark: '#7a5236', pattern: 'checks' },
  'game-studio': { floor: '#5a4636', accent: '#e9a36b', mark: '#a8632c', pattern: 'boards' },
  shop: { floor: '#d9b98c', accent: '#5b8fc7', mark: '#3f72a8', pattern: 'boards' },
  lab: { floor: '#f4f6f8', accent: '#5b8fc7', mark: '#2f7f7a', pattern: 'tiles' },
  garden: { floor: '#7fa65f', accent: '#efe8da', mark: '#4e7a47', pattern: 'grass' },
  city: { floor: '#9a9d9f', accent: '#e2bf4f', mark: '#6c7174', pattern: 'tiles' },
  arcade: { floor: '#2a2340', accent: '#e58fa0', mark: '#b5456a', pattern: 'stars' },
  'music-studio': { floor: '#4a3426', accent: '#d9625b', mark: '#a8423a', pattern: 'boards' },
};

export function ThemeStill({ theme, size = 56 }: { theme: Theme; size?: number }) {
  const swatch = THEME_SWATCH[theme] ?? THEME_SWATCH.office;
  return (
    <span
      className={`theme-still theme-still--${swatch.pattern}`}
      style={{ '--floor': swatch.floor, '--accent': swatch.accent, '--size': `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      <span className="theme-still__house" />
    </span>
  );
}
