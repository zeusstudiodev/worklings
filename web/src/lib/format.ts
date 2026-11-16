// Number and time formatting for the HUD: tokens and dollars are money, so they read like money.

export function tokens(n: number): string {
  if (n < 1000) return `${Math.round(n)}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
}

export function dollars(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return '<$0.01';
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function rate(perHour: number): string {
  return perHour < 0.005 ? '$0/h' : `${dollars(perHour)}/h`;
}

export function percent(share: number): string {
  if (share <= 0) return '0%';
  if (share < 0.01) return '<1%';
  return `${Math.round(share * 100)}%`;
}

export function ago(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** "14:32" (or "2:32 PM"): a time of day to the minute. */
export function hourMinute(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * When something happened, to sit beside a fact: "at 14:32" today, "yesterday at 14:32", "on Mon 3 Nov at 14:32" before
 * that (with the year when it isn't this one). A bare time says nothing about which day it was.
 */
export function whenAt(at: number, now: number = Date.now()): string {
  const time = hourMinute(at);
  const day = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return `at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  const d = new Date(at);
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }) }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('weekday')} ${get('day')} ${get('month')}${get('year') ? ` ${get('year')}` : ''}`;
  return `on ${date} at ${time}`;
}

/** An estimate in words, before a call: "Less than 1¢" under half a cent, "About 2¢", "About $1.20". */
export function aboutCost(dollarsAmount: number): string {
  const cents = dollarsAmount * 100;
  if (cents < 0.5) return 'Less than 1¢';
  if (cents < 99.5) return `About ${Math.round(cents)}¢`;
  return `About $${dollarsAmount.toFixed(2)}`;
}

/** What a call cost, as Claude Code reports it: "0.4¢" under 10¢, then "14¢", then "$1.20"; never "0¢" for a cost. */
export function spent(dollarsAmount: number): string {
  const cents = dollarsAmount * 100;
  // A call that cost something never reads as nothing.
  if (cents > 0 && cents < 0.05) return 'less than 0.1¢';
  if (cents < 9.95) return `${Number(cents.toFixed(1))}¢`;
  if (cents < 99.5) return `${Math.round(cents)}¢`;
  return `$${dollarsAmount.toFixed(2)}`;
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
