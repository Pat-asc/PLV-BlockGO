import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StudentEnrollmentManagement from './StudentEnrollmentManagement';
import {
  fetchApprovedStudents,
  fetchAcademicPeriodOptions,
  fetchCurriculum,
  fetchCurriculums,
  enrollExistingStudent,
  registrarBulkEnrollStudents,
  searchExistingStudentsForEnrollment,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchApprovedStudents: jest.fn(),
  fetchAcademicPeriodOptions: jest.fn(),
  fetchCurriculum: jest.fn(),
  fetchCurriculums: jest.fn(),
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
      curriculumId: 7,
      curriculumName: 'BSIT Curriculum 2026',
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
  fetchCurriculum.mockResolvedValue({ data: {
    curriculumId: 7,
    curriculumName: 'BSIT Curriculum 2026',
    curriculumVersion: 'BSIT-2026',
    programName: program,
    programCode: 'BSIT',
    status: 'PUBLISHED',
    subjects: [{
      subjectId: 101,
      yearLevel: 1,
      semester: 'FIRST',
      subjectCode: 'IT101',
      subjectTitle: 'Introduction to Computing',
      units: 3,
      lectureHours: 3,
      laboratoryHours: 0,
      prerequisite: '',
      subjectType: 'Major',
    }],
  } });
  registrarBulkEnrollStudents.mockResolvedValue({ status: 'Success', message: 'Student enrollment saved.' });
  searchExistingStudentsForEnrollment.mockResolvedValue({ data: [
    { id: 77, studentNo: '25-0042', fullName: 'Existing Student', email: 'existing@plv.edu.ph', alreadyEnrolled: false },
    { id: 78, studentNo: '25-0043', fullName: 'Already Enrolled', email: 'enrolled@plv.edu.ph', alreadyEnrolled: true },
  ] });
  enrollExistingStudent.mockResolvedValue({ status: 'Success', message: 'Existing Student enrolled.' });
});

test('manually enrolls a student in the selected academic period and curriculum', async () => {
  render(<StudentEnrollmentManagement programs={[program]} />);

  await screen.findByText('Juan Dela Cruz');
  await waitFor(() => expect(screen.getByLabelText(/curriculum version/i)).toHaveValue('7'));
  expect(screen.getByTestId('enrollment-setup-controls')).toHaveClass('md:grid-cols-2', 'xl:grid-cols-4');

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
  await waitFor(() => expect(screen.getByLabelText(/curriculum version/i)).toHaveValue('7'));
  expect(fetchCurriculums).toHaveBeenCalledWith('PUBLISHED');
});

test('filters current enrollments by the dynamic Program / Course dropdown', async () => {
  fetchApprovedStudents.mockResolvedValue({ students: [
    { id: 1, fullname: 'BSIT Student', studentno: '26-0001', department: program },
    { id: 2, fullname: 'BSA Student', studentno: '26-0002', department: 'Bachelor of Science in Accountancy' },
  ] });
  render(<StudentEnrollmentManagement programs={[program]} />);
  await screen.findByText('BSIT Student');
  expect(screen.getByTestId('student-enrollment-list')).toHaveClass('w-full', 'min-w-0', '[&_table]:w-full');
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

test('shows assigned curriculum metadata without the obsolete inline subject expansion', async () => {
  render(<StudentEnrollmentManagement programs={[program]} />);
  await screen.findByText('Juan Dela Cruz');
  expect(screen.getByText('BSIT Curriculum 2026')).toBeInTheDocument();
  expect(screen.getByText('Version: BSIT-2026')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /view curriculum/i })).toHaveClass('dark:text-sky-300');
  expect(screen.queryByRole('button', { name: /view subjects|hide subjects/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/assigned subjects/i)).not.toBeInTheDocument();
});

test('opens the exact assigned curriculum in the shared modal', async () => {
  render(<StudentEnrollmentManagement programs={[program]} />);
  await screen.findByText('Juan Dela Cruz');
  fireEvent.click(screen.getByRole('button', { name: /view curriculum/i }));

  const dialog = await screen.findByRole('dialog', { name: /assigned curriculum/i });
  await waitFor(() => expect(fetchCurriculum).toHaveBeenCalledWith(7));
  expect(within(dialog).getByText('Introduction to Computing')).toBeInTheDocument();
  expect(within(dialog).getByText(/26-0001.*Juan Dela Cruz/i)).toBeInTheDocument();
  expect(dialog).toHaveClass('dark:bg-slate-900');
});

test('shows Not assigned and no viewer action when an enrollment has no curriculum', async () => {
  fetchApprovedStudents.mockResolvedValue({ students: [{
    id: 43,
    fullname: 'No Curriculum Student',
    studentno: '26-0043',
    department: program,
    yearLevel: '1',
  }] });
  render(<StudentEnrollmentManagement programs={[program]} />);
  await screen.findByText('No Curriculum Student');
  expect(screen.getByText('Not assigned')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /view curriculum/i })).not.toBeInTheDocument();
});

test('keeps curriculum data isolated for students with different assignments', async () => {
  fetchApprovedStudents.mockResolvedValue({ students: [
    { id: 1, fullname: 'First Student', studentno: '26-0001', department: program, yearLevel: '1', curriculumId: 7, curriculumName: 'Curriculum A', curriculumVersion: 'A1' },
    { id: 2, fullname: 'Second Student', studentno: '26-0002', department: program, yearLevel: '1', curriculumId: 8, curriculumName: 'Curriculum B', curriculumVersion: 'B1' },
  ] });
  fetchCurriculum.mockImplementation((id) => Promise.resolve({ data: {
    curriculumId: id,
    curriculumName: id === 7 ? 'Curriculum A' : 'Curriculum B',
    curriculumVersion: id === 7 ? 'A1' : 'B1',
    subjects: [{ subjectId: id, yearLevel: 1, semester: 'FIRST', subjectCode: id === 7 ? 'A101' : 'B101', subjectTitle: id === 7 ? 'First-only subject' : 'Second-only subject', units: 3 }],
  } }));
  render(<StudentEnrollmentManagement programs={[program]} />);
  const buttons = await screen.findAllByRole('button', { name: /view curriculum/i });
  fireEvent.click(buttons[0]);
  expect(await screen.findByText('First-only subject')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /close assigned curriculum/i }));
  fireEvent.click(buttons[1]);
  expect(await screen.findByText('Second-only subject')).toBeInTheDocument();
  expect(screen.queryByText('First-only subject')).not.toBeInTheDocument();
  expect(fetchCurriculum.mock.calls.map(([id]) => id)).toEqual([7, 8]);
});
