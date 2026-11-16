// The demo café's earlier messages, older than any its view carries: Café Lumen's first day, from the goal to the menu
// pages going live, for the feed's "Show earlier lines". The demo hub pages through them as the hub pages through what a
// company keeps (src/core/message-pages.ts), and there are enough of them to page through twice. Made up, in the café's
// voice, and the same for the same `now`. The story keeps to the café's log and tasks (src/core/demo-company.ts): the
// rest on the plan's limit, Lena hired six hours ago, Sam let go after, the photos dropped, the menu live three hours ago.
import { type Message, STAKEHOLDER } from '../../../src/core/company.ts';
import type { Ack } from '../../../src/core/steering.ts';
import { capital } from '../../../src/core/words.ts';

const MIN = 60_000;

/** In minutes ago: the first line, just after the goal was set; the rest on the plan's limit; the newest line. */
const FIRST = 1520;
const REST = { from: 1320, to: 1140 };
const NEWEST = 195;
const BEFORE_REST = FIRST - REST.from;
/** The day's working minutes, on which every line is placed, so none falls in the rest. */
const DAY = BEFORE_REST + (REST.to - NEWEST);
const agoAt = (work: number): number => (work < BEFORE_REST ? FIRST - work : REST.to - (work - BEFORE_REST));
const workAt = (ago: number): number => (ago > REST.from ? FIRST - ago : BEFORE_REST + (REST.to - ago));

const YOU = STAKEHOLDER;
const CEO = 'ceo';
const OTTO = 'office-manager';
const ADA = 'head-of-design';
const MINA = 'ui-designer';
const JULES = 'ux-designer';
const PIA = 'brand-designer';
const THEO = 'head-of-engineering';
const INES = 'web-lead';
const KAI = 'frontend-engineer';
const NOAH = 'backend-engineer';
const SOFIA = 'twint-payments-engineer';
const MARCO = 'devops-engineer';
const CLARA = 'head-of-content';
const LENA = 'german-copywriter';
const TOM = 'local-seo-specialist';
const RAVI = 'qa-engineer';

/**
 * One line of a conversation. `of` passes on an earlier line of it, with the passer's `note`; `re` answers one (it
 * cites it); `ack` is the CEO's acknowledgement of one of your lines.
 */
interface Line {
  from: string;
  to: string;
  text: string;
  of?: number;
  note?: string;
  re?: number;
  ack?: string;
}

/** A conversation, starting `at` minutes ago. */
interface Scene {
  at: number;
  lines: Line[];
}

/** Conversations of one kind, spread over a stretch of the day from `from` to `to` minutes ago. */
interface Round {
  from: number;
  to: number;
  scenes: Line[][];
}

const line = (from: string, to: string, text: string, extra: Omit<Line, 'from' | 'to' | 'text'> = {}): Line => ({ from, to, text, ...extra });
/** Passes on line `of` of the same conversation, its words unchanged. */
const pass = (from: string, to: string, of: number, note: string): Line => ({ from, to, text: '', of, note });
/** The i-th of a few ways to say it, so a round of the same work doesn't read the same each time. */
const nth = <T>(options: readonly [T, ...T[]], i: number): T => options[i % options.length] ?? options[0];

