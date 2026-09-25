import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { fetchUserProfile, forgotPassword, login, requestPasswordResetAssistance, resetPassword } from './services/api';

jest.mock('./services/api', () => ({
  ...jest.requireActual('./services/api'),
  fetchUserProfile: jest.fn(),
  forgotPassword: jest.fn(),
  login: jest.fn(),
  requestPasswordResetAssistance: jest.fn(),
  resetPassword: jest.fn(),
}));

jest.mock('./services/nginxFailover', () => ({
  startNginxFailoverMonitor: jest.fn(() => () => {}),
}));

jest.mock('./components/shared/Chat', () => () => null);

jest.mock('./components/faculty/FacultyPortal', () => ({ facultyData, onLogout }) => (
  <main>
    Faculty Portal for {facultyData.email}
    <button type="button" onClick={onLogout}>Logout</button>
  </main>
));

const tokenFor = (role, username) => {
  const encode = (value) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'none' })}.${encode({ dbRole: role, username })}.signature`;
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  window.confirm = jest.fn();
  jest.clearAllMocks();
});

test('keeps the signed-in account in sessionStorage and shows its role URL', async () => {
  const token = tokenFor('faculty', 'faculty@plv.edu.ph');
  login.mockResolvedValue({ token });
  fetchUserProfile.mockResolvedValue({
    status: 'Success',
    data: { id: 7, email: 'faculty@plv.edu.ph', fullName: 'Test Faculty', role: 'faculty', status: 'APPROVED' },
  });
  window.history.replaceState({}, '', '/login');

  render(<App />);
  fireEvent.change(await screen.findByPlaceholderText(/example@plv.edu.ph/i), { target: { value: 'faculty@plv.edu.ph' } });
  fireEvent.change(screen.getByPlaceholderText(/^password$/i), { target: { value: 'Password1!' } });
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

  await waitFor(() => expect(window.location.pathname).toBe('/faculty'));
  expect(screen.queryByRole('button', { name: /new login tab/i })).not.toBeInTheDocument();
  const chatButton = screen.getByRole('button', { name: /^open chat$/i });
  expect(chatButton).toHaveClass('h-11', 'w-11', 'rounded-full', 'hover:w-32');
  expect(screen.getByText(/^open chat$/i)).toHaveClass('opacity-0', 'group-hover:opacity-100');
  expect(sessionStorage.getItem('blockgo.auth.token')).toBe(token);
  expect(localStorage.getItem('token')).toBeNull();
});

test('renders managed-account login at the stable login route without public registration', async () => {
  render(<App />);
  expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
  expect(screen.getByText(/forgot password/i)).toBeInTheDocument();
  expect(screen.queryByText(/each browser tab keeps an independent account session/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/sign up|register|create account/i)).not.toBeInTheDocument();
});

test('requests a self-service email code and resets the password', async () => {
  forgotPassword.mockResolvedValue({
    message: 'If the account is eligible, password reset instructions have been sent to the registered email.',
  });
  resetPassword.mockResolvedValue({ message: 'Password updated successfully. You can now sign in.' });
  render(<App />);
  fireEvent.click(await screen.findByText(/forgot password/i));
  fireEvent.change(screen.getByPlaceholderText(/registered email/i), {
    target: { value: 'maria.santos@plv.edu.ph' },
  });
  fireEvent.click(screen.getByRole('button', { name: /send reset code/i }));
  await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith('maria.santos@plv.edu.ph'));
  expect(await screen.findByPlaceholderText(/6-digit verification code/i)).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText(/6-digit verification code/i), { target: { value: '123456' } });
  fireEvent.change(screen.getByPlaceholderText(/^new password$/i), { target: { value: 'NewPassword1!' } });
  fireEvent.change(screen.getByPlaceholderText(/confirm new password/i), { target: { value: 'NewPassword1!' } });
  fireEvent.click(screen.getByRole('button', { name: /^reset password$/i }));
  await waitFor(() => expect(resetPassword).toHaveBeenCalledWith({
    email: 'maria.santos@plv.edu.ph', code: '123456', newPassword: 'NewPassword1!',
  }));
  expect(await screen.findByText(/password updated successfully/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
});

test('submits manual assistance only when the user explicitly selects the fallback', async () => {
  requestPasswordResetAssistance.mockResolvedValue({
    message: 'If the account is eligible, a manual password recovery request is now pending with the Registrar.',
  });
  render(<App />);
  fireEvent.click(await screen.findByText(/forgot password/i));
  fireEvent.change(screen.getByPlaceholderText(/registered email/i), {
    target: { value: 'student@plv.edu.ph' },
  });
  fireEvent.click(screen.getByRole('button', { name: /request manual assistance/i }));
  await waitFor(() => expect(requestPasswordResetAssistance).toHaveBeenCalledWith('student@plv.edu.ph'));
  expect(await screen.findByText(/pending with the Registrar/i)).toBeInTheDocument();
  expect(forgotPassword).not.toHaveBeenCalled();
});

test('keeps every account session active when logout confirmation is cancelled', async () => {
  const token = tokenFor('faculty', 'faculty@plv.edu.ph');
  login.mockResolvedValue({ token });
  fetchUserProfile.mockResolvedValue({
    status: 'Success',
    data: { id: 7, email: 'faculty@plv.edu.ph', fullName: 'Test Faculty', role: 'faculty', status: 'APPROVED' },
  });
  window.confirm.mockReturnValue(false);
  window.history.replaceState({}, '', '/login');

  render(<App />);
  fireEvent.change(await screen.findByPlaceholderText(/example@plv.edu.ph/i), { target: { value: 'faculty@plv.edu.ph' } });
  fireEvent.change(screen.getByPlaceholderText(/^password$/i), { target: { value: 'Password1!' } });
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
  await screen.findByText(/faculty portal for faculty@plv.edu.ph/i);

  fireEvent.click(screen.getByRole('button', { name: /^logout$/i }));

  expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to log out?');
  expect(sessionStorage.getItem('blockgo.auth.token')).toBe(token);
  expect(window.location.pathname).toBe('/faculty');
  expect(screen.getByText(/faculty portal for faculty@plv.edu.ph/i)).toBeInTheDocument();
});

test('clears the shared account session only after logout is confirmed', async () => {
  const token = tokenFor('faculty', 'faculty@plv.edu.ph');
  login.mockResolvedValue({ token });
  fetchUserProfile.mockResolvedValue({
    status: 'Success',
    data: { id: 7, email: 'faculty@plv.edu.ph', fullName: 'Test Faculty', role: 'faculty', status: 'APPROVED' },
  });
  window.confirm.mockReturnValue(true);
  window.history.replaceState({}, '', '/login');

  render(<App />);
  fireEvent.change(await screen.findByPlaceholderText(/example@plv.edu.ph/i), { target: { value: 'faculty@plv.edu.ph' } });
  fireEvent.change(screen.getByPlaceholderText(/^password$/i), { target: { value: 'Password1!' } });
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
  await screen.findByText(/faculty portal for faculty@plv.edu.ph/i);

  fireEvent.click(screen.getByRole('button', { name: /^logout$/i }));

  await waitFor(() => expect(window.location.pathname).toBe('/login'));
  expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to log out?');
  expect(sessionStorage.getItem('blockgo.auth.token')).toBeNull();
  expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
});
