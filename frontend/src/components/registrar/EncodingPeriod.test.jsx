import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EncodingPeriod from './EncodingPeriod';
import { fetchAcademicPeriodOptions, getSystemSetting, updateSystemSetting } from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchAcademicPeriodOptions: jest.fn(),
  getSystemSetting: jest.fn(),
  updateSystemSetting: jest.fn(),
}));
jest.mock('../../services/NotificationContext', () => ({ showSystemNotification: jest.fn() }));
jest.mock('../../services/SystemDialogContext', () => ({ requestSystemConfirmation: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  getSystemSetting.mockResolvedValue({ status: 'Error' });
  fetchAcademicPeriodOptions.mockResolvedValue({
    status: 'Success',
    schoolYears: ['2026-2027', '2025-2026'],
    currentSchoolYear: '2026-2027',
    activeAcademicPeriod: { schoolYear: '2026-2027', semester: 'FIRST' },
  });
  updateSystemSetting.mockResolvedValue({ status: 'Success' });
});

test('renders authoritative school years and selects the active year', async () => {
  render(<EncodingPeriod />);
  const year = await screen.findByRole('combobox', { name: 'School Year' });
  await waitFor(() => expect(year).toHaveValue('2026-2027'));
  expect(Array.from(year.options).map((option) => option.value)).toEqual(expect.arrayContaining(['2026-2027', '2025-2026']));
  expect(screen.queryByPlaceholderText('2026-2027')).not.toBeInTheDocument();
});

test('changing the year updates the saved encoding-period state', async () => {
  render(<EncodingPeriod />);
  const year = await screen.findByRole('combobox', { name: 'School Year' });
  await waitFor(() => expect(year).toBeEnabled());
  fireEvent.change(year, { target: { value: '2025-2026' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
  await waitFor(() => expect(updateSystemSetting).toHaveBeenCalled());
  expect(JSON.parse(updateSystemSetting.mock.calls[0][1])).toMatchObject({ schoolYear: '2025-2026' });
});

test('keeps semester, term, and encoding dates functional', async () => {
  render(<EncodingPeriod />);
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'School Year' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Semester'), { target: { value: '1st Semester' } });
  fireEvent.change(screen.getByLabelText('Encoding Term'), { target: { value: 'finals' } });
  fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-10-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
  await waitFor(() => expect(updateSystemSetting).toHaveBeenCalled());
  expect(JSON.parse(updateSystemSetting.mock.calls[0][1])).toMatchObject({
    semester: '1st Semester', term: 'finals', startDate: '2026-10-01', endDate: '2026-10-31',
  });
});