/** The day's conversations at the moments the café's log and tasks put them. */
function story(): Scene[] {
  return [
    { at: 1519, lines: [
      line(CEO, ADA, 'The goal is set: guests order online, pay with TWINT and pick up at the counter. The menu pages come first, and design sets the look.'),
      line(ADA, CEO, 'Understood. Mina takes the layout, Jules the order of things and Pia the icons.'),
    ] },
    { at: 1517, lines: [
      line(CEO, THEO, 'Menu pages first, then pickup orders. Could the menu be on the work branch by tomorrow evening?'),
      line(THEO, CEO, 'Yes, once we have the price list. Ines leads the web work and Marco sets up previews.'),
    ] },
    { at: 1513, lines: [
      line(CEO, CLARA, 'Everything in German and English, German first: most guests are locals.'),
      line(CLARA, CEO, "Then I'll write the English from the German, not the other way round. The menu comes first."),
    ] },
    { at: 1508, lines: [
      line(CEO, OTTO, 'Could the office feel like the job? A café, if you can.'),
      line(OTTO, CEO, 'On it: a chalkboard menu, a pastry case and an espresso machine. Design sits by the window.'),
    ] },
    { at: 1506, lines: [
      line(YOU, CEO, "The café's price list is in the project folder as price-list.pdf: 46 items.", { ack: 'Passing it to Theo for the menu data.' }),
      pass(CEO, THEO, 0, 'For the menu data, please.'),
      line(CEO, YOU, 'Thank you. Noah turns it into the menu data today.', { re: 0 }),
    ] },
    { at: 1498, lines: [
      line(INES, NOAH, "Please turn the café's price list into typed menu data, with allergens and prices in francs."),
      line(NOAH, INES, 'On it. Some drinks come in two sizes; I keep both prices.'),
      line(INES, NOAH, 'Good. Call the sizes what the café calls them: small and large.'),
    ] },
    { at: 1494, lines: [
      line(ADA, MINA, 'Lay out the menu page: coffee, pastries and lunch, with prices and allergens. It has to read well on a 320 px phone.'),
      line(MINA, ADA, 'Starting from the chalkboard in the café: cream chalk on dark slate, one accent for prices.'),
    ] },
    { at: 1488, lines: [
      line(ADA, JULES, 'What does a guest look for first on the menu?'),
      line(JULES, ADA, "The price, and whether it's there today. Then what's in it, for allergies."),
      line(ADA, JULES, 'Please write that down for Mina.'),
      line(JULES, MINA, 'For each item: name and price on one line, then what is in it, then the allergens.'),
    ] },
    { at: 1478, lines: [
      line(THEO, MARCO, 'Please put the work branch on a preview address, so everyone can see the menu on a phone.'),
      line(MARCO, THEO, 'The preview is up. It rebuilds on every commit to the work branch.'),
    ] },
    { at: 1466, lines: [
      line(INES, SOFIA, 'Pickup orders pay with TWINT. Start reading the docs now, so we are ready after the menu.'),
      line(SOFIA, INES, "Reading them. The sandbox wants a merchant ID per shop; I've asked TWINT for a test one."),
    ] },
    { at: 1452, lines: [
      line(ADA, PIA, 'We need small icons for the allergens and for vegan, in chalk lines.'),
      line(PIA, ADA, 'Sketching them now: gluten, nuts, milk, egg and vegan first.'),
    ] },
    { at: 1424, lines: [
      line(NOAH, INES, "All 46 items are in the data. Three prices on the list don't match the chalkboard in the café's photo."),
      line(INES, THEO, "Three prices differ between the café's list and its chalkboard: the Nussgipfel, the chai latte and the soup. Could Mara ask?"),
      line(THEO, CEO, 'The price list and the chalkboard disagree on three prices: the Nussgipfel, the chai latte and the soup. Could you ask which is right?'),
      line(CEO, YOU, "Three prices differ between the café's list and its chalkboard: the Nussgipfel, the chai latte and the soup. Which are right?"),
      line(YOU, CEO, "The chalkboard is right: the list is last year's.", { ack: "Telling Theo: the chalkboard's prices stand." }),
      pass(CEO, THEO, 4, "The chalkboard's prices stand."),
      line(THEO, INES, "Use the chalkboard's prices: the list is last year's."),
      line(INES, NOAH, 'The chalkboard is right for those three. Please use its prices.'),
      line(NOAH, INES, 'Done: all 46 items, with allergens and prices in francs.'),
    ] },
    { at: 1362, lines: [
      line(MINA, ADA, 'The first layout of the menu page is on the preview: three sections, prices on the right.'),
      line(ADA, MINA, 'Lovely. At 320 px the prices need more room: try them under the name.'),
    ] },
    // The company rested on the plan's limit from 1320 to 1140 minutes ago.
    { at: 1138, lines: [
      line(CEO, THEO, 'We are back after the rest. Where do the menu pages stand?'),
      line(THEO, CEO, 'The data is in and the layout is half done. Kai starts on the item cards now.'),
    ] },
    { at: 1128, lines: [
      line(INES, KAI, 'The menu cards are yours: one card per item from the menu data, in the layout Mina made.'),
      line(KAI, INES, 'Starting with coffee, then pastries, then lunch.'),
    ] },
    { at: 1004, lines: [
      line(YOU, CEO, 'The owner wants the Rüeblitorte on the menu every day, not only at weekends.', { ack: 'Asking Theo to show it every day.' }),
      pass(CEO, THEO, 0, 'A change to the menu data.'),
      line(THEO, INES, 'The Rüeblitorte goes on the menu every day, not only at weekends.'),
      line(INES, NOAH, "Please take the weekend mark off the Rüeblitorte: it's on every day now."),
      line(NOAH, INES, 'Done.'),
      line(THEO, CEO, 'The Rüeblitorte shows every day now.'),
      line(CEO, YOU, 'Done: the Rüeblitorte is on the menu every day now.', { re: 0 }),
    ] },
    { at: 902, lines: [
      line(YOU, CEO, 'Please show prices with CHF in front, the way the café writes them.', { ack: 'Passing it to Theo for the cards.' }),
      pass(CEO, THEO, 0, 'For the menu cards.'),
      line(THEO, INES, 'Prices get CHF in front, as the café writes them.'),
      line(INES, KAI, 'Every price gets CHF in front, please.'),
      line(KAI, INES, 'Done: every card says CHF before the price now.'),
      line(CEO, YOU, 'Done: every price on the menu has CHF in front.', { re: 0 }),
    ] },
    { at: 812, lines: [
      line(CLARA, CEO, 'I write the German and the English alone. The German needs a native writer before the launch.'),
      line(CEO, CLARA, "Agreed. I'll hire a German copywriter today."),
    ] },
    { at: 788, lines: [
      line(INES, THEO, 'The coffee cards are done. Pastries next.'),
      line(THEO, INES, 'Thanks. Ravi starts checking the coffee section.'),
    ] },
    { at: 760, lines: qaWithFix('coffee section', 'at 200% text the two prices of a drink overlap', 'the sizes stack under the name at large text now.') },
    { at: 702, lines: [
      line(YOU, CEO, 'Keep the hand-drawn feel, but the prices must be easy to read.', { ack: 'Telling Ada: chalk for headings, a plain face for prices.' }),
      pass(CEO, ADA, 0, 'Please keep the chalk where it helps.'),
      line(ADA, MINA, 'Chalk for the headings only; prices and times in the plain face.'),
      line(MINA, ADA, "Done on the preview. It's much easier to read."),
      line(CEO, YOU, 'Ada has it: chalk for the headings, a plain face for prices and times.', { re: 0 }),
    ] },
    { at: 600, lines: qaPasses('opening hours page') },
    { at: 522, lines: [
      line(YOU, CEO, 'I tried the preview on my phone: the menu looks lovely.', { ack: 'Telling the team.' }),
      line(CEO, ADA, 'Alex tried the menu on a phone and loves it. Please thank Mina and Pia for me.'),
      line(ADA, MINA, 'Alex loves the menu on the phone. Thank you, from Mara too.'),
      line(CEO, THEO, 'Alex loves the menu on the phone. Thanks to Kai and the team.'),
    ] },
    { at: 438, lines: [
      line(INES, THEO, 'The pastry cards are done. Lunch next.'),
      line(THEO, INES, 'Good. Ravi takes the pastries section.'),
    ] },
    { at: 425, lines: qaWithFix('pastries section', 'the allergen icons have no names for a screen reader', 'every icon has its name now: gluten, nuts, milk, egg and vegan.') },
    { at: 418, lines: [
      line(CEO, CLARA, 'How is the copy keeping up with the cards?'),
      line(CLARA, CEO, 'The English is. The German waits for the copywriter.'),
    ] },
    { at: 372, lines: qaWithFix('allergens list', 'at 320 px the list scrolls sideways', 'the list stacks on small phones, and nothing scrolls sideways.') },
    { at: 359, lines: [
      line(CEO, CLARA, 'Lena starts now: a German copywriter, in your team.'),
      line(CLARA, CEO, 'Wonderful, thank you.'),
      line(CLARA, LENA, 'Welcome, Lena! The German menu descriptions are yours: every item, Swiss spelling, two sentences at most.'),
      line(LENA, CLARA, 'Thank you! Starting with the pastries: they need the most words.'),
    ] },
    { at: 346, lines: [
      line(YOU, CEO, 'Do we need the social media manager before the launch?', { ack: "Not before the launch; I'll explain." }),
      line(CEO, YOU, "No: nobody posts until the launch. I'll let Sam go now and hire again when we're close.", { re: 0 }),
    ] },
    { at: 312, lines: [
      line(YOU, CEO, 'The café sends its own photos next week, so nobody needs to make them.', { ack: 'Telling Ada to stop the photos.' }),
      pass(CEO, ADA, 0, 'Please stop the photos.'),
      line(ADA, PIA, 'Please stop the photos: the café sends its own next week.'),
      line(PIA, ADA, 'Stopped. The menu icons are done too.'),
    ] },
    { at: 256, lines: [
      line(INES, THEO, 'All the menu cards are in. Kai fixes whatever Ravi finds.'),
      line(THEO, INES, 'Lovely.'),
    ] },
    { at: 249, lines: [
      line(CLARA, CEO, 'The English menu is written from the German and checked against the price list.'),
      line(CEO, CLARA, 'Thank you, Clara.'),
    ] },
    { at: 246, lines: [
      line(THEO, CEO, 'The cards are in and Ravi is on the last checks.'),
      line(CEO, THEO, 'Lovely work. Pickup orders are next: slot, cart, TWINT and the counter, end to end.'),
      line(THEO, CEO, 'Ines plans checkout, Jules maps the flow and Sofia takes the payment.'),
    ] },
    { at: 236, lines: qaWithFix('English menu', 'the language switch jumps back to the top of the page', 'the switch keeps your place on the page now.') },
    { at: 232, lines: qaPasses('lunch section') },
    { at: 214, lines: [
      line(ADA, JULES, 'Please map the pickup flow from the menu to the counter.'),
      line(JULES, ADA, 'On it: menu, cart, slot, payment, then the counter.'),
    ] },
    { at: 210, lines: [
      line(INES, SOFIA, 'TWINT is next: pay at pickup, in the sandbox first.'),
      line(SOFIA, INES, 'The test merchant ID has come through. Trying it now.'),
    ] },
    { at: 203, lines: [
      line(INES, KAI, 'The slot picker is yours next: pickup times from 7:00 to 17:30.'),
      line(KAI, INES, 'Starting on it now.'),
    ] },
    { at: 199, lines: [line(THEO, CEO, 'The menu passes on phones in both languages. Marco puts it on the work branch.')] },
  ];
}

