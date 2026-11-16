// The static web demo's addresses: the app's own router (company/router.ts) under the base path the site is served from,
// /worklings/ on GitHub Pages. The site build gives every import of the app's router this module instead
// (vite.config.ts), so the views keep writing their own addresses ("/c/demo/inbox", "/c/demo?panel=people/kai", "/")
// and the address bar shows them under the base, their query kept. Whatever doesn't touch the address bar passes
// through as it is; at the base "/", so does the rest.
import { useMemo } from 'react';
import * as app from '../company/router.ts';
import { underBase } from './base.ts';

export * from '../company/router.ts';

export const { toUrl, toApp } = underBase(import.meta.env.BASE_URL);

/** A company's address under the base: links show it, and navigate and goBack take it as well as the app's own form. */
export const companyPath = (company: string, sub = ''): string => toUrl(app.companyPath(company, sub));

export const companyHref = (company: string, route: app.CompanyRoute): string => toUrl(app.companyHref(company, route));

export function navigate(address: string, options?: app.NavigateOptions) {
  app.navigate(toUrl(address), options);
}

export function goBack(to: string) {
  app.goBack(toUrl(to));
}

export function backToOpener(fallback: string) {
  app.backToOpener(toUrl(fallback));
}

/** The address as the app's router keeps it, with the base taken off its path and the entry before's; the query passes as it is. */
export function useLocation(): app.Location {
  const location = app.useLocation();
  return useMemo(() => ({ ...location, path: toApp(location.path), prev: location.prev === null ? null : toApp(location.prev) }), [location]);
}
