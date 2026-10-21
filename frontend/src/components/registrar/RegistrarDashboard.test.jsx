import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RegistrarDashboard from './RegistrarDashboard';
import { fetchRegistrarDashboardOverview } from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchRegistrarDashboardOverview: jest.fn(),
}));

const response = (counts = {}) => ({
  status: 'Success',
  filters: { schoolYear: '2026-2027', semester: 'FIRST', term: 'finals' },
  counts: {
    submittedToRegistrar: 4,
    submittedToChairperson: 3,
    chairpersonApproved: 2,
    departmentApproved: 5,
    returned: 1,
    ...counts,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  fetchRegistrarDashboardOverview.mockResolvedValue(response());
});

test('renders authoritative non-zero workflow counts without mixing statuses', async () => {
  render(<RegistrarDashboard />);

  expect(await screen.findByText('2026-2027 • FIRST • finals')).toBeInTheDocument();
  expect(within(screen.getByRole('article', { name: 'Awaiting Registrar' })).getByText('9')).toBeInTheDocument();
  expect(within(screen.getByRole('article', { name: 'Returned to Faculty' })).getByText('1')).toBeInTheDocument();
  expect(within(screen.getByRole('article', { name: 'Legacy Chairperson Review' })).getByText('3')).toBeInTheDocument();
  expect(within(screen.getByRole('article', { name: 'Legacy Chairperson Approved' })).getByText('2')).toBeInTheDocument();
});

test('passes academic and organizational filters to the API', async () => {
  render(<RegistrarDashboard filters={{ schoolYear: '2026-2027', semester: 'First Semester', term: 'finals', department: 'BS Information Technology', program: 'BSIT' }} />);

  await screen.findByRole('article', { name: 'Awaiting Registrar' });
  expect(fetchRegistrarDashboardOverview).toHaveBeenCalledWith(expect.objectContaining({
    schoolYear: '2026-2027',
    semester: 'First Semester',
    term: 'finals',
    department: 'BS Information Technology',
    program: 'BSIT',
    signal: expect.any(AbortSignal),
  }));
});

test('shows zero only when the API returns genuine zero counts', async () => {
  fetchRegistrarDashboardOverview.mockResolvedValue(response({
    submittedToRegistrar: 0, submittedToChairperson: 0, chairpersonApproved: 0, departmentApproved: 0, returned: 0,
  }));
  render(<RegistrarDashboard />);

  expect(await screen.findByText('2026-2027 • FIRST • finals')).toBeInTheDocument();
  expect(within(screen.getByRole('article', { name: 'Awaiting Registrar' })).getByText('0')).toBeInTheDocument();
});

test('refreshes after direct Faculty submission and Registrar finalization events', async () => {
  render(<RegistrarDashboard />);
  await screen.findByRole('article', { name: 'Awaiting Registrar' });

  fireEvent(window, new CustomEvent('blockgo:academic-data-changed', { detail: { reason: 'section_submitted_to_registrar' } }));
  await waitFor(() => expect(fetchRegistrarDashboardOverview).toHaveBeenCalledTimes(2));

  fireEvent(window, new CustomEvent('blockgo:academic-data-changed', { detail: { reason: 'grade_finalized' } }));
  await waitFor(() => expect(fetchRegistrarDashboardOverview).toHaveBeenCalledTimes(3));
});