/** Ravi checks a part of the menu and it passes. */
function qaPasses(part: string): Line[] {
  return [
    line(THEO, RAVI, `Please check the ${part} on a small phone and with text at 200%.`),
    line(RAVI, THEO, `The ${part} passes: 320 px, 200% text and a screen reader all read it in order.`),
  ];
}

/** Ravi finds a problem, Kai fixes it through Ines, and it passes. */
function qaWithFix(part: string, problem: string, fix: string): Line[] {
  return [
    line(THEO, RAVI, `Please check the ${part} on a small phone and with text at 200%.`),
    line(RAVI, INES, `${capital(part)}: ${problem}. Could Kai look?`),
    line(INES, KAI, `Ravi found a problem in the ${part}: ${problem}.`),
    line(KAI, INES, `Fixed: ${fix}`),
    line(INES, RAVI, 'Kai fixed it. Could you check again?'),
    line(RAVI, THEO, `The ${part} passes now: 320 px, 200% text and a screen reader.`),
  ];
}

const COFFEE = ['espresso', 'cappuccino', 'flat white', 'oat latte', 'chai latte', 'hot chocolate', 'Ovomaltine', 'iced coffee'];
const PASTRIES = ['Gipfeli', 'Nussgipfel', 'Basler Läckerli', 'Rüeblitorte', 'Zopf', 'Schoggiweggli', 'cardamom bun', 'Apfelstrudel'];
const LUNCH = ['quiche of the day', 'soup of the day', 'Birchermüesli', 'ham sandwich on Zopf'];

