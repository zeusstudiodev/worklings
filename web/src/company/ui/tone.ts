// The tones a state pill takes (StatePill.tsx), in a module of their own so pure view logic can name them.

/**
 * working: someone is on it (a green dot). needs: it waits on you (highlighter fill, the house's "needs you").
 * waiting: queued for a desk or a turn. error: stuck, failed, can't run. rest: resting or paused. done: finished.
 * neutral: idle, off duty, stopped, drafting.
 */
export type StateTone = 'working' | 'needs' | 'waiting' | 'error' | 'rest' | 'done' | 'neutral';
