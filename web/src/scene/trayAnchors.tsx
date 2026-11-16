// Each desk's note tray as a label anchor (`tray:<person>`), so Send's flight can ask where it is on the page. The
// anchors have no label of their own: the projector only places labels that exist.
import { useContext, useEffect } from 'react';
import { Vector3 } from 'three';
import { LabelContext } from './labels.tsx';
import { COMPANY_DESK, type Layout } from './layout.ts';

export function TrayAnchors({ layout }: { layout: Layout }) {
  const store = useContext(LabelContext);
  useEffect(() => {
    const desks = layout.office?.byPerson;
    if (!store || !desks) return;
    const ids: string[] = [];
    for (const [person, desk] of desks) {
      const id = `tray:${person}`;
      store.anchors.set(id, { point: new Vector3(desk.tray.x, COMPANY_DESK.top + 0.03, desk.tray.z) });
      ids.push(id);
    }
    return () => {
      for (const id of ids) store.anchors.delete(id);
    };
  }, [store, layout]);
  return null;
}