/** Kai's card for each item on the menu, as Ines hands them out. */
function cards(items: readonly string[]): Line[][] {
  const ask = [(x: string) => `Next card: ${x}. Name and price on one line, allergens under it.`, (x: string) => `${capital(x)} is next, please.`, (x: string) => `Could you do the ${x} card next?`] as const;
  const done = [
    (x: string) => `The ${x} card is on the preview.`,
    (x: string) => `${capital(x)} is done: the price on the name's line, the allergens in small type.`,
    (x: string) => `Done with ${x}. The card keeps the height of the others, so the grid doesn't jump.`,
  ] as const;
  const thanks = ['Thanks.', 'Looks right on my phone.', "Good. Ravi checks the section once it's complete."] as const;
  return items.map((x, i) => [
    line(INES, KAI, nth(ask, i)(x)),
    line(KAI, INES, x.length > 15 ? `${capital(x)} is in. Its name wraps at 320 px; I let it wrap rather than cut it short.` : nth(done, i)(x)),
    ...(i % 2 === 1 ? [line(INES, KAI, nth(thanks, i >> 1))] : []),
  ]);
}

/** The conversations that fill the day between the story's moments, each kind in its stretch of it. */
function rounds(): Round[] {
  const icon = [(x: string) => `${capital(x)} needs an icon, in chalk lines like the board above the counter.`, (x: string) => `Next icon: ${x}.`, (x: string) => `Could you draw ${x} next?`] as const;
  const drawn = [
    (x: string) => `The ${x} icon is done: one line weight, readable at 24 px.`,
    (x: string) => `${capital(x)} is drawn, in one colour so it works on slate and on white.`,
    (x: string) => `Done: ${x}. I kept the chalk wobble small so it stays sharp on a phone.`,
  ] as const;
  const searches: [string, string, string][] = [
    ['coffee', 'Kaffee Basel', 'Café Basel Altstadt'],
    ['breakfast', 'Frühstück Basel', 'Zmorge Basel'],
    ['pastries', 'Gipfeli Basel', 'Bäckerei Basel'],
    ['lunch', 'Zmittag Basel', 'Mittagessen Basel'],
    ['coffee with oat milk', 'Hafermilch Kaffee Basel', 'vegan Café Basel'],
    ['takeaway coffee', 'Kaffee to go Basel', 'Coffee to go Basel'],
  ];
  const german = [(x: string) => `${capital(x)} next: two short sentences, Swiss spelling.`, (x: string) => `Could you do ${x}? Say what's in it: guests ask.`, (x: string) => `${capital(x)}, please. Warm, not fancy.`] as const;
  const written = [(x: string) => `${capital(x)} is in the German file.`, (x: string) => `Done: ${x}. I wrote “ss”, never “ß”, as the Swiss do.`, (x: string) => `${capital(x)} is in, in two sentences.`] as const;
  const reviews: [string, string, string | null][] = [
    ['coffee section', 'Lovely. Give the prices a little more room at 320 px.', 'Done: the prices have their own line at 320 px.'],
    ['pastries section', 'Good. The cream on slate reads well.', null],
    ['lunch section', 'Close. Less chalk texture: keep it for the headings.', 'Done: the texture is only on the headings now.'],
    ['opening hours page', "Nice. Line the times up on the right, like the café's door.", 'Done: the times line up on the right.'],
    ['allergens list', 'Good. The icons and the words agree.', null],
    ['language switch', 'Make it say Deutsch and English, not DE and EN.', 'Done: it says Deutsch and English now.'],
  ];
  return [
    { from: 1120, to: 800, scenes: cards(COFFEE) },
    { from: 770, to: 450, scenes: cards(PASTRIES) },
    { from: 420, to: 268, scenes: cards(LUNCH) },
    { from: 1440, to: 316, scenes: [...PASTRIES, ...LUNCH].map((x, i) => [line(ADA, PIA, nth(icon, i)(x)), line(PIA, ADA, nth(drawn, i)(x))]) },
    {
      from: 1446,
      to: 1000,
      scenes: searches.map(([topic, first, then], i) => [
        line(CLARA, TOM, `What do people search for when they want ${topic} in Basel?`),
        line(TOM, CLARA, `Mostly “${first}”, then “${then}”. I'd put the first in the page title.`),
        ...(i % 2 === 0 ? [line(CLARA, TOM, 'Good. The German titles get those words; the English follows.')] : []),
      ]),
    },
    { from: 330, to: 262, scenes: PASTRIES.map((x, i) => [line(CLARA, LENA, nth(german, i)(x)), line(LENA, CLARA, nth(written, i)(x))]) },
    {
      from: 1350,
      to: 520,
      scenes: reviews.map(([part, verdict, fixed]) => [
        line(MINA, ADA, `The ${part} is on the preview, in the chalkboard style.`),
        line(ADA, MINA, verdict),
        ...(fixed ? [line(MINA, ADA, fixed)] : []),
      ]),
    },
    {
      from: 1484,
      to: 900,
      scenes: [
        [
          line(JULES, ADA, 'Guests read the menu standing at the counter, so each section should be one tap away.'),
          line(ADA, JULES, 'Agreed: the three sections in a row at the top.'),
          line(JULES, MINA, 'The sections go in a row at the top, one tap each.'),
        ],
        [line(JULES, ADA, "Allergens belong under each item, not on a page of their own: people with allergies won't go looking."), line(ADA, JULES, "Yes. Pia's icons can carry them.")],
        [line(JULES, ADA, 'Opening hours belong at the top of the menu page: people look for them before anything else.'), line(ADA, JULES, "Put them under the café's name.")],
        [
          line(JULES, ADA, 'Lunch changes every day. It needs a line for today that the café can edit.'),
          line(ADA, JULES, "Good idea. I'll ask Theo whether that's easy."),
          line(ADA, THEO, "Jules wants a line for today's lunch that the café can edit. Could Noah make that work?"),
          line(THEO, ADA, 'Yes: one line in the menu data for now, and a small form later.'),
        ],
      ],
    },
    {
      from: 1110,
      to: 300,
      scenes: [
        [line(KAI, NOAH, 'The flat white comes through as 4.8. Could the data keep two decimals?'), line(NOAH, KAI, 'Fixed: prices are whole centimes now, so 4.80 stays 4.80.')],
        [line(KAI, NOAH, 'Ovomaltine has no allergens in the data, but it has milk and barley.'), line(NOAH, KAI, 'Added both, thanks.')],
        [line(KAI, NOAH, 'Could the data say which items are vegan? Jules wants a mark on the card.'), line(NOAH, KAI, 'There is a vegan flag now; the oat latte and the soup have it.')],
        [line(KAI, NOAH, 'Two items share the id “zopf”.'), line(NOAH, KAI, 'One is the ham sandwich on Zopf; it is “zopf-sandwich” now.')],
        [line(KAI, NOAH, 'Lunch needs a line for today.'), line(NOAH, KAI, 'It is in the data: one line per day, and an empty one means the usual menu.')],
      ],
    },
    {
      from: 1100,
      to: 420,
      scenes: [
        [line(MARCO, THEO, 'The preview build takes four minutes, most of it resizing images. I will cache them.'), line(THEO, MARCO, 'Please do.')],
        [line(MARCO, THEO, 'Previews build in under two minutes now.'), line(THEO, MARCO, 'Lovely.')],
        [line(THEO, MARCO, "Could each branch get its own preview? Kai's and Mina's changes keep crossing."), line(MARCO, THEO, "I'll set that up once the menu is live.")],
      ],
    },
    {
      from: 1000,
      to: 520,
      scenes: [
        [line(CEO, THEO, 'How far are the menu cards?'), line(THEO, CEO, 'Coffee is under way; the pastries follow, and lunch after them.')],
        [line(CEO, ADA, 'How is the chalkboard look coming along?'), line(ADA, CEO, 'Mina has the type and the colours, and Pia is drawing the icons. It reads well on a phone.')],
        [line(CEO, OTTO, 'Is the office working for everyone?'), line(OTTO, CEO, 'Yes. Design asked for more light by the window, so I moved the lamps.')],
      ],
    },
  ];
}

