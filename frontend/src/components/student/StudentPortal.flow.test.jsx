import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StudentPortal from './StudentPortal';
import { fetchStudentCurriculum, fetchStudentCurrentSubjects, fetchStudentHistoricalGrades, getSystemSetting } from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchStudentCurriculum: jest.fn(), fetchStudentCurrentSubjects: jest.fn(),
  fetchStudentHistoricalGrades: jest.fn(), getSystemSetting: jest.fn(),
  updateStudentProfile: jest.fn(), fetchStudentBlockchainTransactions: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  getSystemSetting.mockResolvedValue({ status: 'Success', value: {} });
  fetchStudentCurrentSubjects.mockResolvedValue({ data: { studentNo: '26-0035', schoolYear: '2026-2027',
    semester: 'FIRST', section: 'BSIT 1-1', yearLevel: 1,
    subjects: [{ subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing', units: 3,
      facultyName: 'To be assigned' }] } });
  fetchStudentCurriculum.mockResolvedValue({ data: { curriculumId: 1, curriculumName: 'BSIT 2026',
    curriculumVersion: '2026', programCode: 'BSIT', programName: 'Bachelor of Science in Information Technology',
    status: 'PUBLISHED', subjects: [{ subjectId: 1, subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing',
      units: 3, yearLevel: 1, semester: 'FIRST', prerequisite: 'IT 100' }] } });
});

test('student subjects and checklist load independently when grade retrieval fails', async () => {
  fetchStudentHistoricalGrades.mockRejectedValue(new Error('Blockchain and database unavailable'));
  render(<StudentPortal studentData={{ name: 'Juan Dela Cruz', studentNo: '26-0035',
    email: '26-0035', department: 'BSIT' }} onLogout={() => {}} />);
  expect(await screen.findByText('IT 101')).toBeInTheDocument();
  expect(fetchStudentCurrentSubjects).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Curriculum Checklist' }));
  await waitFor(() => expect(fetchStudentCurriculum).toHaveBeenCalled());
  expect(await screen.findByText('IT 100')).toBeInTheDocument();
  expect(screen.getByText('In Progress')).toBeInTheDocument();
});

test('missing published curriculum data shows an explicit error while Current Subjects stays visible', async () => {
  fetchStudentHistoricalGrades.mockResolvedValue({ data: [] });
  fetchStudentCurriculum.mockResolvedValue({ status: 'Success', data: null });
  render(<StudentPortal studentData={{ name: 'Juan Dela Cruz', studentNo: '26-0035',
    email: '26-0035', department: 'Bachelor of Science in Information Technology' }} onLogout={() => {}} />);
  expect(await screen.findByText('IT 101')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Curriculum Checklist' }));
  expect(await screen.findAllByText('No published curriculum is assigned to your program.')).not.toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Current Subjects' }));
  expect(screen.getByText('IT 101')).toBeInTheDocument();
});
