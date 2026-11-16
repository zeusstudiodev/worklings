// Reads OpenTelemetry logs (OTLP/HTTP JSON) from Claude Code and keeps the exact cost of each API request.
import { type OfficeEvent, safeId } from '../core/events.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function attributeValue(v: unknown): string | number | boolean | undefined {
  if (!isObj(v)) return undefined;
  if (typeof v.stringValue === 'string') return v.stringValue;
  if (typeof v.doubleValue === 'number') return v.doubleValue;
  if (typeof v.intValue === 'number') return v.intValue;
  if (typeof v.intValue === 'string') return Number(v.intValue);
  if (typeof v.boolValue === 'boolean') return v.boolValue;
  return undefined;
}

function attributes(list: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (!isObj(item) || typeof item.key !== 'string') continue;
    const value = attributeValue(item.value);
    if (value !== undefined) out[item.key] = value;
  }
  return out;
}

/** `claude_code.api_request` log records -> cost events. Everything else in the payload is ignored. */
export function costEventsFromOtlp(payload: unknown, now: number): OfficeEvent[] {
  const events: OfficeEvent[] = [];
  if (!isObj(payload) || !Array.isArray(payload.resourceLogs)) return events;
  for (const resource of payload.resourceLogs) {
    if (!isObj(resource)) continue;
    const resourceAttrs = attributes(isObj(resource.resource) ? resource.resource.attributes : undefined);
    for (const scope of Array.isArray(resource.scopeLogs) ? resource.scopeLogs : []) {
      if (!isObj(scope)) continue;
      for (const record of Array.isArray(scope.logRecords) ? scope.logRecords : []) {
        if (!isObj(record)) continue;
        const attrs = { ...resourceAttrs, ...attributes(record.attributes) };
        const body = isObj(record.body) ? attributeValue(record.body) : undefined;
        const name = attrs['event.name'] ?? body;
        if (name !== 'api_request' && name !== 'claude_code.api_request') continue;
        const cost = Number(attrs.cost_usd);
        const sessionId = safeId(attrs['session.id']);
        if (!Number.isFinite(cost) || !sessionId) continue;
        const nanos = typeof record.timeUnixNano === 'string' ? Number(record.timeUnixNano.slice(0, -6)) : NaN;
        const event: OfficeEvent = { kind: 'cost', at: Number.isFinite(nanos) ? nanos : now, sessionId, costUsd: cost };
        const agentId = safeId(attrs.agent_id);
        if (agentId) event.agentId = agentId;
        if (typeof attrs.model === 'string') event.model = attrs.model;
        events.push(event);
      }
    }
  }
  return events;
}
