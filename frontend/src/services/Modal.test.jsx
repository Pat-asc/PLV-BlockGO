import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import Modal from './Modal';

// The parent intentionally passes a new inline onClose on every render, which
// is how most Modal consumers are written.
function Harness({ withInitialFocus = false, onClosed = () => {} }) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState('');
    const inputRef = React.useRef(null);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open</button>
            <Modal
                isOpen={open}
                onClose={() => { setOpen(false); onClosed(); }}
                title="Harness"
                initialFocusRef={withInitialFocus ? inputRef : undefined}
            >
                <textarea ref={inputRef} aria-label="Notes" value={text} onChange={(event) => setText(event.target.value)} />
                <button type="button">Confirm</button>
            </Modal>
        </>
    );
}

test('parent re-renders with a new inline onClose do not move focus out of a field', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);

    // Default initial focus behavior is unchanged: first focusable element.
    const closeButton = screen.getByRole('button', { name: 'Close Harness' });
    expect(closeButton).toHaveFocus();

    const notes = screen.getByLabelText('Notes');
    notes.focus();
    for (const character of 'Administrative review required') {
        userEvent.type(notes, character, { skipClick: true });
        expect(notes).toHaveFocus();
    }
    expect(notes).toHaveValue('Administrative review required');
});

test('initialFocusRef is focused once on open, and Escape still uses the latest onClose', () => {
    const onClosed = jest.fn();
    render(<Harness withInitialFocus onClosed={onClosed} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);

    const notes = screen.getByLabelText('Notes');
    expect(notes).toHaveFocus();
    userEvent.type(notes, 'abc', { skipClick: true });
    expect(notes).toHaveFocus();

    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
});

