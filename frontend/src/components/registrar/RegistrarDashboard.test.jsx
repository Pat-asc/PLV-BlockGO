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
  facultyEncoding: {
    encodedFaculty: 2,
    totalFaculty: 3,
    faculty: [
      { facultyUserId: 10, name: 'Faculty One', email: 'one@plv.edu.ph', department: 'BSIT', encodedWorkloads: 3, hasEncoded: true },
      { facultyUserId: 11, name: 'Faculty Two', email: 'two@plv.edu.ph', department: 'BSIT', encodedWorkloads: 1, hasEncoded: true },
      { facultyUserId: 12, name: 'Faculty Three', email: 'three@plv.edu.ph', department: 'BSA', encodedWorkloads: 0, hasEncoded: false },
    ],
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
  expect(within(screen.getByRole('button', { name: 'Faculty Encoded' })).getByText('2 / 3')).toBeInTheDocument();
  expect(screen.queryByText(/Legacy Chairperson/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Compatibility rows/i)).not.toBeInTheDocument();
});

test('shows each unique Faculty once with encoded workload details', async () => {
  render(<RegistrarDashboard />);
  fireEvent.click(await screen.findByRole('button', { name: 'Faculty Encoded' }));

  expect(screen.getByRole('heading', { name: 'Faculty Encoding Details' })).toBeInTheDocument();
  expect(screen.getAllByText('Faculty One')).toHaveLength(1);
  expect(screen.getAllByText('Faculty Two')).toHaveLength(1);
  expect(screen.getAllByText('Faculty Three')).toHaveLength(1);
  expect(screen.queryByText('3 of 3 active Faculty have encoded grades.')).not.toBeInTheDocument();
  expect(screen.getByText('2 of 3 active Faculty have encoded grades.')).toBeInTheDocument();
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
