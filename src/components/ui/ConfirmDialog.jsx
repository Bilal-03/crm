import React, { useEffect, useId, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function ConfirmDialog({
  open,
  title = 'Are you sure?',
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  const dialogRef = useRef(null);
  const cancelButtonRef = useRef(null);
  const previousActiveElementRef = useRef(null);
  const onCancelRef = useRef(onCancel);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) return undefined;

    previousActiveElementRef.current = document.activeElement;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelButtonRef.current?.focus();

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancelRef.current?.();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusableElements = [...dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)];
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      if (previousActiveElementRef.current?.isConnected) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-gray-950/50 p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-bold text-gray-900">{title}</h2>
        {description && <p id={descriptionId} className="mt-2 text-sm leading-6 text-gray-600">{description}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
