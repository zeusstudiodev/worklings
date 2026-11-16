// How the HUD reaches the 3D stage without holding it (docs/design-v3.md, "The office view", "Boards over the map"): the
// map keys' Fit, Zoom in and Zoom out, and the mini-map's window and marks, where the stage lays the live office while a
// board is open. One per shell (useStageCamera), handed to the Stage and to the MiniMap; calls made before a stage draws,
// or after it failed, do nothing.
import { useState } from 'react';
import type { MiniMark, MiniVariant } from '../company/shell/frameModel.ts';

/** What a mounted stage does for the keys. */
export interface CameraDriver {
  /** The camera's fit, eased over 350 ms; at once with reduced motion. */
  fit(): void;
  /** One step in (1) or out (-1); false at the camera's limit, or while the office isn't the main view. */
  zoom(direction: 1 | -1): boolean;
}

/** What the mini-map draws over the live office, and the form it takes in the main view. */
export interface MiniMarks {
  /** The bar pill's word: "Working", "Resting until 14:00", "Paused by you". */
  pill: string;
  mark: MiniMark;
  /** The count of what needs you; 0 shows none. */
  needs: number;
  variant: MiniVariant;
}

export class StageCamera {
  private driver: CameraDriver | null = null;
  private view: HTMLElement | null = null;
  private marks: MiniMarks | null = null;
  private version = 0;
  private readonly listeners = new Set<() => void>();

  /** Fit the office in view (the map keys' Fit). */
  fit(): void {
    this.driver?.fit();
  }

  /**
   * A step of about 1.25 times in or out, toward whoever is open in the side panel (the stage's selection), else the
   * middle of the labels' area. Returns false where nothing moved: at the camera's limit, or with no office to zoom.
   */
  zoom(direction: 1 | -1): boolean {
    return this.driver?.zoom(direction) ?? false;
  }

  /** Whether a stage is drawing. Without one (no WebGL, or the 3D view failed) there is no mini-map. */
  get live(): boolean {
    return this.driver !== null;
  }

  /** The stage, while it is mounted; returns what takes it away. */
  attach(driver: CameraDriver): () => void {
    this.driver = driver;
    this.emit();
    return () => {
      if (this.driver !== driver) return;
      this.driver = null;
      this.emit();
    };
  }

  /** A ref for the mini-map's window: the stage lays the canvas over it while a board is open. */
  readonly miniView = (el: HTMLElement | null): void => {
    if (el === this.view) return;
    this.view = el;
    this.emit();
  };

  get miniViewElement(): HTMLElement | null {
    return this.view;
  }

  /** The mini-map's marks and form, from the MiniMap; null while there is none. */
  setMarks(marks: MiniMarks | null): void {
    const was = this.marks;
    if (was === marks || (was && marks && was.pill === marks.pill && was.mark === marks.mark && was.needs === marks.needs && was.variant === marks.variant)) return;
    this.marks = marks;
    this.emit();
  }

  get miniMarks(): MiniMarks | null {
    return this.marks;
  }

  /** For useSyncExternalStore: a listener, and a number that changes with every change. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly snapshot = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const listener of [...this.listeners]) listener();
  }
}

/** The shell's one StageCamera, kept for the shell's life. */
export function useStageCamera(): StageCamera {
  const [camera] = useState(() => new StageCamera());
  return camera;
}
