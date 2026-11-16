// The org a CEO drafted for "a bilingual café website with pickup orders" (SPEC-v3.md, facts checked, point 4): 18
// people in four rooms under three heads, with a TWINT payments engineer written for the company and local SEO
// tailored from the library. Each call gives a fresh copy for a test to change.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseStudio, type Studio } from '../src/core/studio.ts';

export const CAFE_PROMPT = 'A bilingual café website with pickup orders, paid with TWINT';

export const TWINT_ROLE = {
  description:
    "Builds and fixes TWINT payments for pickup orders: the checkout's payment step, the payment provider's API and webhooks, refunds and the daily reconciliation, in Swiss francs. Use for anything that takes or returns money.",
  body: [
    "You are the company's TWINT payments engineer. Customers pay for their pickup orders with TWINT, Switzerland's",
    'mobile payment app, so a payment that is lost or taken twice leaves a real person out of pocket.',
    '',
    '## Mission',
    "Take every pickup order's payment exactly once, refund it exactly once when asked, and keep the café's records in",
    "step with the payment provider's.",
    '',
    '## You own',
    "- The checkout's payment step, and the TWINT flow on phones (a switch to the app) and on desktops (a QR code).",
    "- The calls to the payment provider: creating, confirming and refunding payments, with their timeouts.",
    "- The provider's webhooks: checking their signatures, and handling duplicates and events that arrive out of order.",
    "- Reconciliation: matching each payment to its order and to the café's daily payout.",
    "- Not yours: prices and the menu (the backend engineer's), and how the checkout looks (design's).",
    '',
    '## How you work',
    "1. Read the provider's documentation for the API version the project uses; never assume a field or a status.",
    '2. Keep money as whole rappen with its currency, never as a floating-point number.',
    "3. Give every payment an idempotency key tied to its order, so a retried request can't charge twice.",
    '4. Treat webhooks as untrusted: check the signature, fetch the payment from the provider yourself, and make a',
    '   replayed event change nothing.',
    '5. Put a timeout on every call to the provider and decide what the customer sees when it is down: the order waits,',
    '   and it is never marked paid on a guess.',
    "6. Test in the provider's test mode: a paid order, a cancelled payment, a timeout, a refund and a duplicate webhook.",
    "7. Log each payment's state changes with the order id, never account details.",
    '',
    '## Watch for',
    '- An order marked paid before the provider confirms it.',
    "- Refunds that can run twice, or partial refunds that don't add up.",
    '- Amounts that drift between the order, the payment and the payout.',
    '',
    '## Done means',
    '- Paid, cancelled, timed-out and refunded orders all end in the right state in test mode.',
    '- A replayed webhook changes nothing.',
    "- The day's payments reconcile with its orders to the rappen.",
  ].join('\n'),
  tags: ['payments', 'twint', 'switzerland'],
};

type Raw = Record<string, unknown>;

const person = (id: string, name: string, title: string, level: string, room: string, reportsTo: string | null, model: string, owns: string, extra: Raw): Raw => ({
  id,
  name,
  title,
  level,
  room,
  reportsTo,
  model,
  owns,
  ...extra,
});

