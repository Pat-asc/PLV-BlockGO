import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { NotificationProvider, useNotification } from './NotificationContext';

function Trigger() {
  const { addNotification } = useNotification();
  return <>
    <button type="button" onClick={() => addNotification('Saved successfully', 'success')}>Notify</button>
    <button type="button" onClick={() => addNotification('Section changed', 'success', { eventKey: 'section|31|2026-09-29T01:00:00Z' })}>Same event</button>
    <button type="button" onClick={() => addNotification('Section changed again', 'success', { eventKey: 'section|31|2026-09-29T02:00:00Z' })}>New event</button>
    <button type="button" onClick={() => addNotification('Check this enrollment', 'warning')}>Warning</button>
    <button type="button" onClick={() => addNotification('Open the conversation', 'info', { title: 'New message · Maria', onClick: window.__notificationClick })}>Interactive</button>
  </>;
}

afterEach(() => {
  jest.useRealTimers();
});

test('notification has entrance animation and an accessible manual close control', () => {
  jest.useFakeTimers();
  render(<NotificationProvider><Trigger /></NotificationProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
  const status = screen.getByRole('status');
  expect(status).toHaveClass('notification-enter');
  fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
  expect(status).toHaveClass('notification-exit');
  act(() => jest.advanceTimersByTime(200));
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
  act(() => jest.advanceTimersByTime(5200));
  expect(screen.queryByText('Section changed')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Same event' }));
  expect(screen.queryByText('Section changed')).not.toBeInTheDocument();
});

test('uses one responsive top-right stack for ordered non-overlapping variants', () => {
  render(<NotificationProvider><Trigger /></NotificationProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
  fireEvent.click(screen.getByRole('button', { name: 'Warning' }));
  const stack = screen.getByTestId('notification-stack');
  expect(stack).toHaveClass('fixed', 'top-16', 'flex-col', 'gap-3', 'sm:right-5');
  expect(within(stack).getAllByRole('status')).toHaveLength(2);
  expect(within(stack).getByText('Warning')).toBeInTheDocument();
});

test('shows four notifications and promotes the next queued item after dismissal', () => {
  jest.useFakeTimers();
  render(<NotificationProvider><Trigger /></NotificationProvider>);
  const trigger = screen.getByRole('button', { name: 'Notify' });
  for (let index = 0; index < 5; index += 1) fireEvent.click(trigger);
  expect(screen.getAllByText('Saved successfully')).toHaveLength(4);
  fireEvent.click(screen.getAllByRole('button', { name: 'Close notification' })[0]);
  act(() => jest.advanceTimersByTime(200));
  expect(screen.getAllByText('Saved successfully')).toHaveLength(4);
});

test('an interactive notification runs its click handler and dismisses smoothly', () => {
  jest.useFakeTimers();
  window.__notificationClick = jest.fn();
  render(<NotificationProvider><Trigger /></NotificationProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Interactive' }));
  fireEvent.click(screen.getByRole('button', { name: /New message · Maria: Open the conversation/i }));
  expect(window.__notificationClick).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveClass('notification-exit');
  act(() => jest.advanceTimersByTime(200));
  expect(screen.queryByText('Open the conversation')).not.toBeInTheDocument();
  delete window.__notificationClick;
});

test('a dismissed event does not immediately return from the same identity', () => {
  jest.useFakeTimers();
  render(<NotificationProvider><Trigger /></NotificationProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Same event' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
  act(() => jest.advanceTimersByTime(200));
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

function TechnicalTrigger() {
  const { addNotification } = useNotification();
  return <>
    <button type="button" onClick={() => addNotification('Error submitting section: 23502: null value in column "year_level" of relation "grade_submission_snapshots" violates not-null constraint', 'error')}>Trigger 23502</button>
    <button type="button" onClick={() => addNotification('Finalization failed: Fabric endorsement failure in chaincode ledger-service', 'error')}>Trigger Fabric</button>
  </>;
}

test('sanitizes 23502 and technical errors to human-readable text and appropriate title', () => {
  render(<NotificationProvider><TechnicalTrigger /></NotificationProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Trigger 23502' }));
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Submission could not be completed');
  expect(alert).toHaveTextContent('Some academic information for this section is incomplete. Your encoded grades were preserved. Please refresh and try again.');
  expect(alert.textContent).not.toMatch(/23502|year_level|grade_submission_snapshots|PostgreSQL|Npgsql|null value|constraint/i);
});

test('sanitizes Fabric and ledger errors away from academic notifications', () => {
  render(<NotificationProvider><TechnicalTrigger /></NotificationProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Trigger Fabric' }));
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Finalization could not be completed');
  expect(alert).toHaveTextContent('The grades could not be finalized right now. Your approved grades were preserved. Please try again.');
  expect(alert.textContent).not.toMatch(/Fabric|endorsement|chaincode|ledger-service|gRPC/i);
});
