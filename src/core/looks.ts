// What the office can draw for people and places. studio.yaml, the CEO's proposals and office changes are checked
// against these lists, so a name the office can't draw is refused with a sentence instead of drawing nothing.

/** Bodies for people: KayKit's mannequin and Adventurers bodies with their fantasy gear left off. */
export const LOOK_BODIES = ['mannequin', 'knight', 'barbarian', 'mage', 'rogue', 'ranger'] as const;
export type LookBody = (typeof LOOK_BODIES)[number];

/** Something a person carries or wears at work. */
export const LOOK_PROPS = ['none', 'headset', 'laptop', 'clipboard', 'tablet', 'notebook'] as const;
export type LookProp = (typeof LOOK_PROPS)[number];

/** Skin tones, light to dark: a look picks one by its index. */
export const SKIN_TONES = 6;

/** The office's themes, for the whole office or one room ("a games room with an arcade theme"). */
export const THEMES = ['office', 'cafe', 'game-studio', 'shop', 'lab', 'garden', 'city', 'arcade', 'music-studio'] as const;
export type Theme = (typeof THEMES)[number];

/** Rooms that aren't a department's: where people meet, the CEO's office, the front desk, places to rest. */
export const ROOM_KINDS = ['meeting', 'ceo', 'reception', 'lounge', 'games', 'kitchen'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

/** Colours in a look: #rrggbb only, so nothing else reaches a material. */
export const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

/** At most this many decor pieces in an office, so a long list can't slow it down. */
export const MAX_DECOR = 40;
