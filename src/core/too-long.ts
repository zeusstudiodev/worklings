// What a person reads when text they sent is over a limit. A model can't count characters: told only "the most is
// 4,000" it trims a little and sends the whole thing again, with its whole context, several times over (a real run
// retried one report seven times). So the sentence says the length, the limit and how much to cut, with room to spare.
// Pure, with no Node APIs.

const n = (value: number): string => value.toLocaleString('en-US');

/**
 * How much to cut to land under `max`: what is over, a sixth more (a cut measured by eye comes out short) and a little
 * for limits where that is nothing, rounded up to a number a person would say. Text many times its limit is told
 * what it is over by, to the character, since a rounded cut could ask for more than there is.
 */
export function cutAbout(length: number, max: number): number {
  const over = length - max;
  const need = over * 1.15 + Math.min(30, max * 0.02);
  const step = need <= 50 ? 10 : need < 200 ? 50 : need < 2_000 ? 100 : 1_000;
  const cut = Math.ceil(need / step) * step;
  return cut < length ? cut : over;
}

/** "summary is 4,667 characters; the limit is 4,000: cut about 800." */
export function tooLong(what: string, length: number, max: number): string {
  return `${what} is ${n(length)} characters; the limit is ${n(max)}: cut about ${n(cutAbout(length, max))}.`;
}
