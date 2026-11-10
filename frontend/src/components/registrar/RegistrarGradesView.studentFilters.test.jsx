import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RegistrarGradesView from './RegistrarGradesView';
import { fetchAcademicPeriodOptions, fetchApprovedStudents, assignStudent,
  fetchAllGrades, getSystemSetting, fetchApprovedAdmins, fetchApprovedFaculties, fetchAcademicPrograms } from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchAllGrades: jest.fn(async () => ({ status: 'Success', grades: [] })),
  fetchAcademicPrograms: jest.fn(async () => ({ data: [{ programId: 1, programCode: 'BAC', programName: 'Bachelor of Arts in Communication' }] })),
  fetchAcademicPeriodOptions: jest.fn(), fetchApprovedStudents: jest.fn(), assignStudent: jest.fn(),
  fetchApprovedAdmins: jest.fn(async () => ({ status: 'Success', admins: [] })),
  fetchApprovedFaculties: jest.fn(async () => ({ status: 'Success', faculties: [] })),
  getSystemSetting: jest.fn(async () => ({ status: 'Success', value: null })),
}));
jest.mock('./RegistrarSidebar', () => ({ setActiveTab }) => <button onClick={() => setActiveTab('assigning')}>Account Assignments</button>);
jest.mock('./RegistrarHeader', () => () => null);
jest.mock('./RegistrarDashboard', () => () => null);
jest.mock('../../services/NotificationContext', () => ({ showSystemNotification: jest.fn() }));

beforeEach(() => {
  fetchAllGrades.mockResolvedValue({ data: [] });
  getSystemSetting.mockResolvedValue({ status: 'Success', value: null });
  fetchApprovedAdmins.mockResolvedValue({ status: 'Success', admins: [] });
  fetchApprovedFaculties.mockResolvedValue({ status: 'Success', faculties: [] });
  fetchAcademicPrograms.mockResolvedValue({ data: [{ programId: 1, programCode: 'BAC', programName: 'Bachelor of Arts in Communication' }] });
});

test('loads current-period enrollment and preserves the assignment action and search after refresh', async () => {
  const student = { id: 6, fullname: 'Salazar, Leandro Emilio', studentno: '26-0021',
    department: 'Bachelor of Arts in Communication', programCode: 'BAC', yearLevel: '1',
    section: '1-1', academicSectionId: 9, enrollmentId: 1,
    schoolYear: '2026-2027', semester: 'FIRST', enrollmentStatus: 'ENROLLED' };
  fetchAcademicPeriodOptions.mockResolvedValue({ activeAcademicPeriod: { schoolYear: '2026-2027', semester: 'FIRST' } });
  fetchApprovedStudents.mockResolvedValue({ status: 'Success', students: [student] });
  assignStudent.mockResolvedValue({ status: 'Success' });
  render(<RegistrarGradesView />);
  fireEvent.click(screen.getByRole('button', { name: 'Account Assignments' }));
  await screen.findByText(student.fullname);
  expect(fetchApprovedStudents).toHaveBeenCalledWith({ schoolYear: '2026-2027', semester: 'FIRST' });
  fireEvent.change(screen.getByLabelText('Search student accounts'), { target: { value: 'Salazar' } });
  await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue('1'));
  fireEvent.click(screen.getByRole('button', { name: 'Assign', exact: true }));
  await waitFor(() => expect(assignStudent).toHaveBeenCalledWith(6, {
    Department: student.department, YearLevel: '1', Section: '1-1', SchoolYear: '2026-2027', Semester: 'FIRST',
  }));
  await waitFor(() => expect(fetchApprovedStudents).toHaveBeenCalledTimes(4));
  expect(await screen.findByText(student.fullname)).toBeInTheDocument();
  expect(screen.getByLabelText('Search student accounts')).toHaveValue('Salazar');
});

test('shows promoted year after refresh and reload, supports historical periods, and clears missing enrollment year', async () => {
  const source = { id: 6, fullname: 'Promoted Student', studentno: '26-0021', department: 'BAC',
    programCode: 'BAC', yearLevel: '1', section: '1-1', enrollmentId: 10,
    schoolYear: '2026-2027', semester: 'FIRST', enrollmentStatus: 'ENROLLED' };
  const promoted = { ...source, yearLevel: '2', section: null, academicSectionId: null,
    enrollmentId: 20, schoolYear: '2027-2028' };
  let latest = source;
  fetchAcademicPeriodOptions.mockResolvedValue({ schoolYears: ['2026-2027', '2027-2028'],
    activeAcademicPeriod: { schoolYear: source.schoolYear, semester: source.semester } });
  fetchApprovedStudents.mockImplementation(async (period) => ({ status: 'Success', students: !period
    ? [latest] : period.semester !== 'FIRST' ? [] : period.schoolYear === promoted.schoolYear ? [promoted] : [source] }));
  const view = render(<RegistrarGradesView />);
  fireEvent.click(screen.getByRole('button', { name: 'Account Assignments' }));
  await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue('1'));
  latest = promoted;
  act(() => window.dispatchEvent(new CustomEvent('blockgo:academic-data-changed', { detail: { type: 'students_promoted' } })));
  await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue('2'));
  expect(screen.getByLabelText('Account assignment school year')).toHaveValue('2027-2028');
  expect(screen.getByLabelText('Section')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Filter student year level'), { target: { value: '2' } });
  expect(screen.getByText(source.fullname)).toBeInTheDocument();
  view.unmount();
  render(<RegistrarGradesView />);
  fireEvent.click(screen.getByRole('button', { name: 'Account Assignments' }));
  await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue('2'));
  fireEvent.change(screen.getByLabelText('Account assignment school year'), { target: { value: source.schoolYear } });
  await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue('1'));
  act(() => window.dispatchEvent(new CustomEvent('blockgo:academic-data-changed')));
  await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue('1'));
  expect(screen.getByLabelText('Account assignment school year')).toHaveValue(source.schoolYear);
  fireEvent.change(screen.getByLabelText('Account assignment semester'), { target: { value: 'SECOND' } });
  await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue(''));
  expect(screen.getByText('Unassigned', { selector: 'span' })).toBeInTheDocument();
  expect(screen.getByText('Section: Unassigned')).toBeInTheDocument();
});
