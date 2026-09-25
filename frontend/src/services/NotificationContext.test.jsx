import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { NotificationProvider, useNotification } from './NotificationContext';

function Trigger() {
  const { addNotification } = useNotification();
  return <button type="button" onClick={() => addNotification('Saved successfully', 'success')}>Notify</button>;
}

test('notification has entrance animation and an accessible manual close control', () => {
  render(<NotificationProvider><Trigger /></NotificationProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
  const status = screen.getByRole('status');
  expect(status).toHaveClass('notification-enter');
  fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
  expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument();
});
