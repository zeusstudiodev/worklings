// Made-up answers and catch-ups for the demo office, which never calls Claude Code. They follow the demo's script
// (src/server/demo.ts): a small mobile-app studio adds a watering streak to the home screen in two and a half minutes.
import { suggestedIndex } from '../core/aside.ts';

/** Per demo person, an answer to each suggested question, in SUGGESTED_QUESTIONS order. */
const ANSWERS: Record<string, readonly [string, string, string]> = {
  lead: [
    "I'm getting the watering streak onto the home screen, with a small celebration at seven days. The UX designer specced the card, the mobile engineer builds it, and I keep the gates in order.",
    "Testing on a small screen and with large text, the accessibility and code gates, and a line in the changelog. Then it's ready for you to look at.",
    "Nothing on my side. The mobile engineer needed your OK to install expo-haptics, and once that's through the rest is testing.",
  ],
  'ux-designer': [
    'I designed the streak card and the seven-day celebration: a flame icon, the day count and gentle confetti at seven. The spec is in docs/streak-card.md.',
    "Nothing for me now: the spec is done and the UI designer checked it against the design system. I'd like a look at the card once it's on screen.",
    'No, nothing is in my way.',
  ],
  'ui-designer': [
    'I checked the streak spec against the design system, and it passes: it reuses the flame icon, the colours and the spacing scale.',
    "Nothing: my check is done. If the celebration grows past confetti, I'd want another look.",
    'Nothing is blocking me.',
  ],
  'mobile-engineer': [
    "I'm building the streak card on the home screen, with a haptic tap when a plant reaches seven days.",
    "Wiring the haptic tap into the card and running the tests again. The typecheck failure on the plant's streak field is fixed.",
    'I need your OK to install expo-haptics, and the haptic tap waits on it.',
  ],
  copywriter: [
    'I wrote the streak copy: the title, the day count, the celebration line and the empty state.',
    'Nothing: the four strings are in the English locale file.',
    "No, I'm done and nothing is in the way.",
  ],
  Explore: [
    'I looked for where plant data is cached on the device. It lives in lib/storage.ts under the key plants:v2.',
    'Nothing: I reported back to the lead.',
    'Nothing: it was a quick search.',
  ],
  'qa-engineer': [
    "I'm testing the streak on a small screen and with large text, and adding a regression test for it.",
    "Seeing the run pass at 375px and at 200% text, then reporting back. The regression test is written.",
    'Nothing so far.',
  ],
  'accessibility-specialist': [
    "I'm running the accessibility gate on the streak card: labels, roles and contrast.",
    'Not much: labels and roles are set and the contrast is 4.8:1, so it passes.',
    'No, nothing is blocking me.',
  ],
};

export const DEMO_FREE_TEXT = "This is the demo, so I can't really read your question. In a live office I'd answer from my own session.";

/** A demo person's sample answer: the scripted one for a suggested question, the free-text line for anything else. */
export function demoAnswer(person: string, question: string): string {
  const index = suggestedIndex(question);
  const answers = Object.hasOwn(ANSWERS, person) ? ANSWERS[person] : undefined;
  return (index >= 0 ? answers?.[index] : undefined) ?? DEMO_FREE_TEXT;
}

/** The catch-up of the moment, by how far into its loop the demo is (seconds). */
export function demoDigest(seconds: number): string {
  if (seconds < 20) {
    return 'The lead is planning your watering streak for the home screen and has briefed the UX designer, who is designing the streak card and the seven-day celebration. Nobody needs you yet.';
  }
  if (seconds < 45) {
    return 'The UX designer finished the streak card spec, and the UI designer checked it against the design system: it passes. The mobile engineer is building the card and the copywriter is writing its strings. Nobody needs you.';
  }
  if (seconds < 64) {
    return 'The copywriter added the streak strings, and the Explore agent found where plant data is cached. The mobile engineer fixed a typecheck error and needs your OK to install expo-haptics for the seven-day tap. The rest is still going.';
  }
  if (seconds < 104) {
    return 'The mobile engineer built the streak card with a haptic tap at seven days, and typecheck and tests pass. The QA engineer is testing it on a small screen and with large text, and the accessibility specialist is running the accessibility gate. Nobody needs you.';
  }
  return 'Your watering streak is in: designed, built, tested at 375px and with large text, and through the design, accessibility and code gates. The QA engineer added a regression test. Nobody needs you and nothing is stuck.';
}
