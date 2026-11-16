// The static web demo's addresses under the base path the site is served from (/worklings/ on GitHub Pages): an app
// address ("/c/demo?panel=people/kai") as the address bar shows it, and back. Pure, for tests; router.ts uses it.

export interface UnderBase {
  /** An app address under the base, its query and hash kept. One under it already stays as it is. */
  toUrl: (address: string) => string;
  /** The app address an address bar's names: its path without the base, its query and hash kept. */
  toApp: (address: string) => string;
}

export function underBase(base: string): UnderBase {
  /** The base without its last slash: "/worklings", or "" for a site at the root of its domain. */
  const root = base.replace(/\/$/, '');
  const isUnder = (path: string) => root === '' || path === root || path.startsWith(`${root}/`);
  return {
    toUrl: (address) => {
      const end = address.search(/[?#]/);
      return isUnder(end < 0 ? address : address.slice(0, end)) ? address : `${root}${address}`;
    },
    toApp: (address) => {
      const end = address.search(/[?#]/);
      const path = end < 0 ? address : address.slice(0, end);
      return root !== '' && isUnder(path) ? `${path.slice(root.length) || '/'}${end < 0 ? '' : address.slice(end)}` : address;
    },
  };
}
