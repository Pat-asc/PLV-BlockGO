import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import PasswordManagement from './PasswordManagement';

jest.mock('../../services/api', () => ({ resetManagedAccountPassword: jest.fn() }));
jest.mock('./PasswordResetRequests', () => () => <div data-testid="password-reset-requests" />);

const students = [
  { id: 1, fullname: 'Daria Santos', studentno: '26-0001', email: 'daria@plv.edu.ph', department: 'BSIT' },
];
const faculties = [
  { id: 2, fullname: 'David Reyes', accountId: 'FAC-002', email: 'david@plv.edu.ph', department: 'BSCS' },
];
const departmentAdmins = [
  { id: 3, fullname: 'Alice Cruz', accountId: 'CHAIR-003', email: 'alice@plv.edu.ph', department: 'Bachelor of Science in Information Technology', programCode: 'BSIT', programName: 'Bachelor of Science in Information Technology' },
];

test('automatically displays matching accounts from every allowed role while typing', () => {
  render(<PasswordManagement students={students} faculties={faculties} departmentAdmins={departmentAdmins} onRefresh={jest.fn()} />);

  fireEvent.change(screen.getByRole('searchbox', { name: 'Search Account' }), { target: { value: 'd' } });

  const results = screen.getByRole('listbox', { name: 'Matching accounts' });
  const options = within(results).getAllByRole('option');
  expect(options).toHaveLength(3);
  expect(options[0]).toHaveTextContent('Daria Santos');
  expect(options[1]).toHaveTextContent('David Reyes');
  expect(options[2]).toHaveTextContent('Alice Cruz');
});

test('selects an account, closes results, and reopens them after the search is edited', () => {
  render(<PasswordManagement students={students} faculties={faculties} departmentAdmins={departmentAdmins} onRefresh={jest.fn()} />);

  const search = screen.getByRole('searchbox', { name: 'Search Account' });
  fireEvent.change(search, { target: { value: 'Dav' } });
  fireEvent.click(within(screen.getByRole('listbox', { name: 'Matching accounts' })).getByRole('option', { name: /David Reyes/i }));

  expect(screen.queryByRole('listbox', { name: 'Matching accounts' })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Account' })).toHaveValue('faculty:2');
  expect(screen.getByRole('button', { name: /reset password/i })).toBeEnabled();

  fireEvent.change(search, { target: { value: 'Davi' } });
  expect(screen.getByRole('listbox', { name: 'Matching accounts' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Account' })).toHaveValue('');
});

test('shows the authoritative Chairperson program in search, dropdown, and selected details', () => {
  render(<PasswordManagement students={students} faculties={faculties} departmentAdmins={departmentAdmins} onRefresh={jest.fn()} />);

  fireEvent.change(screen.getByRole('searchbox', { name: 'Search Account' }), { target: { value: 'BSIT' } });
  const result = within(screen.getByRole('listbox', { name: 'Matching accounts' })).getByRole('option', { name: /Alice Cruz/i });
  expect(result).toHaveTextContent('Alice Cruz');
  expect(result).toHaveTextContent('Department Administrator • BSIT');

  const accountSelect = screen.getByRole('combobox', { name: 'Account' });
  expect(within(accountSelect).getByRole('option', { name: /Alice Cruz.*BSIT/i })).toBeInTheDocument();
  fireEvent.click(result);
  expect(screen.getByLabelText('Selected account details')).toHaveTextContent('Bachelor of Science in Information Technology');
});

test('does not append Chairperson program metadata to Student or Faculty results', () => {
  render(<PasswordManagement students={students} faculties={faculties} departmentAdmins={departmentAdmins} onRefresh={jest.fn()} />);

  fireEvent.change(screen.getByRole('searchbox', { name: 'Search Account' }), { target: { value: 'Daria' } });
  const studentResult = within(screen.getByRole('listbox', { name: 'Matching accounts' })).getByRole('option');
  expect(studentResult).toHaveTextContent('Student');
  expect(studentResult).not.toHaveTextContent('BSIT');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search Account' }), { target: { value: 'David' } });
  const facultyResult = within(screen.getByRole('listbox', { name: 'Matching accounts' })).getByRole('option');
  expect(facultyResult).toHaveTextContent('Faculty');
  expect(facultyResult).not.toHaveTextContent('BSCS');
});
