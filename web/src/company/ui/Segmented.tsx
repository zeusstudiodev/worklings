// One of a few choices, pressed in place: Tasks' "By status" or "By room", Spend's "Today", "7 days" and "All", the
// preview's "Phone", "Tablet" and "Full width", "A library role" or "Describe a role". Buttons with aria-pressed in a
// labelled group rather than radios, because each press acts at once.
import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Shown but not pressable: "A library role" while the library has none. */
  disabled?: boolean;
}

interface SegmentedProps<T extends string> {
  /** What the group chooses, for screen readers: "Show the tasks", "Spend over". */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The caller's placement (margins and the like); the look is the group's own. */
  className?: string;
}

export function Segmented<T extends string>({ label, options, value, onChange, className }: SegmentedProps<T>) {
  return (
    <div className={className ? `segmented-control ${className}` : 'segmented-control'} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented-control__option"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => {
            if (option.value !== value) onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
