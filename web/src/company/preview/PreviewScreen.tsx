// The office's screen (for the art stream's 3D screen): the live app while the screen is on camera on a desktop, else
// the latest screenshot people shared, else a still line. The app is the preview's own sandboxed frame, inert, so the
// pointer, the keyboard and screen readers pass it by; a press anywhere on the screen opens the full preview. It fills
// the box it is put in and draws the app at a desktop's width, shrunk to fit.
import { useEffect, useRef, useState } from 'react';
import type { CompanyView } from '../../../../src/core/company.ts';
import { AppFrame, useFrameBlocked } from './AppFrame.tsx';
import { previewAddress, screenShows } from './previewModel.ts';
import './preview.css';

/**
 * Under this many CSS px a side, the screen is too small to point at or to see a focus ring on (WCAG 2.5.8, 2.4.11): on
 * a phone it is a few pixels under the front desk's sign. The bar's Company menu opens the same preview, so the screen's
 * own button leaves the keyboard and the accessibility tree until the screen is big enough.
 */
export const MIN_SCREEN_TARGET = 24;

/** The width the app lays out at on the screen before it is shrunk to fit: a laptop's. */
const SCREEN_WIDTH = 1280;

interface PreviewScreenProps {
  company: Pick<CompanyView, 'name' | 'preview' | 'screenshots'>;
  screenshotUrl: (shot: string) => string;
  /** On camera on a desktop: the live app may run. Off camera, on phones and with reduced data, a screenshot. */
  live: boolean;
  /** Opens the full preview (the company's `preview` address). */
  onOpen: () => void;
}

export function PreviewScreen({ company, screenshotUrl, live, onOpen }: PreviewScreenProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // How big the screen is on the page: the office scales it with the camera, so its laid-out size is not its size.
  const [shown, setShown] = useState(false);
  const address = previewAddress(company.preview, window.location);
  const blocked = useFrameBlocked(address?.ok ? address.origin : null);
  const shows = screenShows(company.preview, address, live && !blocked, company.screenshots);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    // The camera moves without the box's layout changing, so the size on the page is read now and then, cheaply.
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setShown(rect.width >= MIN_SCREEN_TARGET && rect.height >= MIN_SCREEN_TARGET);
    };
    measure();
    const id = window.setInterval(measure, 400);
    return () => {
      observer.disconnect();
      window.clearInterval(id);
    };
  }, []);

  const scale = size.width > 0 ? size.width / SCREEN_WIDTH : 0;
  return (
    <div ref={box} className="preview-screen">
      {shows.kind === 'app' && scale > 0 && (
        <div className="preview-screen__app" style={{ width: SCREEN_WIDTH, height: size.height / scale, transform: `scale(${scale})` }}>
          <AppFrame href={shows.href} title={`${company.name}'s app`} still />
        </div>
      )}
      {shows.kind === 'shot' && <img className="preview-screen__shot" src={screenshotUrl(shows.shot.id)} alt="" decoding="async" />}
      {shows.kind === 'idle' && (
        <p className="preview-screen__line" aria-hidden="true">
          {shows.line}
        </p>
      )}
      <button type="button" className="preview-screen__open" onClick={onOpen} inert={!shown}>
        <span className="visually-hidden">Preview the app</span>
      </button>
    </div>
  );
}
