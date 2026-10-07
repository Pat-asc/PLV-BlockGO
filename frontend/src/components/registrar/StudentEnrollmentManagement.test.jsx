import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StudentEnrollmentManagement from './StudentEnrollmentManagement';
import {
  fetchApprovedStudents,
  fetchAcademicPeriodOptions,
  fetchCurriculums,
  fetchEnrolledStudentSubjects,
  enrollExistingStudent,
  registrarBulkEnrollStudents,
  searchExistingStudentsForEnrollment,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchApprovedStudents: jest.fn(),
  fetchAcademicPeriodOptions: jest.fn(),
  fetchCurriculums: jest.fn(),
  fetchEnrolledStudentSubjects: jest.fn(),
  enrollExistingStudent: jest.fn(),
  registrarBulkEnrollStudents: jest.fn(),
  registrarBulkUpdateStudents: jest.fn(),
  searchExistingStudentsForEnrollment: jest.fn(),
}));

const program = 'Bachelor of Science in Information Technology';

beforeEach(() => {
  jest.clearAllMocks();
  fetchApprovedStudents.mockResolvedValue({
    status: 'Success',
    students: [{
      id: 42,
      fullname: 'Juan Dela Cruz',
      studentno: '26-0001',
      department: program,
      yearLevel: '1',
      section: '1-1',
      schoolYear: '2026-2027',
      semester: 'FIRST',
      curriculumVersion: 'BSIT-2026',
      enrollmentStatus: 'ENROLLED',
    }],
  });
  fetchCurriculums.mockResolvedValue({
    status: 'Success',
    data: [{
      curriculumId: 7,
      curriculumName: 'BSIT Curriculum 2026',
      curriculumVersion: 'BSIT-2026',
      programName: program,
      programCode: 'BSIT',
    }],
  });
  fetchAcademicPeriodOptions.mockResolvedValue({
    activeAcademicPeriod: { schoolYear: '2026-2027', semester: 'FIRST' },
  });
  registrarBulkEnrollStudents.mockResolvedValue({ status: 'Success', message: 'Student enrollment saved.' });
  searchExistingStudentsForEnrollment.mockResolvedValue({ data: [
    { id: 77, studentNo: '25-0042', fullName: 'Existing Student', email: 'existing@plv.edu.ph', alreadyEnrolled: false },
    { id: 78, studentNo: '25-0043', fullName: 'Already Enrolled', email: 'enrolled@plv.edu.ph', alreadyEnrolled: true },
  ] });
  enrollExistingStudent.mockResolvedValue({ status: 'Success', message: 'Existing Student enrolled.' });
  fetchEnrolledStudentSubjects.mockResolvedValue({ data: { subjects: [] } });
});

test('manually enrolls a student in the selected academic period and curriculum', async () => {
  render(<StudentEnrollmentManagement programs={[program]} />);

  await screen.findByText('Juan Dela Cruz');
  await waitFor(() => expect(screen.getByLabelText(/curriculum version/i)).toHaveValue('7'));

  expect(screen.getByLabelText(/active academic period/i)).toHaveValue('2026-2027 · FIRST');
  expect(screen.queryByLabelText(/^semester/i)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^year level/i), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: /new student/i }));
  expect(screen.getByLabelText(/^sex/i)).toBeRequired();
  fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Maria' } });
  fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Santos' } });
  fireEvent.change(screen.getByLabelText(/^sex/i), { target: { value: 'Female' } });
  fireEvent.change(screen.getByLabelText(/birthdate/i), { target: { value: '2006-02-28' } });
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'maria.santos@plv.edu.ph' } });
  fireEvent.change(screen.getByLabelText(/contact number/i), { target: { value: '09123456789' } });
  fireEvent.change(screen.getByLabelText(/home address/i), { target: { value: 'Valenzuela City' } });
  fireEvent.click(screen.getByRole('button', { name: /save student/i }));

  await waitFor(() => expect(registrarBulkEnrollStudents).toHaveBeenCalled());
  const [file, department, context] = registrarBulkEnrollStudents.mock.calls[0];
  expect(file).toBeInstanceOf(File);
  expect(file.name).toBe('manual-student-enrollment.csv');
  expect(department).toBe(program);
  expect(context).toEqual({
    curriculumId: '7',
    schoolYear: '2026-2027',
    yearLevel: '2',
    semester: 'FIRST',
  });
});

