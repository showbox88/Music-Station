/**
 * Modal shell — backdrop + centred gradient card.
 *
 * Replaces the recurring "fixed inset-0 z-50 bg-black/60 flex items-center
 * justify-center p-4 + inner gradient card" markup that was copy-pasted
 * across every modal in the app.
 *
 * Usage:
 *
 *   <ModalShell onClose={onClose} maxWidth="max-w-sm">
 *     <h2>Title</h2>
 *     ...
 *   </ModalShell>
 *
 * For form-style modals (e.g. forms whose root submits on Enter):
 *
 *   <ModalShell as="form" onSubmit={handleSubmit} onClose={onClose}>
 *     <input ... />
 *   </ModalShell>
 *
 * For "forced" modals (must_change_password, etc.) the backdrop is
 * denser and no onClose is fired by clicking outside:
 *
 *   <ModalShell forced>
 *     ...
 *   </ModalShell>
 */
import type { FormEventHandler, ReactNode } from 'react';

interface ModalShellProps {
  /** Called when the backdrop is clicked. Omit (or pass undefined) to
   *  prevent dismissal — used by `forced` modals and by content that
   *  manages its own close affordances internally. */
  onClose?: () => void;
  /** Tailwind max-width class for the inner card. Defaults to max-w-lg.
   *  Common values: max-w-sm (narrow forms), max-w-md, max-w-xl
   *  (preview overlays), max-w-2xl (the EQ panel). */
  maxWidth?: string;
  /** Extra classes appended to the inner card (.modal-card …). The
   *  caller controls padding, gap, etc. — the shell deliberately
   *  doesn't impose layout so existing spacing is preserved. */
  className?: string;
  /** Render the inner card as a <form> instead of <div>. */
  as?: 'div' | 'form';
  /** Required when `as='form'`. */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  /** Higher z-index + denser backdrop, and ignores outside-click for
   *  close. Used for must-change-password and similar blockers. */
  forced?: boolean;
  /** Backdrop class override — for nested modals that need a custom
   *  z-index / opacity (e.g. a preview opening on top of an
   *  already-open modal). When set, replaces the backdrop class
   *  entirely; `forced` is ignored. */
  backdropClassName?: string;
  children: ReactNode;
}

export default function ModalShell({
  onClose,
  maxWidth = 'max-w-lg',
  className = '',
  as = 'div',
  onSubmit,
  forced = false,
  backdropClassName,
  children,
}: ModalShellProps) {
  const backdropClasses =
    backdropClassName ??
    (forced
      ? 'fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4'
      : 'fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4');

  // No `shadow-2xl` — Tailwind's utility shadow would override
  // .modal-card's box-shadow (utilities sort after components in the
  // generated CSS), erasing the magenta-glow polish. Let .modal-card
  // own the shadow.
  const cardClasses = `w-full ${maxWidth} rounded-xl modal-card ${className}`.trim();

  function onBackdropClick() {
    if (forced) return;
    onClose?.();
  }

  function stopPropagation(e: React.MouseEvent) {
    e.stopPropagation();
  }

  if (as === 'form') {
    return (
      <div className={backdropClasses} onClick={onBackdropClick}>
        <form
          onSubmit={onSubmit}
          onClick={stopPropagation}
          className={cardClasses}
        >
          {children}
        </form>
      </div>
    );
  }

  return (
    <div className={backdropClasses} onClick={onBackdropClick}>
      <div onClick={stopPropagation} className={cardClasses}>
        {children}
      </div>
    </div>
  );
}
