// What the 3D model says for a screen reader (the canvas is an image, role "img"): the office's rooms and who is at
// work, in words that read right for one, none and many. The panels hold the detail; this is the picture's caption.

/** "Model of the studio: 4 rooms, 11 people at work"; "no rooms yet" and "nobody at work" while there are none. */
export function modelLabel(rooms: number, atWork: number): string {
  const roomWords = rooms === 0 ? 'no rooms yet' : rooms === 1 ? '1 room' : `${rooms} rooms`;
  const workWords = atWork === 0 ? 'nobody at work' : atWork === 1 ? '1 person at work' : `${atWork} people at work`;
  return `Model of the studio: ${roomWords}, ${workWords}`;
}
