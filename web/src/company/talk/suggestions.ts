// Before the start (docs/design-v3.md, "Before the start"): the proposal's suggestions take the strip's place and fill
// the talk bar's box, which talks to the CEO until the company starts. The same three as the proposal's own box offers;
// `caret` puts the caret inside the words, where the specialist's name goes.
export const SUGGESTIONS: readonly { label: string; text: string; caret?: number }[] = [
  { label: 'Merge design and UX', text: 'Merge design and UX into one room.' },
  { label: 'Add a … specialist', text: 'Add a  specialist.', caret: 6 },
  { label: 'Fewer people', text: 'Make the org smaller: fewer people.' },
];
