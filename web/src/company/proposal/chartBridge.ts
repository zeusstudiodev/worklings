// The proposal panel and its chart are drawn in different places (the panel in the side panel, the chart as the Org
// board over the map), so the panel publishes what the chart needs here and the chart reads it as it changes.
import { useSyncExternalStore } from 'react';
import type { OrgProposal } from '../../../../src/core/org.ts';
import type { Chart } from './model.ts';

export class Bridge<T> {
  private value: T | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get = (): T | null => this.value;

  set(value: T | null) {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}

export function useBridge<T>(bridge: Bridge<T>): T | null {
  return useSyncExternalStore(bridge.subscribe, bridge.get);
}

/** What the proposal's chart draws, published by the proposal panel. */
export interface ProposalChartValue {
  proposal: OrgProposal;
  chart: Chart;
  /** The person whose form is open in the panel. */
  selected: string | null;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onAdd: (room: string) => void;
  onAddRoom: () => void;
  onStart: () => void;
  /** Why Start waits; null when it can be pressed. */
  startBlocked: string | null;
  starting: boolean;
  /** "About $3 an hour at API prices; on Pro or Max it counts against your limits."; null without an estimate. */
  cost: string | null;
  /** v0.2: the preset the company is sized to, "Balanced, 5 at work at once"; null where the hub carries no spending plan. */
  plan?: string | null;
}

export const proposalChart = new Bridge<ProposalChartValue>();
