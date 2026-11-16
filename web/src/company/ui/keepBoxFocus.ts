import type { MouseEvent } from 'react';

/**
 * For the foot of a box that grows the phone's sheet while it has focus: pressing one of its buttons keeps focus in the
 * box. A blur on the press would shrink the sheet and move the button from under the finger between pressing and
 * lifting, so the tap would land on the form and do nothing. The press still clicks the button.
 */
export function keepBoxFocus(event: MouseEvent<HTMLElement>): void {
  if (event.target instanceof Element && event.target.closest('button')) event.preventDefault();
}
