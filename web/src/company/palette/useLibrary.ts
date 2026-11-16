// The role catalogue `/hire` needs to hire a library role straight into a room: the demo carries its own, a live office
// answers `GET /studio`. Asked once `wanted` turns true (the palette opening, the talk bar's box taking focus) and again
// then if it couldn't be read; until it is, the command asks the CEO as before.
import { useEffect, useMemo, useState } from 'react';
import { demoCatalogue } from '../../../../src/core/demo-company.ts';
import type { CatalogRole } from '../../../../src/core/snapshot.ts';
import { companyApiBase, getCatalog } from '../../lib/api.ts';
import { tabToken } from '../useHub.ts';

export function useLibrary(companyId: string, demo: boolean, wanted: boolean): readonly CatalogRole[] | null {
  const [read, setRead] = useState<readonly CatalogRole[] | null>(null);
  const have = read !== null;
  useEffect(() => {
    if (!wanted || have || demo) return;
    let cancelled = false;
    getCatalog(tabToken(), companyApiBase(companyId)).then(
      (c) => {
        const roles: unknown = (c as { library?: unknown }).library;
        if (!cancelled && Array.isArray(roles)) setRead(roles as CatalogRole[]);
      },
      // Not read: the command keeps asking the CEO, and the next time it is wanted the library is asked for again.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [wanted, have, demo, companyId]);
  // The demo carries its own, so it needs no asking.
  const demoRoles = useMemo(() => (demo ? demoCatalogue() : null), [demo]);
  return demoRoles ?? read;
}
