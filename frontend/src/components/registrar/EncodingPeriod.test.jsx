import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EncodingPeriod from './EncodingPeriod';
import { fetchAcademicPeriodOptions, getSystemSetting, updateSystemSetting } from '../../services/api';
import { showSystemNotification } from '../../services/NotificationContext';
import { requestSystemConfirmation } from '../../services/SystemDialogContext';

jest.mock('../../services/api', () => ({
  fetchAcademicPeriodOptions: jest.fn(),
  getSystemSetting: jest.fn(),
  updateSystemSetting: jest.fn(),
}));
jest.mock('../../services/NotificationContext', () => ({ showSystemNotification: jest.fn() }));
jest.mock('../../services/SystemDialogContext', () => ({ requestSystemConfirmation: jest.fn() }));

jest.setTimeout(20000);

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  getSystemSetting.mockResolvedValue({ status: 'Error' });
  fetchAcademicPeriodOptions.mockResolvedValue({
    status: 'Success',
    schoolYears: ['2026-2027', '2025-2026'],
    currentSchoolYear: '2026-2027',
    activeAcademicPeriod: { schoolYear: '2026-2027', semester: 'FIRST' },
  });
  updateSystemSetting.mockImplementation(async (_key, value) => ({ status: 'Success', value }));
});

test('shows the Midterm value stored on the server', async () => {
  getSystemSetting.mockResolvedValue({ status: 'Success', value: JSON.stringify({
    schoolYear: '2026-2027', semester: '1st Semester', term: 'midterm',
    startDate: '2026-09-01', endDate: '2026-09-30',
  }) });

  render(<EncodingPeriod />);

  await waitFor(() => expect(screen.getByLabelText('Encoding Term')).toHaveValue('midterm'));
  expect(updateSystemSetting).not.toHaveBeenCalled();
});

test('renders authoritative school years and selects the active year', async () => {
  render(<EncodingPeriod />);
  const year = await screen.findByRole('combobox', { name: 'School Year' });
  await waitFor(() => expect(year).toHaveValue('2026-2027'));
  expect(Array.from(year.options).map((option) => option.value)).toEqual(expect.arrayContaining(['2026-2027', '2025-2026']));
  expect(screen.queryByPlaceholderText('2026-2027')).not.toBeInTheDocument();
});

test('Save Schedule sends the selected academic period and preserves the schedule', async () => {
  let storedValue = JSON.stringify({
    schoolYear: '2025-2026', semester: '1st Semester', term: 'midterm',
    startDate: '2026-09-01', endDate: '2026-09-30',
  });
  getSystemSetting.mockImplementation(async () => ({ status: 'Success', value: storedValue }));
  fetchAcademicPeriodOptions.mockResolvedValue({
    activeAcademicPeriod: { schoolYear: '2025-2026', semester: 'FIRST' },
    schoolYears: ['2025-2026', '2026-2027'],
  });
  updateSystemSetting.mockImplementation(async (_key, value) => {
    storedValue = JSON.stringify({
      ...JSON.parse(value),
      schoolYear: '2026-2027',
      semester: 'Summer',
    });
    return { status: 'Success', value: storedValue };
  });
  const settingEvent = jest.fn();
  window.addEventListener('blockgo:system-setting-changed', settingEvent);
  render(<EncodingPeriod />);
  const year = await screen.findByRole('combobox', { name: 'School Year' });
  await waitFor(() => expect(year).toBeEnabled());
  fireEvent.change(year, { target: { value: '2026-2027' } });
  fireEvent.change(screen.getByLabelText('Semester'), { target: { value: 'Summer' } });
  fireEvent.change(screen.getByLabelText('Encoding Term'), { target: { value: 'finals' } });
  fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-10-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
  await waitFor(() => expect(updateSystemSetting).toHaveBeenCalled());
  const expected = {
    schoolYear: '2026-2027', semester: 'Summer', term: 'finals',
    startDate: '2026-10-01', endDate: '2026-10-31',
  };
  expect(fetchAcademicPeriodOptions).toHaveBeenCalledTimes(1);
  expect(JSON.parse(updateSystemSetting.mock.calls[0][1])).toMatchObject(expected);
  await waitFor(() => expect(screen.getByText('Current Active Academic Period: 2026-2027 · Summer')).toBeInTheDocument());
  expect(year).toHaveValue('2026-2027');
  expect(screen.getByLabelText('Semester')).toHaveValue('Summer');
  expect(JSON.parse(localStorage.getItem('encodingPeriod'))).toMatchObject(expected);
  expect(JSON.parse(settingEvent.mock.calls[0][0].detail.value)).toMatchObject(expected);
  expect(updateSystemSetting).toHaveBeenCalledTimes(1);
  expect(updateSystemSetting.mock.calls.some(([, value]) => JSON.parse(value).term === 'midterm')).toBe(false);
  expect(screen.getByText('Encoding period saved successfully.')).toBeInTheDocument();
  window.removeEventListener('blockgo:system-setting-changed', settingEvent);
});