/** A small seeded random, so the history is the same on every load. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Placed {
  line: Line;
  at: number;
  id: string;
  /** The conversation it is part of, for `of` and `re`. */
  scene: Placed[];
}

/**
 * The café's messages before the oldest its view carries, oldest first, ids `hm-1` on, and the CEO's acknowledgements of
 * your lines among them (`hk-1` on).
 */
export function cafeEarlier(now: number): { messages: Message[]; acks: Ack[] } {
  const random = seeded(20_261_105);
  const starts: { lines: Line[]; start: number }[] = [
    ...story().map((s) => ({ lines: s.lines, start: workAt(s.at) })),
    ...rounds().flatMap((r) => {
      const step = (workAt(r.to) - workAt(r.from)) / r.scenes.length;
      return r.scenes.map((lines, k) => ({ lines, start: workAt(r.from) + (k + 0.5 + (random() - 0.5) * 0.6) * step }));
    }),
  ];
  const placed: Placed[] = [];
  for (const { lines, start } of starts) {
    const gaps = lines.map((_, i) => (i === 0 ? 0 : 2 + random() * 6));
    // A conversation that would run past the newest line starts earlier instead.
    let work = Math.min(start, DAY - 1 - gaps.reduce((a, b) => a + b, 0));
    const scene: Placed[] = [];
    lines.forEach((l, i) => {
      work += gaps[i] ?? 0;
      const p: Placed = { line: l, at: Math.round(now - agoAt(work) * MIN), id: '', scene };
      scene.push(p);
      placed.push(p);
    });
  }
  placed.sort((a, b) => a.at - b.at);
  placed.forEach((p, i) => {
    p.id = `hm-${i + 1}`;
  });
  const messages = placed.map((p): Message => {
    const original = p.line.of === undefined ? undefined : p.scene[p.line.of];
    const answered = p.line.re === undefined ? undefined : p.scene[p.line.re];
    const toYou = p.line.to === STAKEHOLDER;
    return {
      id: p.id,
      from: p.line.from,
      to: p.line.to,
      text: original ? original.line.text : p.line.text,
      origin: original ? original.line.from : null,
      relayOf: original ? original.id : null,
      note: p.line.note ?? null,
      at: p.at,
      // Yours arrive as they are sent; a person takes theirs at their next step or as a turn of its own.
      deliveredAt: toYou ? p.at : Math.round(p.at + (0.2 + random() * 1.3) * MIN),
      interrupt: false,
      audience: null,
      for: [],
      deliveredHow: toYou ? null : random() < 0.6 ? 'next-step' : 'new-turn',
      cites: answered ? [answered.id] : [],
    };
  });
  const acks = messages
    .flatMap((m, i): Omit<Ack, 'id'>[] => {
      const text = placed[i]?.line.ack;
      return text === undefined ? [] : [{ message: m.id, by: m.to, agree: true, text, at: Math.round((m.deliveredAt ?? m.at) + (0.3 + random()) * MIN) }];
    })
    .sort((a, b) => a.at - b.at)
    .map((a, i): Ack => ({ id: `hk-${i + 1}`, ...a }));
  return { messages, acks };
}
