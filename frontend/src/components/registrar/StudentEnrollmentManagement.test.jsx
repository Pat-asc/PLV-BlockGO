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
  fetchCrossCurriculumOptions,
  assignCrossCurriculumSubjects,
} from '../../services/api';
import { showSystemNotification } from '../../services/NotificationContext';

jest.mock('../../services/api', () => ({
  fetchApprovedStudents: jest.fn(),
  fetchAcademicPeriodOptions: jest.fn(),
  fetchCurriculum: jest.fn(),
  fetchCurriculums: jest.fn(),
  enrollExistingStudent: jest.fn(),
  registrarBulkEnrollStudents: jest.fn(),
  registrarBulkUpdateStudents: jest.fn(),
  searchExistingStudentsForEnrollment: jest.fn(),
  fetchCrossCurriculumOptions: jest.fn(),
  assignCrossCurriculumSubjects: jest.fn(),
  removeNonRegularSubject: jest.fn(),
}));
jest.mock('../../services/NotificationContext', () => ({ showSystemNotification: jest.fn() }));

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
  fetchCrossCurriculumOptions.mockResolvedValue({
    status: 'Success',
    activeAcademicPeriod: { schoolYear: '2026-2027', semester: 'FIRST' },
    data: [{
      programId: 2,
      programCode: 'BSBA',
      programName: 'Bachelor of Science in Business Administration',
      curriculumId: 12,
      curriculumName: 'BSBA Curriculum 2026',
      curriculumVersion: 'BSBA-2026',
      subjectId: 205,
      subjectCode: 'BA101',
      subjectTitle: 'Principles of Management',
      units: 3,
      prerequisite: '',
      yearLevel: 1,
      semester: 'FIRST',
      facultySectionId: 55,
      section: 'BSBA 1-1',
      schedule: 'MWF 08:00-09:00',
      facultyName: 'Prof. Santos',
    }],
    students: [],
  });
  assignCrossCurriculumSubjects.mockResolvedValue({
    status: 'Success',
    totalStudents: 2,
    succeededStudents: 2,
    failedStudents: 0,
    assignedCount: 2,
    message: 'Assigned 2 cross-curriculum subject(s) across 2 student(s) and automatically marked them Irregular.',
    results: [
      { studentUserId: 1, studentNo: '26-0001', studentName: 'First Student', homeProgram: program, success: true, assignedCount: 1, isIrregular: true, autoMarkedIrregular: true },
      { studentUserId: 2, studentNo: '26-0002', studentName: 'Second Student', homeProgram: program, success: true, assignedCount: 1, isIrregular: true, autoMarkedIrregular: true },
    ],
  });
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

