import { fireEvent, render, screen } from '@testing-library/react';
import RegistrarSidebar from './RegistrarSidebar';

test('clearer Registrar labels keep their existing tab identifiers', () => {
  const setActiveTab = jest.fn();
  render(<RegistrarSidebar
    activeTab="bulkEnroll"
    setActiveTab={setActiveTab}
    managementMenuItems={[
      { id: 'assigning', label: 'Account Assignments' },
      { id: 'tickets', label: 'Support Tickets' },
    ]}
  />);

  fireEvent.click(screen.getByRole('button', { name: /section management/i }));
  expect(setActiveTab).toHaveBeenCalledWith('sectioning');
  fireEvent.click(screen.getByRole('button', { name: /sections$/i }));
  expect(setActiveTab).toHaveBeenCalledWith('sectionsCreated');
  fireEvent.click(screen.getByRole('button', { name: /^operations/i }));
  fireEvent.click(screen.getByRole('button', { name: /account assignments/i }));
  expect(setActiveTab).toHaveBeenCalledWith('assigning');
  fireEvent.click(screen.getByRole('button', { name: /support tickets/i }));
  expect(setActiveTab).toHaveBeenCalledWith('tickets');
});

test('mobile Registrar navigation opens as a menu and closes after selection', () => {
  const setActiveTab = jest.fn();
  render(<RegistrarSidebar activeTab="dashboard" setActiveTab={setActiveTab} />);

  const menu = screen.getByRole('button', { name: /open registrar navigation menu/i });
  expect(menu).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(menu);
  expect(menu).toHaveAttribute('aria-expanded', 'true');

  fireEvent.click(screen.getByRole('button', { name: /^encoding period$/i }));
  expect(setActiveTab).toHaveBeenCalledWith('encoding');
  expect(menu).toHaveAttribute('aria-expanded', 'false');
});
