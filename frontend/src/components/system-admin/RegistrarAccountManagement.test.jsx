import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RegistrarAccountManagement from './RegistrarAccountManagement';
import { createRegistrarAccount, deleteRegistrarAccount, fetchRegistrarAccounts } from '../../services/api';

jest.mock('../../services/api', () => ({
  createRegistrarAccount: jest.fn(),
  deleteRegistrarAccount: jest.fn(),
  fetchRegistrarAccounts: jest.fn(),
  resetManagedAccountPassword: jest.fn(),
  updateRegistrarAccount: jest.fn(),
}));

const registrar = (id, changes = {}) => ({
  id,
  registrarId: `REG-${id}`,
  accountId: `REG-${id}`,
  fullName: `Registrar ${id}`,
  email: `registrar${id}@plv.edu.ph`,
  isActive: true,
  ...changes,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => true);
  createRegistrarAccount.mockResolvedValue({ data: {} });
  deleteRegistrarAccount.mockResolvedValue({ data: {} });
});

test('count below five keeps Registrar creation enabled', async () => {
  fetchRegistrarAccounts.mockResolvedValue({ data: [1, 2, 3, 4].map(registrar) });
  render(<RegistrarAccountManagement />);

  expect(await screen.findByText('4 / 5 Registrar accounts')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create Registrar' })).toBeEnabled();
});

test('creating the fifth Registrar remains allowed', async () => {
  fetchRegistrarAccounts.mockResolvedValue({ data: [1, 2, 3, 4].map(registrar) });
  render(<RegistrarAccountManagement />);

  fireEvent.change(await screen.findByLabelText('Registrar ID'), { target: { value: 'REG-5' } });
  fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Registrar Five' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'registrar5@plv.edu.ph' } });
  fireEvent.change(screen.getByLabelText('Temporary Password'), { target: { value: 'TemporaryPassword5!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Registrar' }));

  await waitFor(() => expect(createRegistrarAccount).toHaveBeenCalledWith(expect.objectContaining({ registrarId: 'REG-5' })));
});

test('hides Registrar creation after five non-deleted accounts including bootstrap', async () => {
  const accounts = [
    registrar(1, { accountId: 'bootstrap-registrar', fullName: 'Bootstrap Registrar' }),
    ...[2, 3, 4, 5].map(registrar),
  ];
  fetchRegistrarAccounts.mockResolvedValue({ data: accounts });
  render(<RegistrarAccountManagement />);

  expect(await screen.findByText('5 / 5 Registrar accounts')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create Registrar' })).not.toBeInTheDocument();
  expect(screen.getByText(/five-Registrar limit has been reached/i)).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Delete Registrar' })).toHaveLength(5);
});

test('deleting a canonical Registrar frees a frontend slot after refresh', async () => {
  fetchRegistrarAccounts
    .mockResolvedValueOnce({ data: [1, 2, 3, 4, 5].map(registrar) })
    .mockResolvedValue({ data: [1, 2, 3, 4].map(registrar) });
  render(<RegistrarAccountManagement />);

  fireEvent.click((await screen.findAllByRole('button', { name: 'Delete Registrar' }))[0]);
  await waitFor(() => expect(deleteRegistrarAccount).toHaveBeenCalledWith(1));
  expect(await screen.findByText('4 / 5 Registrar accounts')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create Registrar' })).toBeEnabled();
});

test('replacement password fields independently show and hide only typed values', async () => {
  fetchRegistrarAccounts.mockResolvedValue({ data: [registrar(1)] });
  render(<RegistrarAccountManagement />);

  const newPassword = await screen.findByLabelText('New Password');
  const confirmation = screen.getByLabelText('Confirm Password');
  fireEvent.change(newPassword, { target: { value: 'TypedPassword1!' } });
  fireEvent.change(confirmation, { target: { value: 'TypedPassword1!' } });
  expect(newPassword).toHaveAttribute('type', 'password');
  expect(confirmation).toHaveAttribute('type', 'password');

  fireEvent.click(screen.getByRole('button', { name: 'Show new password for Registrar 1' }));
  expect(newPassword).toHaveAttribute('type', 'text');
  expect(confirmation).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByRole('button', { name: 'Hide new password for Registrar 1' }));
  expect(newPassword).toHaveAttribute('type', 'password');

  fireEvent.click(screen.getByRole('button', { name: 'Show password confirmation for Registrar 1' }));
  expect(confirmation).toHaveAttribute('type', 'text');
  fireEvent.click(screen.getByRole('button', { name: 'Hide password confirmation for Registrar 1' }));
  expect(confirmation).toHaveAttribute('type', 'password');
  expect(screen.queryByText(/password_hash/i)).not.toBeInTheDocument();
});