test('uses section and status filters without duplicating the Enrollment Setup program selector', async () => {
  fetchApprovedStudents.mockResolvedValue({ students: [
    { id: 1, fullname: 'Regular Student', studentno: '26-0001', department: program, section: '1-1' },
    { id: 2, fullname: 'Irregular Student', studentno: '26-0002', department: program, section: '1-2', isIrregular: true },
  ] });
  render(<StudentEnrollmentManagement programs={[program]} />);
  await screen.findByText('Regular Student');
  expect(screen.getByTestId('student-enrollment-list')).toHaveClass('w-full', 'min-w-0', '[&_table]:w-full');
  expect(screen.queryByRole('button', { name: 'Program / Course' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Filter enrollments by section'), { target: { value: '1-2' } });
  expect(screen.getByText('Irregular Student')).toBeInTheDocument();
  expect(screen.queryByText('Regular Student')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Filter enrollments by status'), { target: { value: 'Regular' } });
  expect(screen.getByText('No matching students found.')).toBeInTheDocument();
});

test('refreshes the authoritative enrollment list after consecutive CSV uploads without duplicating existing students', async () => {
  const existing = { id: 42, fullname: 'Juan Dela Cruz', studentno: '26-0001', department: program, section: '1-1' };
  const firstNew = { id: 43, fullname: 'Maria Santos', studentno: '26-0002', department: program, section: '' };
  const secondNew = { id: 44, fullname: 'Ana Reyes', studentno: '26-0003', department: program, section: '' };
  fetchApprovedStudents
    .mockResolvedValueOnce({ students: [existing] })
    .mockResolvedValueOnce({ students: [existing, firstNew] })
    .mockResolvedValueOnce({ students: [existing, firstNew, secondNew] });

  render(<StudentEnrollmentManagement programs={[program]} />);
  await screen.findByText('Juan Dela Cruz');
  const input = screen.getByLabelText('Enrollment CSV file');
  fireEvent.change(input, { target: { files: [new File(['First Name,Last Name\nMaria,Santos'], 'first.csv', { type: 'text/csv' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload & Prepare' }));
  expect(await screen.findByText('Maria Santos')).toBeInTheDocument();

  fireEvent.change(input, { target: { files: [new File(['First Name,Last Name\nAna,Reyes'], 'second.csv', { type: 'text/csv' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload & Prepare' }));
  expect(await screen.findByText('Ana Reyes')).toBeInTheDocument();
  expect(screen.getAllByText('Juan Dela Cruz')).toHaveLength(1);
  expect(screen.getAllByText('Maria Santos')).toHaveLength(1);
  expect(fetchApprovedStudents).toHaveBeenCalledTimes(3);
  expect(registrarBulkEnrollStudents).toHaveBeenCalledTimes(2);
  expect(showSystemNotification).toHaveBeenLastCalledWith('Student enrollment saved.', 'success');
});

test('shows Cross-Curriculum actions only for selected students and clears the selection', async () => {
  fetchApprovedStudents.mockResolvedValue({ students: [
    { id: 1, fullname: 'First Student', studentno: '26-0001', department: program, section: '1-1' },
    { id: 2, fullname: 'Second Student', studentno: '26-0002', department: program, section: '1-1' },
  ] });
  render(<StudentEnrollmentManagement programs={[program]} />);
  await screen.findByText('First Student');
  expect(screen.queryByTestId('student-selection-action-bar')).not.toBeInTheDocument();
  expect(screen.queryByTestId('open-cross-curriculum-modal')).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Select First Student'));
  fireEvent.click(screen.getByLabelText('Select Second Student'));
  expect(screen.getByTestId('student-selection-action-bar')).toHaveTextContent('2 students selected');
  expect(screen.getByTestId('open-cross-curriculum-modal')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.queryByTestId('student-selection-action-bar')).not.toBeInTheDocument();
});

test('distinguishes true enrollment emptiness from filtered empty results', async () => {
  fetchApprovedStudents.mockResolvedValue({ students: [] });
  const { unmount } = render(<StudentEnrollmentManagement programs={[program]} />);
  expect(await screen.findByText('No students enrolled yet')).toBeInTheDocument();
  expect(screen.getByText('0 Students')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Enroll New Student' }));
  expect(screen.getByText('Manual Student Enrollment')).toBeInTheDocument();
  unmount();

  fetchApprovedStudents.mockResolvedValue({ students: [{ id: 3, fullname: 'Visible Student', studentno: '26-0003', department: program, section: '1-1' }] });
  render(<StudentEnrollmentManagement programs={[program]} />);
  await screen.findByText('Visible Student');
  fireEvent.change(screen.getByLabelText('Search student enrollments'), { target: { value: 'missing student' } });
  expect(screen.getByText('No matching students found.')).toBeInTheDocument();
  expect(screen.queryByText('No students enrolled yet')).not.toBeInTheDocument();
});

test('renders Regular, Irregular, and Not Sectioned enrollment chips from existing data', async () => {
  fetchApprovedStudents.mockResolvedValue({ students: [
    { id: 1, fullname: 'Regular Student', studentno: '26-0001', department: program, yearLevel: '1', section: '1-1' },
    { id: 2, fullname: 'Irregular Student', studentno: '26-0002', department: program, yearLevel: '2', section: '2-1', isIrregular: true, nonRegularSubjectCount: 2 },
    { id: 3, fullname: 'Unsectioned Student', studentno: '26-0003', department: program, yearLevel: '1', section: '' },
  ] });
  render(<StudentEnrollmentManagement programs={[program]} />);
  await screen.findByText('Regular Student');
  expect(screen.getByTestId('student-irregular-badge-1')).toHaveTextContent('Regular');
  expect(screen.getByTestId('student-irregular-badge-2')).toHaveTextContent('Irregular');
  expect(screen.getByText('+2 Subjects')).toBeInTheDocument();
  expect(screen.getByTestId('student-irregular-badge-3')).toHaveTextContent('Not Sectioned');
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

test('assigns cross-curriculum subjects to multiple selected students and automatically marks them Irregular', async () => {
  fetchApprovedStudents
    .mockResolvedValueOnce({
      students: [
        { id: 1, fullname: 'First Student', studentno: '26-0001', department: program, yearLevel: '1', section: '1-1', isIrregular: false },
        { id: 2, fullname: 'Second Student', studentno: '26-0002', department: program, yearLevel: '1', section: '1-1', isIrregular: false },
      ],
    })
    .mockResolvedValueOnce({
      students: [
        { id: 1, fullname: 'First Student', studentno: '26-0001', department: program, yearLevel: '1', section: '1-1', isIrregular: true },
        { id: 2, fullname: 'Second Student', studentno: '26-0002', department: program, yearLevel: '1', section: '1-1', isIrregular: true },
      ],
    });

  render(<StudentEnrollmentManagement programs={[program]} />);
  await screen.findByText('First Student');
  expect(screen.getByTestId('student-irregular-badge-1')).toHaveTextContent('Regular');
  expect(screen.getByTestId('student-irregular-badge-2')).toHaveTextContent('Regular');

  fireEvent.click(screen.getByLabelText('Select First Student'));
  fireEvent.click(screen.getByLabelText('Select Second Student'));
  fireEvent.click(screen.getByTestId('open-cross-curriculum-modal'));

  const modal = await screen.findByRole('dialog', { name: /add cross-curriculum subjects/i });
  await waitFor(() => expect(fetchCrossCurriculumOptions).toHaveBeenCalledWith([1, 2]));
  expect(within(modal).getByLabelText('Source Program / Department')).toHaveValue('BSBA');
  expect(within(modal).getByLabelText('Source Published Curriculum')).toHaveValue('12');

  fireEvent.click(within(modal).getByLabelText('Select subject BA101'));
  expect(within(modal).getByLabelText('Teaching section for BA101')).toHaveValue('55');

  fireEvent.click(within(modal).getByRole('button', { name: /^Assign Cross-Curriculum Subjects$/i }));
  await waitFor(() => expect(assignCrossCurriculumSubjects).toHaveBeenCalledWith([1, 2], [
    { subjectId: 205, facultySectionId: 55, overrideReason: undefined },
  ]));

  expect(await within(modal).findByTestId('cross-curriculum-result')).toHaveTextContent(/automatically marked them Irregular/i);
  await waitFor(() => expect(screen.getByTestId('student-irregular-badge-1')).toHaveTextContent('Irregular'));
  expect(screen.getByTestId('student-irregular-badge-2')).toHaveTextContent('Irregular');
});
