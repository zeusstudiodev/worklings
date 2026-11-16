// The pieces the catalogue (src/core/themes.ts) marks as made here, by id: what the office draws for each, in KayKit's
// style, sized to the catalogue's footprint. Desks and their sets are drawn per desk (build.ts); as decor they are
// drawn like any other piece.
import { CEO_DESK, COMPANY_DESK } from '../layout.ts';
import { desk, keyboard, leadDesk, monitor, monitorScreen, officeChair } from './desk.ts';
import { FRONT_DESKS } from './fronts.ts';
import {
  arcadeCabinet,
  bench,
  bigScreen,
  busStop,
  chalkboardMenu,
  conceptBoard,
  greenhouseArch,
  mixingDesk,
  neonSign,
  packingBench,
  parcelShelves,
  pastryCase,
  planter,
  serverRack,
  speaker,
  streetLamp,
  vocalBooth,
} from './heroes.ts';
import {
  type Built,
  type Chart,
  coatRack,
  coffeeMachine,
  kanbanBoard,
  leafyPlant,
  meetingScreen,
  milestoneBoard,
  orgBoard,
  potColour,
  printer,
  smallPlant,
  waterCooler,
  whiteboard,
} from './props.ts';
import { TILE } from './shape.ts';

export interface MadeContext {
  /** The theme's accent. */
  accent: string;
  /** The room's colour: a department's hue, or the accent elsewhere. */
  hue: string;
  /** A stable number per placement, for variety that stays put. */
  seed: number;
  /** The org, for an org board; none for a blank one. */
  chart: Chart | null;
}

type Maker = (c: MadeContext) => Built;

const front = (id: string): Maker => (c) => {
  const make = FRONT_DESKS[id];
  if (!make) throw new Error(`no front desk called ${id}`);
  return make(3.6, 1.2, c.accent);
};

/** Every made piece by catalogue id. */
export const MADE: Readonly<Record<string, Maker>> = {
  desk: (c) => ({ solid: desk(COMPANY_DESK.w, COMPANY_DESK.d, c.hue, c.seed) }),
  'lead-desk': () => ({ solid: leadDesk(CEO_DESK.w, CEO_DESK.d) }),
  'desk-chair': (c) => ({ solid: officeChair(c.hue) }),
  monitor: () => ({ solid: monitor(), glow: monitorScreen(TILE.code) }),
  keyboard: () => ({ solid: keyboard() }),
  'leafy-plant': (c) => leafyPlant(potColour(c.seed), c.seed),
  'small-plant': (c) => smallPlant(potColour(c.seed + 1), c.seed),
  whiteboard: () => whiteboard(2.4, 1.3),
  'kanban-board': () => kanbanBoard(),
  'org-board': (c) => orgBoard(3.6, 1.25, c.chart, null),
  'milestone-board': (c) => milestoneBoard(2.4, 1.0, c.accent, null),
  'meeting-screen': () => meetingScreen(2.4, 1.35, null),
  'water-cooler': () => waterCooler(),
  'coat-rack': (c) => coatRack(c.seed),
  'coffee-machine': () => coffeeMachine(),
  printer: () => printer(),
  'reception-desk': front('reception-desk'),
  'espresso-counter': front('espresso-counter'),
  'chalkboard-menu': () => chalkboardMenu(),
  'pastry-case': () => pastryCase(),
  'mascot-counter': front('mascot-counter'),
  'big-screen': () => bigScreen(),
  'concept-board': () => conceptBoard(),
  till: front('till'),
  'parcel-shelves': () => parcelShelves(),
  'packing-bench': () => packingBench(),
  'badge-desk': front('badge-desk'),
  'server-rack': () => serverRack(),
  'potting-bench': front('potting-bench'),
  'greenhouse-arch': () => greenhouseArch(),
  planter: (c) => planter(c.accent),
  kiosk: front('kiosk'),
  'bus-stop': (c) => busStop(c.accent),
  'street-lamp': () => streetLamp(),
  bench: () => bench(),
  'prize-counter': front('prize-counter'),
  'arcade-cabinet': (c) => arcadeCabinet(c.seed),
  'neon-sign': (c) => neonSign(c.accent),
  'gear-counter': front('gear-counter'),
  'mixing-desk': () => mixingDesk(),
  speaker: () => speaker(),
  'vocal-booth': (c) => vocalBooth(c.accent),
};
