import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NotificationProvider, useNotification } from './NotificationContext';

function Trigger() {
  const { addNotification } = useNotification();
  return <>
    <button type="button" onClick={() => addNotification('Saved successfully', 'success')}>Notify</button>
    <button type="button" onClick={() => addNotification('Section changed', 'success', { eventKey: 'section|31|2026-09-29T01:00:00Z' })}>Same event</button>
    <button type="button" onClick={() => addNotification('Section changed again', 'success', { eventKey: 'section|31|2026-09-29T02:00:00Z' })}>New event</button>
  </>;
}

afterEach(() => {
  jest.useRealTimers();
});

test('notification has entrance animation and an accessible manual close control', () => {
  render(<NotificationProvider><Trigger /></NotificationProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
  const status = screen.getByRole('status');
  expect(status).toHaveClass('notification-enter');
  fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
  expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument();
});

test('the same event is shown once and a genuinely new event still appears', () => {
  render(<NotificationProvider><Trigger /></NotificationProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Same event' }));
  fireEvent.click(screen.getByRole('button', { name: 'Same event' }));
  expect(screen.getAllByText('Section changed')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'New event' }));
  expect(screen.getByText('Section changed again')).toBeInTheDocument();
});

test('a timed-out event does not reappear when replayed', () => {
  jest.useFakeTimers();
  render(<NotificationProvider><Trigger /></NotificationProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Same event' }));
  act(() => jest.advanceTimersByTime(5000));
  expect(screen.queryByText('Section changed')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Same event' }));
  expect(screen.queryByText('Section changed')).not.toBeInTheDocument();
});

test('a dismissed event does not immediately return from the same identity', () => {
  render(<NotificationProvider><Trigger /></NotificationProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Same event' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
  fireEvent.click(screen.getByRole('button', { name: 'Same event' }));
  expect(screen.queryByText('Section changed')).not.toBeInTheDocument();
});

test('provider cleanup cancels notification timers before remount', () => {
  jest.useFakeTimers();
  const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
  const view = render(<NotificationProvider><Trigger /></NotificationProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Same event' }));
  view.unmount();
  expect(clearTimeoutSpy).toHaveBeenCalled();
  clearTimeoutSpy.mockRestore();
  render(<NotificationProvider><Trigger /></NotificationProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Same event' }));
  expect(screen.getByText('Section changed')).toBeInTheDocument();
});
