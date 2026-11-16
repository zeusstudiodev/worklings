/**
 * While a bar is pinned (position: sticky) to the foot of the panel, the panel's scroller keeps that bar's height clear
 * when it scrolls a focused control into view (`scroll-padding-bottom` in styles.css), so the bar never hides what has
 * focus. A bar that isn't sticky (a short window lets it flow) keeps nothing clear. Use it as a ref callback.
 */
export function keepClear(bar: HTMLElement | null): (() => void) | undefined {
  const scroller = bar?.closest<HTMLElement>('.panel__body');
  if (!bar || !scroller) return undefined;
  const set = () => scroller.style.setProperty('--sticky-foot', getComputedStyle(bar).position === 'sticky' ? `${bar.offsetHeight}px` : '0px');
  set();
  // Browsers differ in whether a focus scroll honours scroll-padding when the control is already on screen (only under
  // the bar): so a control that has focus and sits under the bar is brought up to just above it.
  const onFocus = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || bar.contains(target) || getComputedStyle(bar).position !== 'sticky') return;
    const a = target.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    if (a.bottom > b.top && a.top < b.bottom) scroller.scrollTop += a.bottom - b.top + 4;
  };
  scroller.addEventListener('focusin', onFocus);
  // The bar's own height changes with what is typed; the scroller's size changes with the window (and so may the bar's position).
  const watch = new ResizeObserver(set);
  watch.observe(bar);
  watch.observe(scroller);
  return () => {
    watch.disconnect();
    scroller.removeEventListener('focusin', onFocus);
    scroller.style.removeProperty('--sticky-foot');
  };
}
