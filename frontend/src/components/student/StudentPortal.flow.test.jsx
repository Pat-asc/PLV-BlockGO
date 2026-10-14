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
      units: 3, yearLevel: 1, semester: 'FIRST', prerequisite: 'IT 100' },
    { subjectId: 2, subjectCode: 'IT 201', subjectTitle: 'Data Structures',
      units: 3, yearLevel: 2, semester: 'SECOND', prerequisite: 'IT 101' }] } });
});

const openSecondaryView = (name) => {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name }));
};

test('student subjects and checklist load independently when grade retrieval fails', async () => {
  fetchStudentHistoricalGrades.mockRejectedValue(new Error('Blockchain and database unavailable'));
  render(<StudentPortal studentData={{ name: 'Juan Dela Cruz', studentNo: '26-0035',
    email: '26-0035', department: 'BSIT' }} onLogout={() => {}} />);
  openSecondaryView('Current Subjects');
  expect(await screen.findByText('IT 101')).toBeInTheDocument();
  expect(fetchStudentCurrentSubjects).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Curriculum Checklist' }));
  await waitFor(() => expect(fetchStudentCurriculum).toHaveBeenCalled());
  expect(await screen.findByText('IT 100')).toBeInTheDocument();
  expect(screen.getByText('In Progress')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Year Level' }));
  fireEvent.click(screen.getByRole('option', { name: '2nd Year' }));
  expect(screen.getByText('Data Structures')).toBeInTheDocument();
  expect(screen.getByText('IT 101')).toBeInTheDocument();
});

test('missing published curriculum data shows an explicit error while Current Subjects stays visible', async () => {
  fetchStudentHistoricalGrades.mockResolvedValue({ data: [] });
  fetchStudentCurriculum.mockResolvedValue({ status: 'Success', data: null });
  render(<StudentPortal studentData={{ name: 'Juan Dela Cruz', studentNo: '26-0035',
    email: '26-0035', department: 'Bachelor of Science in Information Technology' }} onLogout={() => {}} />);
  openSecondaryView('Current Subjects');
  expect(await screen.findByText('IT 101')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Curriculum Checklist' }));
  expect(await screen.findAllByText('No published curriculum is assigned to your program.')).not.toHaveLength(0);
  openSecondaryView('Current Subjects');
  expect(screen.getByText('IT 101')).toBeInTheDocument();
});

test('curriculum endpoint 404 renders a friendly empty state instead of the raw API error', async () => {
  fetchStudentHistoricalGrades.mockResolvedValue({ data: [] });
  fetchStudentCurriculum.mockRejectedValue(new Error('HTTP 404: relation lookup failed'));
  render(<StudentPortal studentData={{ name: 'Juan Dela Cruz', studentNo: '26-0035',
    email: '26-0035', department: 'BSIT' }} onLogout={() => {}} />);

  fireEvent.click(screen.getByRole('button', { name: 'Curriculum Checklist' }));
  expect(await screen.findAllByText('No published curriculum checklist is assigned to your account.')).not.toHaveLength(0);
  expect(screen.queryByText('HTTP 404: relation lookup failed')).not.toBeInTheDocument();
});

test('finalized grade returned by the canonical subject API is displayed in the Subject List', async () => {
  fetchStudentHistoricalGrades.mockResolvedValue({ data: [] });
  fetchStudentCurrentSubjects.mockResolvedValue({ data: {
    studentNo: '26-0035', enrollmentId: 1001, schoolYear: '2026-2027', semester: 'FIRST',
    section: 'BSIT 1-1', yearLevel: 1,
    subjects: [{ subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing', units: 3,
      professor: 'Faculty Testing one', enrollmentId: 1001, assignmentCycleId: '22',
      gradeRecordId: 'final-it101', finalizedGrade: 89, gradeEquivalent: '1.75',
      gradeStatus: 'Completed', isFinalized: true, gradeAvailability: 'Finalized',
      blockchainTransactionHash: 'tx-final-it101' }],
  } });

  render(<StudentPortal studentData={{ name: 'Juan Dela Cruz', studentNo: '26-0035',
    email: '26-0035', department: 'BSIT' }} onLogout={() => {}} />);
  openSecondaryView('Current Subjects');
  fireEvent.click(await screen.findByRole('button', { name: /IT 101/ }));
  expect(screen.getByText('1.75')).toBeInTheDocument();
  expect(screen.getByText('Completed')).toBeInTheDocument();
  expect(screen.getByText('tx-final-it101')).toBeInTheDocument();
});

test('keeps only primary academic destinations in main navigation and moves secondary views into Settings', async () => {
  fetchStudentHistoricalGrades.mockResolvedValue({ data: [] });
  render(<StudentPortal studentData={{ name: 'Juan Dela Cruz', studentNo: '26-0035', email: '26-0035', department: 'BSIT' }} onLogout={() => {}} />);

  const mainNavigation = screen.getByRole('navigation', { name: 'Student portal sections' });
  expect(mainNavigation).toHaveTextContent('Grades');
  expect(mainNavigation).toHaveTextContent('Curriculum Checklist');
  expect(mainNavigation).not.toHaveTextContent('More');
  expect(mainNavigation).not.toHaveTextContent('Current Subjects');

  openSecondaryView('Blockchain Transactions');
  expect(await screen.findByRole('heading', { name: 'Blockchain Transactions' })).toBeInTheDocument();
});