/** The café org, as the CEO would send it with propose_org. */
export function cafeProposal() {
  return {
    company: 'Café Lumen',
    goal: 'A bilingual website for Café Lumen where customers browse the menu, order ahead for pickup and pay with TWINT.',
    size: 'large',
    sizing: 'Eighteen people: a bilingual site with pickup orders and TWINT payments needs design, engineering and content, each with a head.',
    theme: 'cafe',
    rooms: [
      { id: 'direction', title: 'Direction', style: 'direction' },
      { id: 'design', title: 'Design', style: 'design', theme: 'cafe' },
      { id: 'engineering', title: 'Engineering', style: 'engineering' },
      { id: 'content', title: 'Content', style: 'content' },
    ],
    people: [
      person('ceo', 'Noor', 'CEO', 'ceo', 'direction', null, 'opus', 'The company, its goal and the line to the stakeholder', { library: 'ceo', look: { prop: 'clipboard' } }),
      person('office-manager', 'Tia', 'Office manager', 'worker', 'direction', 'ceo', 'haiku', 'The office: rooms, theme, decor and looks', { library: 'office-manager' }),
      person('product-manager', 'Mira', 'Product manager', 'worker', 'direction', 'head-of-design', 'sonnet', 'The stories for ordering ahead and what the first release holds', { library: 'product-manager' }),
      person('head-of-design', 'Ada', 'Head of design', 'head', 'design', 'ceo', 'opus', 'The brand, the menu pages and the pickup flow', {
        library: 'head',
        notes: ['Nothing in design ships without a check at phone size.'],
      }),
      person('ux-designer', 'Lea', 'UX designer', 'worker', 'design', 'head-of-design', 'sonnet', 'The ordering flow from the menu to pickup, with every state', { library: 'ux-designer' }),
      person('ui-designer', 'Kai', 'UI designer', 'worker', 'design', 'head-of-design', 'sonnet', 'The visual system and the menu photography', { library: 'ui-designer', look: { skin: 3, prop: 'tablet' } }),
      person('head-of-engineering', 'Ben', 'Head of engineering', 'head', 'engineering', 'ceo', 'opus', 'The site, the orders and the payments', { library: 'head' }),
      person('frontend-lead', 'Ola', 'Frontend lead', 'lead', 'engineering', 'head-of-engineering', 'sonnet', "The site's pages and the order form", { library: 'frontend-engineer' }),
      person('frontend-engineer', 'Sam', 'Frontend engineer', 'worker', 'engineering', 'frontend-lead', 'sonnet', 'The menu and order pages', { library: 'frontend-engineer' }),
      person('backend-engineer', 'Ivo', 'Backend engineer', 'worker', 'engineering', 'head-of-engineering', 'sonnet', 'Orders, pickup slots and the menu data', { library: 'backend-engineer' }),
      person('twint-payments-engineer', 'Lina', 'TWINT payments engineer', 'worker', 'engineering', 'head-of-engineering', 'opus', 'TWINT payments for pickup orders, refunds and reconciliation', {
        role: structuredClone(TWINT_ROLE),
      }),
      person('devops-engineer', 'Rui', 'DevOps engineer', 'worker', 'engineering', 'head-of-engineering', 'haiku', 'Hosting, deploys and the domain', { library: 'devops-engineer' }),
      person('qa-engineer', 'Tom', 'QA engineer', 'worker', 'engineering', 'head-of-engineering', 'sonnet', 'Testing orders end to end on phones', { library: 'qa-engineer' }),
      person('accessibility-specialist', 'Eli', 'Accessibility specialist', 'worker', 'engineering', 'head-of-engineering', 'sonnet', 'Keyboard, screen reader and contrast on every page', {
        library: 'accessibility-specialist',
      }),
      person('head-of-content', 'Eva', 'Head of content', 'head', 'content', 'ceo', 'sonnet', 'The words in both languages and local search', { library: 'head' }),
      person('copywriter', 'Lena', 'Copywriter', 'worker', 'content', 'head-of-content', 'sonnet', 'The menu, the pages and the order emails, German first', { library: 'copywriter' }),
      person('localization-specialist', 'Jon', 'Localization specialist', 'worker', 'content', 'head-of-content', 'sonnet', 'The English site and the switch between the two languages', {
        library: 'localization-specialist',
        notes: ['The site is in German and English; German is the default.'],
      }),
      person('local-seo-specialist', 'Pia', 'Local SEO specialist', 'worker', 'content', 'head-of-content', 'sonnet', 'Local search: the business profile, maps, opening hours and reviews', {
        library: 'seo-specialist',
        notes: ['Local search matters most here: the Google Business Profile, maps and opening hours.'],
      }),
    ] as Raw[],
    questions: [
      { text: 'Which payments should pickup orders take?', options: ['TWINT only', 'TWINT and cards', 'Cards only'], recommended: 1 },
      { text: 'Which language does the site open in?', options: ['German', 'English'], recommended: 0 },
    ],
  };
}

/** The proposal's person with this id, to change in a test. */
export function personOf(proposal: ReturnType<typeof cafeProposal>, id: string): Raw {
  const found = proposal.people.find((p) => p.id === id);
  if (!found) throw new Error(`no ${id} in the café org`);
  return found;
}

export function studioOf(root: string): Studio {
  const parsed = parseStudio(readFileSync(join(root, '.claude/studio.yaml'), 'utf8'));
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  return parsed.studio;
}

export const read = (root: string, path: string): string => readFileSync(join(root, path), 'utf8');
