import React, { useEffect, useId, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

const Modal = ({ isOpen, onClose, title, children, description, closeOnBackdrop = true, closeOnEscape = true }) => {
    const dialogRef = useRef(null);
    const previouslyFocusedRef = useRef(null);
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        if (!isOpen) return undefined;

        previouslyFocusedRef.current = document.activeElement;
        const dialog = dialogRef.current;
        const focusable = dialog?.querySelectorAll(FOCUSABLE_SELECTOR);
        (focusable?.[0] || dialog)?.focus();

        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && closeOnEscape) {
                event.preventDefault();
                onClose?.();
                return;
            }
            if (event.key !== 'Tab' || !dialog) return;

            const elements = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR));
            if (!elements.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = elements[0];
            const last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            previouslyFocusedRef.current?.focus?.();
        };
    }, [closeOnEscape, isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 z-[1001] flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm"
            onMouseDown={(event) => {
                if (closeOnBackdrop && event.target === event.currentTarget) onClose?.();
            }}
        >
            <div 
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={description ? descriptionId : undefined}
                tabIndex={-1}
                className="relative mx-4 w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-[#f4c430]"
            >
                <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-4">
                    <h3 id={titleId} className="text-xl font-bold text-[#003366]">{title}</h3>
                    <button 
                        type="button"
                        onClick={onClose} 
                        aria-label={`Close ${title || 'dialog'}`}
                        className="flex h-10 w-10 items-center justify-center rounded-md text-3xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003366]"
                    >
                        &times;
                    </button>
                </div>
                {description ? <p id={descriptionId} className="mb-5 whitespace-pre-line text-sm leading-6 text-slate-600">{description}</p> : null}
                <div>{children}</div>
            </div>
        </div>
    );
};

export default Modal;
