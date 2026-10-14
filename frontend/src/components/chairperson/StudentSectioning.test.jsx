import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StudentSectioning from './StudentSectioning';
import { fetchAcademicPrograms, fetchApprovedStudents, fetchCurriculum, fetchDepartmentSections } from '../../services/api';
import { getDefaultSectionName } from '../../utils/studentSectioningHelpers';

jest.mock('../../services/api', () => ({
  fetchAcademicPrograms: jest.fn(),
  fetchApprovedStudents: jest.fn(),
  fetchCurriculum: jest.fn(),
  fetchDepartmentSections: jest.fn(),
}));
jest.mock('../../utils/sharedClientState', () => ({ pushSectioningSharedState: jest.fn() }));

const programs = [
  { programId: 1, programCode: 'BSIT', programName: 'Bachelor of Science in Information Technology' },
  { programId: 2, programCode: 'BSCE', programName: 'Bachelor of Science in Civil Engineering' },
];
const student = {
  id: 7,
  studentno: '26-0001',
  fullname: 'Dela Cruz, Juan',
  department: programs[0].programName,
  programCode: 'BSIT',
  section: '1-1',
  yearLevel: '1',
  curriculumId: 91,
  curriculumName: 'BSIT Curriculum 2026',
  curriculumVersion: 'v2026.2',
  schoolYear: '2026-2027',
  semester: 'FIRST',
  enrollmentId: 701,
  batchYear: 2026,
};
const curriculum = {
  curriculumId: 91,
  curriculumName: 'BSIT Curriculum 2026',
  curriculumVersion: 'v2026.2',
  programCode: 'BSIT',
  programName: programs[0].programName,
  status: 'PUBLISHED',
  subjects: [{ subjectId: 1, subjectCode: 'IT 101', subjectTitle: 'Computing Fundamentals', units: 2, lectureHours: 2, laboratoryHours: 0, prerequisite: 'None', yearLevel: 1, semester: 'FIRST' }],
};

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  fetchAcademicPrograms.mockResolvedValue({ data: programs });
  fetchApprovedStudents.mockResolvedValue({ students: [student] });
  fetchDepartmentSections.mockImplementation(async (program) => ({
    data: program === 'BSIT' ? [{ id: '11', department: 'BSIT', yearLevel: '1', sectionNum: '1' }] : [],
  }));
  fetchCurriculum.mockResolvedValue({ data: curriculum });
});

test('preserves complete authoritative program codes in section names', () => {
  expect(getDefaultSectionName('BSIT', '1-1')).toBe('BSIT 1-1');
  expect(getDefaultSectionName('BSCE', '2-1')).toBe('BSCE 2-1');
  expect(getDefaultSectionName('BSA', '3-1')).toBe('BSA 3-1');
});

test('defaults to the authoritative BSIT program and keeps other programs selectable', async () => {
  render(<StudentSectioning />);

  expect(await screen.findByRole('option', { name: /BSIT/ })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Program' })).toHaveValue('BSIT');
  expect(screen.getByRole('option', { name: /BSCE/ })).toBeInTheDocument();
  await waitFor(() => expect(fetchDepartmentSections).toHaveBeenCalledWith('BSIT'));
});

test('opens the exact Chairperson section roster in a shared internally scrollable modal', async () => {
  fetchApprovedStudents.mockResolvedValue({ students: [
    { ...student, id: 7, studentno: '26-0001', fullname: 'Section One Student', section: '1-1' },
    { ...student, id: 8, studentno: '26-0002', fullname: 'Section Two Student', section: '1-2', enrollmentId: 702 },
  ] });
  fetchDepartmentSections.mockResolvedValue({ data: [
    { id: '11', department: 'BSIT', programCode: 'BSIT', yearLevel: '1', sectionNum: '1' },
    { id: '12', department: 'BSIT', programCode: 'BSIT', yearLevel: '1', sectionNum: '2' },
  ] });
  render(<StudentSectioning />);

  const rosterButtons = await screen.findAllByRole('button', { name: 'View Roster' });
  expect(rosterButtons).toHaveLength(2);
  fireEvent.click(rosterButtons[0]);
  let dialog = screen.getByRole('dialog', { name: /BSIT 1-1.*Student Roster/i });
  expect(within(dialog).getByText('26-0001')).toBeInTheDocument();
  expect(within(dialog).queryByText('26-0002')).not.toBeInTheDocument();
  expect(dialog).toHaveClass('max-h-[90vh]', 'overflow-hidden', 'dark:bg-slate-900');
  expect(screen.getByTestId('chairperson-roster-scroll-area')).toHaveClass('overflow-y-auto');
  fireEvent.click(within(dialog).getByRole('button', { name: /Close .*Student Roster/i }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  fireEvent.click(rosterButtons[1]);
  dialog = screen.getByRole('dialog', { name: /BSIT 1-2.*Student Roster/i });
  expect(within(dialog).getByText('26-0002')).toBeInTheDocument();
  expect(within(dialog).queryByText('26-0001')).not.toBeInTheDocument();
});

test('loads only the selected program and clears the previous program immediately', async () => {
  render(<StudentSectioning />);
  const selector = await screen.findByRole('combobox', { name: 'Program' });

  await screen.findByRole('option', { name: /BSIT/ });
  fireEvent.change(selector, { target: { value: 'BSIT' } });
  expect(selector).toHaveValue('BSIT');
  expect(await screen.findByText('Section 1-1')).toBeInTheDocument();
  expect(fetchDepartmentSections).toHaveBeenLastCalledWith('BSIT');

  fireEvent.change(selector, { target: { value: 'BSCE' } });
  expect(screen.queryByText('Section 1-1')).not.toBeInTheDocument();
  expect(await screen.findByText('No sections created for this program.')).toBeInTheDocument();
  expect(fetchDepartmentSections).toHaveBeenLastCalledWith('BSCE');

  fireEvent.change(selector, { target: { value: '' } });
  expect(screen.getByText('Select a Program to view created sections.')).toBeInTheDocument();
});

test('shows the exact enrolled-student curriculum and opens it read-only', async () => {
  render(<StudentSectioning />);
  await screen.findByRole('option', { name: /BSIT/ });
  fireEvent.change(screen.getByRole('combobox', { name: 'Program' }), { target: { value: 'BSIT' } });

  fireEvent.click(await screen.findByRole('button', { name: 'View Roster' }));
  const dialog = screen.getByRole('dialog', { name: /Student Roster/i });
  const row = within(dialog).getByRole('row', { name: /26-0001/i });
  expect(within(row).getByText('BSIT Curriculum 2026')).toBeInTheDocument();
  expect(within(row).getByText('Version: v2026.2')).toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: 'View Curriculum' }));

  await waitFor(() => expect(fetchCurriculum).toHaveBeenCalledWith(91));
  expect(await screen.findByText('Computing Fundamentals')).toBeInTheDocument();
  expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: /^assign$/i })).not.toBeInTheDocument();
});

test('shows no curriculum assigned without requesting an arbitrary curriculum', async () => {
  fetchApprovedStudents.mockResolvedValue({ students: [{ ...student, curriculumId: null, curriculumName: null, curriculumVersion: null }] });
  render(<StudentSectioning />);
  await screen.findByRole('option', { name: /BSIT/ });
  fireEvent.change(screen.getByRole('combobox', { name: 'Program' }), { target: { value: 'BSIT' } });

  fireEvent.click(await screen.findByRole('button', { name: 'View Roster' }));
  expect(await screen.findByText('No curriculum assigned')).toBeInTheDocument();
  expect(fetchCurriculum).not.toHaveBeenCalled();
});
