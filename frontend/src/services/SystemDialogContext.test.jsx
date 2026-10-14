import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { requestSystemConfirmation, SystemDialogProvider } from './SystemDialogContext';

function ConfirmationHarness({ onConfirmed }) {
  const requestDelete = async () => {
    const confirmed = await requestSystemConfirmation({
      title: 'Delete Student',
      message: 'Are you sure you want to delete this student?',
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (confirmed) onConfirmed();
  };

  return <button type="button" onClick={requestDelete}>Delete student</button>;
}

test('confirmation cancel performs no action and returns focus to its trigger', async () => {
  const onConfirmed = jest.fn();
  render(<SystemDialogProvider><ConfirmationHarness onConfirmed={onConfirmed} /></SystemDialogProvider>);
  const trigger = screen.getByRole('button', { name: /delete student/i });
  trigger.focus();
  fireEvent.click(trigger);

  expect(await screen.findByRole('dialog', { name: /delete student/i })).toHaveAttribute('aria-modal', 'true');
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

  expect(onConfirmed).not.toHaveBeenCalled();
  await waitFor(() => expect(trigger).toHaveFocus());
});

test('confirmation executes once even when its button receives repeated clicks', async () => {
  const onConfirmed = jest.fn();
  render(<SystemDialogProvider><ConfirmationHarness onConfirmed={onConfirmed} /></SystemDialogProvider>);
  fireEvent.click(screen.getByRole('button', { name: /delete student/i }));
  const confirm = await screen.findByRole('button', { name: /^delete$/i });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
});

test('Escape safely cancels confirmation and restores focus', async () => {
  const onConfirmed = jest.fn();
  render(<SystemDialogProvider><ConfirmationHarness onConfirmed={onConfirmed} /></SystemDialogProvider>);
  const trigger = screen.getByRole('button', { name: /delete student/i });
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByRole('dialog');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(onConfirmed).not.toHaveBeenCalled();
  await waitFor(() => expect(trigger).toHaveFocus());
});