test('server Finals wins over stale localStorage and the initial Midterm fallback', async () => {
  localStorage.setItem('encodingPeriod', JSON.stringify({ term: 'midterm' }));
  const finals = {
    schoolYear: '2026-2027', semester: '1st Semester', term: 'finals',
    startDate: '2026-10-01', endDate: '2026-10-31',
  };
  getSystemSetting.mockResolvedValue({ status: 'Success', value: JSON.stringify(finals) });

  render(<EncodingPeriod />);

  await waitFor(() => expect(screen.getByLabelText('Encoding Term')).toHaveValue('finals'));
  expect(JSON.parse(localStorage.getItem('encodingPeriod'))).toEqual(finals);
  expect(updateSystemSetting).not.toHaveBeenCalled();
});

test('saved Finals survives unmount and remount from the authoritative server value', async () => {
  let storedValue = JSON.stringify({
    schoolYear: '2026-2027', semester: '1st Semester', term: 'midterm',
    startDate: '2026-09-01', endDate: '2026-09-30',
  });
  getSystemSetting.mockImplementation(async () => ({ status: 'Success', value: storedValue }));
  updateSystemSetting.mockImplementation(async (_key, value) => {
    storedValue = value;
    return { status: 'Success', value: storedValue };
  });

  const view = render(<EncodingPeriod />);
  await waitFor(() => expect(screen.getByLabelText('Encoding Term')).toHaveValue('midterm'));
  fireEvent.change(screen.getByLabelText('Encoding Term'), { target: { value: 'finals' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
  await waitFor(() => expect(screen.getByLabelText('Encoding Term')).toHaveValue('finals'));
  expect(updateSystemSetting).toHaveBeenCalledTimes(1);

  view.unmount();
  render(<EncodingPeriod />);

  await waitFor(() => expect(screen.getByLabelText('Encoding Term')).toHaveValue('finals'));
  expect(updateSystemSetting).toHaveBeenCalledTimes(1);
});

test('a SystemSettingChanged notification refetches Finals without writing a setting', async () => {
  let storedValue = JSON.stringify({
    schoolYear: '2026-2027', semester: '1st Semester', term: 'midterm',
    startDate: '2026-09-01', endDate: '2026-09-30',
  });
  getSystemSetting.mockImplementation(async () => ({ status: 'Success', value: storedValue }));
  render(<EncodingPeriod />);
  await waitFor(() => expect(screen.getByLabelText('Encoding Term')).toHaveValue('midterm'));

  storedValue = JSON.stringify({
    schoolYear: '2026-2027', semester: '1st Semester', term: 'finals',
    startDate: '2026-10-01', endDate: '2026-10-31',
  });
  window.dispatchEvent(new CustomEvent('blockgo:system-setting-changed', {
    detail: { Key: 'encoding_period', Value: storedValue },
  }));

  await waitFor(() => expect(screen.getByLabelText('Encoding Term')).toHaveValue('finals'));
  expect(updateSystemSetting).not.toHaveBeenCalled();
});

test('Save Schedule can establish the first active academic period', async () => {
  fetchAcademicPeriodOptions.mockResolvedValue({
    activeAcademicPeriod: null,
    schoolYears: ['2026-2027'],
    currentSchoolYear: '2026-2027',
  });
  render(<EncodingPeriod />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save Schedule' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
  await waitFor(() => expect(updateSystemSetting).toHaveBeenCalledTimes(1));
  expect(JSON.parse(updateSystemSetting.mock.calls[0][1])).toMatchObject({
    schoolYear: '2026-2027', semester: '2nd Semester', term: 'midterm',
  });
});

test('uses the backend-normalized value when the active period changes during save', async () => {
  updateSystemSetting.mockResolvedValue({ status: 'Success', value: JSON.stringify({
    schoolYear: '2027-2028', semester: '2nd Semester', term: 'midterm',
    startDate: '2026-10-01', endDate: '2026-10-31',
  }) });
  render(<EncodingPeriod />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save Schedule' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
  await waitFor(() => expect(screen.getByText('Current Active Academic Period: 2027-2028 · 2nd Semester')).toBeInTheDocument());
  expect(screen.getByLabelText('School Year')).toHaveValue('2027-2028');
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

test('Save Schedule switches MIDYEAR to FIRST and shows it after reload without resetting assignments', async () => {
  const summer = { schoolYear: '2026-2027', semester: 'MIDYEAR' };
  const first = { schoolYear: '2026-2027', semester: 'FIRST' };
  let active = summer;
  let setting = JSON.stringify({
    schoolYear: '2026-2027', semester: 'Summer', term: 'midterm',
    startDate: '2026-09-01', endDate: '2026-09-30',
  });
  fetchAcademicPeriodOptions.mockImplementation(async () => ({
    status: 'Success', schoolYears: ['2026-2027'], activeAcademicPeriod: active,
  }));
  getSystemSetting.mockImplementation(async () => ({ status: 'Success', value: setting }));
  updateSystemSetting.mockImplementation(async (_key, value) => {
    const requested = JSON.parse(value);
    active = { schoolYear: requested.schoolYear, semester: 'FIRST' };
    setting = JSON.stringify(requested);
    return { status: 'Success', value: setting };
  });
  requestSystemConfirmation.mockResolvedValue(true);
  const onResetEncodingSeason = jest.fn().mockImplementation(async (requested) => {
    expect(requested).toMatchObject({ schoolYear: '2026-2027', semester: '1st Semester' });
    active = first;
    setting = JSON.stringify(requested);
    return {
      status: 'Success',
      academicContext: {
        academicPeriodId: 41,
        ...first,
        term: requested.term,
        startDate: requested.startDate,
        endDate: requested.endDate,
      },
      encodingPeriod: setting,
    };
  });

  const view = render(<EncodingPeriod onResetEncodingSeason={onResetEncodingSeason} />);
  await waitFor(() => expect(screen.getByText('Current Active Academic Period: 2026-2027 · Summer')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Semester'), { target: { value: '1st Semester' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
  await waitFor(() => expect(updateSystemSetting).toHaveBeenCalled());
  expect(JSON.parse(updateSystemSetting.mock.calls[0][1]).semester).toBe('1st Semester');
  expect(active).toEqual(first);
  await waitFor(() => expect(screen.getByText('Current Active Academic Period: 2026-2027 · 1st Semester')).toBeInTheDocument());
  expect(screen.getByLabelText('Semester')).toHaveValue('1st Semester');
  expect(onResetEncodingSeason).not.toHaveBeenCalled();
  view.unmount();
  render(<EncodingPeriod onResetEncodingSeason={onResetEncodingSeason} />);
  await waitFor(() => expect(screen.getByText('Current Active Academic Period: 2026-2027 · 1st Semester')).toBeInTheDocument());
  expect(screen.getByLabelText('Semester')).toHaveValue('1st Semester');
});

test('reopens a historical tuple using the returned active context', async () => {
  getSystemSetting.mockResolvedValue({
    status: 'Success',
    value: JSON.stringify({
      schoolYear: '2026-2027', semester: '2nd Semester', term: 'midterm',
      startDate: '2026-08-01', endDate: '2026-08-31',
    }),
  });
  fetchAcademicPeriodOptions.mockResolvedValue({
    status: 'Success',
    schoolYears: ['2026-2027', '2025-2026'],
    activeAcademicPeriod: { schoolYear: '2026-2027', semester: 'SECOND' },
  });
  requestSystemConfirmation.mockResolvedValue(true);
  const onResetEncodingSeason = jest.fn().mockResolvedValue({
    status: 'Success',
    academicContext: {
      academicPeriodId: 17,
      schoolYear: '2025-2026',
      semester: 'FIRST',
      term: 'finals',
      startDate: '2026-01-05',
      endDate: '2026-01-30',
    },
    // The component must use academicContext, not a stale serialized request.
    encodingPeriod: JSON.stringify({
      schoolYear: '2026-2027', semester: '2nd Semester', term: 'midterm',
      startDate: '2026-08-01', endDate: '2026-08-31',
    }),
  });

  render(<EncodingPeriod onResetEncodingSeason={onResetEncodingSeason} />);
  await waitFor(() => expect(screen.getByLabelText('School Year')).toBeEnabled());

  expect(Array.from(screen.getByLabelText('School Year').options).map(({ value }) => value))
    .toContain('2025-2026');
  expect(Array.from(screen.getByLabelText('Semester').options).map(({ value }) => value))
    .toEqual(['1st Semester', '2nd Semester', 'Summer']);
  expect(Array.from(screen.getByLabelText('Encoding Term').options).map(({ value }) => value))
    .toEqual(['midterm', 'finals']);

  fireEvent.change(screen.getByLabelText('School Year'), { target: { value: '2025-2026' } });
  fireEvent.change(screen.getByLabelText('Semester'), { target: { value: '1st Semester' } });
  fireEvent.change(screen.getByLabelText('Encoding Term'), { target: { value: 'finals' } });
  fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-01-05' } });
  fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-01-30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset Encoding Season' }));

  await waitFor(() => expect(screen.getByText(/Current Active Academic Period: 2025-2026.*1st Semester/)).toBeInTheDocument());
  expect(screen.getAllByText('Finals').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Jan 5, 2026').length).toBeGreaterThan(0);
  expect(JSON.parse(localStorage.getItem('encodingPeriod'))).toEqual({
    schoolYear: '2025-2026', semester: '1st Semester', term: 'finals',
    startDate: '2026-01-05', endDate: '2026-01-30',
  });
  expect(screen.queryByText(/already exists/i)).not.toBeInTheDocument();
  expect(showSystemNotification).toHaveBeenCalledWith(expect.not.stringMatching(/already exists/i));
});
