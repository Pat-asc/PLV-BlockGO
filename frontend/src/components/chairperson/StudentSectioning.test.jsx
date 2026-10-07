import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StudentSectioning from './StudentSectioning';
import { fetchAcademicPrograms, fetchApprovedStudents, fetchCurriculum, fetchDepartmentSections } from '../../services/api';

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

test('starts blank and does not load sections until a program is explicitly selected', async () => {
  render(<StudentSectioning />);

  expect(await screen.findByRole('option', { name: /BSIT/ })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Program' })).toHaveValue('');
  expect(screen.getByText('Select a Program to view created sections.')).toBeInTheDocument();
  expect(fetchApprovedStudents).not.toHaveBeenCalled();
  expect(fetchDepartmentSections).not.toHaveBeenCalled();
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

  const row = (await screen.findByText('26-0001')).closest('tr');
  expect(within(row).getByText('BSIT Curriculum 2026')).toBeInTheDocument();
  expect(within(row).getByText('Version: v2026.2')).toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: 'View Curriculum' }));

  await waitFor(() => expect(fetchCurriculum).toHaveBeenCalledWith(91));
  expect(await screen.findByText('Computing Fundamentals')).toBeInTheDocument();
  expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: /assign/i })).not.toBeInTheDocument();
});

test('shows no curriculum assigned without requesting an arbitrary curriculum', async () => {
  fetchApprovedStudents.mockResolvedValue({ students: [{ ...student, curriculumId: null, curriculumName: null, curriculumVersion: null }] });
  render(<StudentSectioning />);
  await screen.findByRole('option', { name: /BSIT/ });
  fireEvent.change(screen.getByRole('combobox', { name: 'Program' }), { target: { value: 'BSIT' } });

  expect(await screen.findByText('No curriculum assigned')).toBeInTheDocument();
  expect(fetchCurriculum).not.toHaveBeenCalled();
});
