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

test('Save Schedule uses the latest active period and preserves the schedule', async () => {
  getSystemSetting.mockResolvedValue({ status: 'Success', value: JSON.stringify({
    schoolYear: '2025-2026', semester: '1st Semester', term: 'midterm',
    startDate: '2026-09-01', endDate: '2026-09-30',
  }) });
  fetchAcademicPeriodOptions.mockResolvedValueOnce({
    activeAcademicPeriod: { schoolYear: '2025-2026', semester: 'FIRST' },
    schoolYears: ['2025-2026', '2026-2027'],
  }).mockResolvedValueOnce({
    activeAcademicPeriod: { schoolYear: '2026-2027', semester: 'MIDYEAR' },
  });
  render(<EncodingPeriod />);
  const year = await screen.findByRole('combobox', { name: 'School Year' });
  await waitFor(() => expect(year).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Encoding Term'), { target: { value: 'finals' } });
  fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-10-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
  await waitFor(() => expect(updateSystemSetting).toHaveBeenCalled());
  const expected = {
    schoolYear: '2026-2027', semester: 'Summer', term: 'finals',
    startDate: '2026-10-01', endDate: '2026-10-31',
  };
  expect(fetchAcademicPeriodOptions).toHaveBeenCalledTimes(2);
  expect(JSON.parse(updateSystemSetting.mock.calls[0][1])).toMatchObject(expected);
  await waitFor(() => expect(year).toHaveValue('2026-2027'));
  expect(screen.getByLabelText('Semester')).toHaveValue('Summer');
  expect(JSON.parse(localStorage.getItem('encodingPeriod'))).toMatchObject(expected);
  expect(screen.getByText('Encoding period saved successfully.')).toBeInTheDocument();
});

test('Save Schedule requires an active academic period', async () => {
  fetchAcademicPeriodOptions.mockResolvedValueOnce({
    activeAcademicPeriod: { schoolYear: '2026-2027', semester: 'FIRST' },
  }).mockResolvedValueOnce({ activeAcademicPeriod: null });
  render(<EncodingPeriod />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save Schedule' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
  expect(await screen.findByText(/academic period must be opened/)).toBeInTheDocument();
  expect(updateSystemSetting).not.toHaveBeenCalled();
});

test('uses the backend-normalized value when the active period changes during save', async () => {
  updateSystemSetting.mockResolvedValue({ status: 'Success', value: JSON.stringify({
    schoolYear: '2027-2028', semester: '2nd Semester', term: 'midterm',
    startDate: '2026-10-01', endDate: '2026-10-31',
  }) });
  render(<EncodingPeriod />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save Schedule' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
  await waitFor(() => expect(screen.getByLabelText('School Year')).toHaveValue('2027-2028'));
  expect(screen.getByLabelText('Semester')).toHaveValue('2nd Semester');
  expect(JSON.parse(localStorage.getItem('encodingPeriod'))).toMatchObject({
    schoolYear: '2027-2028', semester: '2nd Semester',
  });
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

test('uses active academic period over stale saved school year and semester', async () => {
  getSystemSetting.mockResolvedValue({
    status: 'Success',
    value: JSON.stringify({
      schoolYear: '2025-2026',
      semester: '1st Semester',
      startDate: '2026-09-01',
      endDate: '2026-11-16',
      term: 'finals',
    }),
  });

  fetchAcademicPeriodOptions.mockResolvedValue({
    status: 'Success',
    schoolYears: ['2026-2027', '2025-2026'],
    currentSchoolYear: '2026-2027',
    activeAcademicPeriod: {
      schoolYear: '2026-2027',
      semester: 'MIDYEAR',
    },
  });

  render(<EncodingPeriod />);

  const year = await screen.findByRole('combobox', { name: 'School Year' });

  await waitFor(() => {
    expect(year).toHaveValue('2026-2027');
  });

  await waitFor(() => {
    expect(screen.getByLabelText('Semester')).toHaveValue('Summer');
  });

  expect(screen.getByLabelText('Encoding Term')).toHaveValue('finals');
  expect(screen.getByLabelText('Start Date')).toHaveValue('2026-09-01');
  expect(screen.getByLabelText('End Date')).toHaveValue('2026-11-16');
});
