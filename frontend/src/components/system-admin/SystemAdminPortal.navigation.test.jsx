import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SystemAdminPortal from './SystemAdminPortal';

jest.mock('../../services/api', () => ({ fetchSupportTickets: jest.fn().mockResolvedValue({ data: [] }) }));
jest.mock('./SystemMonitoring', () => () => <div>Monitoring view</div>);
jest.mock('./RegistrarAccountManagement', () => () => <div>Registrar accounts view</div>);
jest.mock('./SupportTicketManagement', () => () => <div>Tickets view</div>);
jest.mock('./GrafanaObservability', () => () => <div>Grafana view</div>);
jest.mock('./SystemAdminTransactions', () => () => <div>Transactions view</div>);
jest.mock('./CouchDbBrowser', () => () => <div>CouchDB view</div>);

test('keeps Data Life Cycle out of primary desktop and mobile navigation', async () => {
  render(<SystemAdminPortal adminData={{ name: 'Admin' }} onLogout={() => {}} />);
  await act(async () => {});
  const navigation = screen.getByRole('navigation', { name: 'System administration views' });
  expect(within(navigation).queryByRole('button', { name: /Data Life Cycle/i })).not.toBeInTheDocument();
  expect(navigation).toHaveClass('lg:flex');

  const menu = screen.getByRole('button', { name: 'Open navigation menu' });
  expect(menu).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(menu);
  expect(menu).toHaveAttribute('aria-expanded', 'true');
  expect(within(navigation).queryByRole('button', { name: /Data Life Cycle/i })).not.toBeInTheDocument();
});

test('opens the existing Data Life Cycle from Settings and returns to Settings', async () => {
  render(<SystemAdminPortal adminData={{ name: 'Admin' }} onLogout={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /^Settings$/i }));
  const settings = screen.getByRole('dialog', { name: 'Settings' });
  expect(within(settings).getByText('Data Life Cycle')).toBeInTheDocument();
  expect(within(settings).getByText(/application, database, and blockchain data move through BlockGo/i)).toBeInTheDocument();

  fireEvent.click(within(settings).getByRole('button', { name: 'View Data Life Cycle' }));
  await waitFor(() => expect(screen.getByText('BlockGo Data Life Cycle')).toBeInTheDocument());
  expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
  const reopenedSettings = await screen.findByRole('dialog', { name: 'Settings' });
  expect(within(reopenedSettings).getByRole('button', { name: 'View Data Life Cycle' })).toBeInTheDocument();
});