test('blocks enrollment clearly when no active academic period exists', async () => {
  fetchAcademicPeriodOptions.mockResolvedValue({ activeAcademicPeriod: null });
  render(<StudentEnrollmentManagement programs={[program]} />);
  expect(await screen.findByText(/No active academic period is configured/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/active academic period/i)).toHaveValue('Not configured');
});

test('filters current enrollments by the dynamic Program / Course dropdown', async () => {
  fetchApprovedStudents.mockResolvedValue({ students: [
    { id: 1, fullname: 'BSIT Student', studentno: '26-0001', department: program },
    { id: 2, fullname: 'BSA Student', studentno: '26-0002', department: 'Bachelor of Science in Accountancy' },
  ] });
  render(<StudentEnrollmentManagement programs={[program]} />);
  await screen.findByText('BSIT Student');
  fireEvent.click(screen.getByRole('button', { name: 'Program / Course' }));
  fireEvent.click(screen.getByRole('option', { name: 'Bachelor of Science in Accountancy' }));
  expect(screen.getByText('BSA Student')).toBeInTheDocument();
  expect(screen.queryByText('BSIT Student')).not.toBeInTheDocument();
});

test('accepts a newly loaded active program without a hardcoded mapping', async () => {
  const newProgram = 'Bachelor of Science in Data Science';
  const { rerender } = render(<StudentEnrollmentManagement programs={[program]} />);
  await screen.findByText('Juan Dela Cruz');
  rerender(<StudentEnrollmentManagement programs={[program, newProgram]} />);

  const programSelect = screen.getByLabelText(/academic program/i);
  expect(Array.from(programSelect.options).map((option) => option.value)).toContain(newProgram);
  fireEvent.change(programSelect, { target: { value: newProgram } });
  expect(programSelect).toHaveValue(newProgram);
});

test('searches for and enrolls an existing Student identity without creating a new account', async () => {
  render(<StudentEnrollmentManagement programs={[program]} />);
  await screen.findByText('Juan Dela Cruz');
  fireEvent.click(screen.getByRole('button', { name: /^existing student$/i }));
  fireEvent.click(screen.getAllByRole('button', { name: /^existing student$/i })[1]);
  fireEvent.change(screen.getByLabelText(/search existing student/i), { target: { value: '25-0042' } });
  await waitFor(() => expect(searchExistingStudentsForEnrollment).toHaveBeenCalledWith('25-0042'));
  fireEvent.click(await screen.findByRole('option', { name: /25-0042.*existing student/i }));
  fireEvent.click(screen.getByRole('button', { name: /enroll existing student/i }));
  await waitFor(() => expect(enrollExistingStudent).toHaveBeenCalledWith('77', {
    program,
    yearLevel: '1',
    curriculumId: 7,
    nstpOption: undefined,
  }));
  expect(registrarBulkEnrollStudents).not.toHaveBeenCalled();
});

test('shows a clear empty state when the exact-period enrollment has no assigned subjects', async () => {
  render(<StudentEnrollmentManagement programs={[program]} />);
  await screen.findByText('Juan Dela Cruz');
  fireEvent.click(screen.getByRole('button', { name: /view subjects/i }));
  expect(await screen.findByText('No subjects assigned yet.')).toBeInTheDocument();
  expect(fetchEnrolledStudentSubjects).toHaveBeenCalledWith(42, '2026-2027', 'FIRST');
});
