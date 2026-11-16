// An answer you press (docs/design-v3.md, "New components"): each press answers, so these are buttons, not a radio
// group. White with a control edge, 44 px tall at every width, the words wrap. The asker's pick carries an outline tag,
// not yellow: yellow means now and needs you.
import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'className' | 'disabled' | 'onClick' | 'children'>;

interface ChoiceButtonProps extends ButtonProps {
  /** The asker's recommended option: tagged "Their pick". */
  pick?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  /** Shown but not pressable (offline, or an answer on its way): stays focusable, the line beside it says why. */
  unavailable?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function ChoiceButton({ pick = false, onClick, children, unavailable = false, ref, ...rest }: ChoiceButtonProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      className={`choice${pick ? ' choice--pick' : ''}`}
      aria-disabled={unavailable || undefined}
      onClick={(event) => {
        if (unavailable) return;
        onClick(event);
      }}
    >
      <span className="choice__text">{children}</span>
      {pick && (
        <span className="choice__pick">
          <span className="visually-hidden">, </span>Their pick
        </span>
      )}
    </button>
  );
}
