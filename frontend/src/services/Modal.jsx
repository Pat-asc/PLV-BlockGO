import React, { useEffect, useId, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

const Modal = ({
    isOpen,
    onClose,
    title,
    children,
    description,
    closeOnBackdrop = true,
    closeOnEscape = true,
    panelClassName = '',
    bodyClassName = '',
    initialFocusRef,
}) => {
    const dialogRef = useRef(null);
    const previouslyFocusedRef = useRef(null);
    // Keep the latest callbacks/options in refs so the open effect below does
    // not re-run (and re-focus the first control) when a parent re-renders
    // with a new inline onClose or a changed closeOnEscape value.
    const onCloseRef = useRef(onClose);
    const closeOnEscapeRef = useRef(closeOnEscape);
    const initialFocusRefRef = useRef(initialFocusRef);
    const titleId = useId();
    const descriptionId = useId();
    // Default dialogs are bounded to the viewport. Consumers that provide a custom
    // panel layout retain ownership of overflow so absolute menus/popovers are not
    // unexpectedly clipped by the shared shell.
    const responsivePanelClasses = panelClassName
        ? ''
        : 'max-h-[calc(100dvh-1rem)] overflow-y-auto';

    useEffect(() => {
        onCloseRef.current = onClose;
        closeOnEscapeRef.current = closeOnEscape;
        initialFocusRefRef.current = initialFocusRef;
    });

    useEffect(() => {
        if (!isOpen) return undefined;

        // Initial focus runs only when the dialog transitions from closed to open.
        previouslyFocusedRef.current = document.activeElement;
        const dialog = dialogRef.current;
        const preferred = initialFocusRefRef.current?.current;
        const focusable = dialog?.querySelectorAll(FOCUSABLE_SELECTOR);
        const initialTarget = preferred && dialog?.contains(preferred) ? preferred : (focusable?.[0] || dialog);
        initialTarget?.focus();

        const handleKeyDown = (event) => {
            const openDialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'));
            if (openDialogs[openDialogs.length - 1] !== dialog) return;
            if (event.key === 'Escape' && closeOnEscapeRef.current) {
                event.preventDefault();
                onCloseRef.current?.();
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
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 z-[1001] flex items-center justify-center bg-black bg-opacity-50 p-2 backdrop-blur-sm sm:p-4"
            onMouseDown={(event) => {
                if (closeOnBackdrop && event.target === event.currentTarget) onClose?.();
            }}
        >
            <div 
                ref={dialogRef}
                data-system-theme-surface="dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={description ? descriptionId : undefined}
                tabIndex={-1}
                className={`relative box-border min-w-0 w-full rounded-xl bg-white p-4 text-slate-900 shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-[#f4c430] dark:bg-slate-900 dark:text-slate-100 sm:p-6 ${responsivePanelClasses} ${panelClassName || 'max-w-lg'}`}
            >
                <div className="mb-4 flex w-full min-w-0 shrink-0 items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
                    <h3 id={titleId} className="min-w-0 break-words text-xl font-bold text-[#003366] dark:text-sky-300">{title}</h3>
                    <button 
                        type="button"
                        onClick={onClose} 
                        aria-label={`Close ${title || 'dialog'}`}
                        className="flex h-10 w-10 items-center justify-center rounded-md text-3xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003366] dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                        &times;
                    </button>
                </div>
                {description ? <p id={descriptionId} className="mb-5 whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p> : null}
                <div className={`min-w-0 ${bodyClassName}`}>{children}</div>
            </div>
        </div>
    );
};

export default Modal;
