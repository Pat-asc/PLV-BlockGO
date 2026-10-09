import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FacultyPortal from './FacultyPortal';
import { batchUploadGrades, downloadGradingSheet, fetchFacultySections, fetchFacultyStudents, fetchAllGrades, getSystemSetting, issueGrade, submitSectionGrades } from '../../services/api';
import { showSystemNotification } from '../../services/NotificationContext';

jest.mock('../../services/api', () => ({
  fetchFacultySections: jest.fn(), fetchFacultyStudents: jest.fn(), fetchAllGrades: jest.fn(),
  getSystemSetting: jest.fn(), issueGrade: jest.fn(), submitSectionGrades: jest.fn(),
  batchUploadGrades: jest.fn(), downloadGradingSheet: jest.fn(),
}));
jest.mock('../../services/NotificationContext', () => ({
  ...jest.requireActual('../../services/NotificationContext'),
  showSystemNotification: jest.fn(),
}));

jest.setTimeout(15000);

const assignment = {
  id: 77, academicSectionId: 1,
  program: 'BSIT', sectionName: 'BSIT 1-1', subjectCode: 'IT 101', subjectTitle: 'Introduction to IT',
  yearLevel: '1', schoolYear: '2026-2027', semester: '2nd Semester', units: 3,
  rosterStudents: [{ studentId: '2026-0001', email: '26-0001', firstName: 'Juan' }],
};

const gradeWorkbook = (name = 'grades.xlsx') => new File(
  [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])],
  name,
  { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
);

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('registrarAssignments', JSON.stringify([assignment]));
  getSystemSetting.mockResolvedValue({ status: 'Success', value: { startDate: '2020-01-01', endDate: '2099-12-31', semester: '2nd Semester', term: 'midterm' } });
  fetchFacultySections.mockResolvedValue({ sections: [{ id: 77, facultySectionId: 77, assignmentCycleId: 77, department: 'BSIT', section: 'BSIT 1-1',
    canonicalSection: 'BSIT 1-1', academicSectionId: 1, schoolYear: '2026-2027', semester: 'FIRST',
    yearLevel: '1', subject: 'IT 101', subjectTitle: 'Introduction to IT', units: 2 }] });
  fetchFacultyStudents.mockResolvedValue({ students: [{ internalStudentId: 5, facultySectionId: 77, studentNumber: '26-0001', fullName: 'Juan Andres Dela Cruz',
    email: '26-0001', department: 'BSIT', section: '1-1', enrollmentStatus: 'ENROLLED' }] });
  fetchAllGrades.mockResolvedValue({ data: [] });
  issueGrade.mockResolvedValue({ status: 'Success' });
  submitSectionGrades.mockResolvedValue({ status: 'Success' });
  batchUploadGrades.mockResolvedValue({ status: 'Success', totalProcessed: 1, successful: 1 });
  downloadGradingSheet.mockResolvedValue(undefined);
});

const openSection = async () => {
  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Encode Now' }));
};

test('assignment card uses backend curriculum title and 2 units without repeating its subject code', async () => {
  localStorage.clear();
  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);

  expect(await screen.findByText('Introduction to IT')).toBeInTheDocument();
  expect(screen.getAllByText('IT 101')).toHaveLength(1);
  expect(screen.getByText('Section: BSIT 1-1')).toBeInTheDocument();
  expect(screen.getByText('Units: 2')).toBeInTheDocument();
  expect(screen.queryByText(/BSIT 1-1 \(IT 101\) \[77\]/)).not.toBeInTheDocument();
});

test('assignment card displays a stored 4-unit curriculum subject', async () => {
  fetchFacultySections.mockResolvedValue({ sections: [{ id: 78, facultySectionId: 78, assignmentCycleId: 78,
    department: 'BSIT', section: 'BSIT 2-1', canonicalSection: 'BSIT 2-1', academicSectionId: 2,
    schoolYear: '2026-2027', semester: 'FIRST', yearLevel: '2', subject: 'IT 204',
    subjectTitle: 'Advanced Systems', units: 4 }] });
  localStorage.clear();

  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);
  fireEvent.click(await screen.findByRole('tab', { name: /2nd Year/ }));

  expect(screen.getByText('Advanced Systems')).toBeInTheDocument();
  expect(screen.getByText('Units: 4')).toBeInTheDocument();
});

test('unresolved legacy metadata is explicit and never fabricates zero or three units', async () => {
  fetchFacultySections.mockResolvedValue({ sections: [{ id: 79, facultySectionId: 79, assignmentCycleId: 79,
    department: 'BSIT', section: 'Legacy 1', canonicalSection: 'Legacy 1', yearLevel: '1',
    subject: 'LEG 101', subjectTitle: null, units: null, periodResolution: 'UNRESOLVED_LEGACY' }] });
  localStorage.clear();

  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);

  expect(await screen.findByText('Not available')).toBeInTheDocument();
  expect(screen.getByText('Units: N/A')).toBeInTheDocument();
  expect(screen.queryByText(/Units: 0/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Units: 3/)).not.toBeInTheDocument();
});

test('same subject in two FacultySections remains two assignments with one code per card', async () => {
  fetchFacultySections.mockResolvedValue({ sections: [
    { id: 80, facultySectionId: 80, assignmentCycleId: 80, department: 'BSIT', section: 'BSIT 2-1',
      canonicalSection: 'BSIT 2-1', academicSectionId: 2, schoolYear: '2026-2027', semester: 'FIRST',
      yearLevel: '2', subject: 'IT 201', subjectTitle: 'Data Structures and Algorithms', units: 3 },
    { id: 81, facultySectionId: 81, assignmentCycleId: 81, department: 'BSIT', section: 'BSIT 2-2',
      canonicalSection: 'BSIT 2-2', academicSectionId: 3, schoolYear: '2026-2027', semester: 'FIRST',
      yearLevel: '2', subject: 'IT 201', subjectTitle: 'Data Structures and Algorithms', units: 3 },
  ] });
  localStorage.clear();

  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);
  fireEvent.click(await screen.findByRole('tab', { name: /2nd Year/ }));

  expect(screen.getAllByText('IT 201')).toHaveLength(2);
  expect(screen.getByText('Section: BSIT 2-1')).toBeInTheDocument();
  expect(screen.getByText('Section: BSIT 2-2')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Encode Now' })).toHaveLength(2);
});

test('backend curriculum metadata overrides stale local assignment display data', async () => {
  localStorage.setItem('registrarAssignments', JSON.stringify([{ ...assignment,
    subjectTitle: 'Stale Cached Title', units: 3 }]));

  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);

  expect(await screen.findByText('Introduction to IT')).toBeInTheDocument();
  expect(screen.getByText('Units: 2')).toBeInTheDocument();
  expect(screen.queryByText('Stale Cached Title')).not.toBeInTheDocument();
});

test('assignment card keeps a responsive single-card layout for narrow screens', async () => {
  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);

  const title = await screen.findByText('Introduction to IT');
  expect(title.parentElement).toHaveClass('break-words');
  expect(title.closest('article')).toHaveClass('flex', 'h-full', 'flex-col');
});

test('backend enrollment period overrides a stale SECOND assignment and Save sends FIRST', async () => {
  await openSection();
  expect(screen.getByText('26-0001')).toBeInTheDocument();
  fireEvent.change(screen.getAllByPlaceholderText('60-100')[0], { target: { value: '85' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
  await waitFor(() => expect(issueGrade).toHaveBeenCalledWith(expect.objectContaining({
    student_id: '26-0001', school_year: '2026-2027', semester: 'FIRST',
    section: 'BSIT 1-1', subject_code: 'IT 101', subject_name: 'Introduction to IT', units: 2,
  })));
  fireEvent.click(screen.getByRole('button', { name: 'Submit to Chairperson' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, Submit Final Grades' }));
  await waitFor(() => expect(submitSectionGrades).toHaveBeenCalledWith('BSIT', 'BSIT 1-1 (IT 101)', '2026-2027', 'FIRST', '77'));
});

test('legacy Faculty year 2026 resolves to the enrollment year range for Save and Submit', async () => {
  localStorage.setItem('registrarAssignments', JSON.stringify([{ ...assignment, schoolYear: '2026' }]));
  await openSection();
  fireEvent.change(screen.getAllByPlaceholderText('60-100')[0], { target: { value: '85' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit to Chairperson' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, Submit Final Grades' }));
  await waitFor(() => expect(issueGrade).toHaveBeenCalledWith(expect.objectContaining({
    student_id: '26-0001', school_year: '2026-2027', semester: 'FIRST',
  })));
  await waitFor(() => expect(submitSectionGrades).toHaveBeenCalledWith(
    'BSIT', 'BSIT 1-1 (IT 101)', '2026-2027', 'FIRST', '77'));
});

test('legacy Faculty section 1 resolves to academic section BSIT 1-1', async () => {
  fetchFacultySections.mockResolvedValue({ sections: [{ id: 77, assignmentCycleId: 77, department: 'BSIT', section: '1',
    canonicalSection: 'BSIT 1-1', academicSectionId: 1, schoolYear: '2026-2027',
    semester: 'FIRST', yearLevel: '1', subject: 'IT 101' }] });
  await openSection();
  expect(screen.getByText('26-0001')).toBeInTheDocument();
  fireEvent.change(screen.getAllByPlaceholderText('60-100')[0], { target: { value: '85' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
  await waitFor(() => expect(issueGrade).toHaveBeenCalledWith(expect.objectContaining({
    student_id: '26-0001', section: 'BSIT 1-1', semester: 'FIRST',
  })));
});

test('assignment without an authoritative active period cannot save grades', async () => {
  fetchFacultySections.mockResolvedValue({ sections: [{ id: 77, assignmentCycleId: 77, department: 'BSIT', section: 'BSIT 1-1',
    yearLevel: '1', subject: 'IT 101' }] });
  await openSection();
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
  await waitFor(() => expect(showSystemNotification).toHaveBeenCalledWith(
    expect.stringContaining('no active enrolled academic period')));
  expect(issueGrade).not.toHaveBeenCalled();
});

test('Save uses the authenticated Faculty department rather than a subject or section as course', async () => {
  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one',
    department: 'Bachelor of Science in Information Technology' }} onLogout={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Encode Now' }));
  fireEvent.change(screen.getAllByPlaceholderText('60-100')[0], { target: { value: '85' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
  await waitFor(() => expect(issueGrade).toHaveBeenCalledWith(expect.objectContaining({
    student_id: '26-0001', course: 'Bachelor of Science in Information Technology',
    program: 'Bachelor of Science in Information Technology',
  })));
});

test('failed Save never submits a section', async () => {
  issueGrade.mockRejectedValue(new Error('Student account was not found'));
  await openSection();
  fireEvent.change(screen.getAllByPlaceholderText('60-100')[0], { target: { value: '85' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit to Chairperson' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, Submit Final Grades' }));
  await waitFor(() => expect(showSystemNotification).toHaveBeenCalledWith(expect.stringContaining('Student account was not found')));
  expect(submitSectionGrades).not.toHaveBeenCalled();
});

test('an empty authoritative enrollment roster cannot stage grades', async () => {
  fetchFacultyStudents.mockResolvedValue({ students: [] });
  await openSection();
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
  await waitFor(() => expect(showSystemNotification).toHaveBeenCalledWith(expect.stringContaining('no active Registrar enrollment roster')));
  expect(issueGrade).not.toHaveBeenCalled();
});

test('a returned grade retains its note, can be corrected, and resubmits the same assignment', async () => {
  fetchAllGrades.mockResolvedValue({ data: [{ id: 'grade-1', assignment_cycle_id: 77, student_no: '26-0001',
    record_section: 'BSIT 1-1', subject_code: 'IT 101', status: 'Returned', note: 'Correct the grade',
    grade: JSON.stringify({ midterm: 85, finals: '', standing: 'active' }), date: '2026-09-15' }] });
  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'View Grades' }));
  expect(screen.getByText('Correct the grade')).toBeInTheDocument();
  fireEvent.change(screen.getAllByPlaceholderText('60-100')[0], { target: { value: '90' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit to Chairperson' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, Submit Final Grades' }));
  await waitFor(() => expect(issueGrade).toHaveBeenCalledWith(expect.objectContaining({ student_id: '26-0001' })));
  await waitFor(() => expect(submitSectionGrades).toHaveBeenCalledWith('BSIT', 'BSIT 1-1 (IT 101)', '2026-2027', 'FIRST', '77'));
});

test('chairperson-approved grades stay locked against Faculty editing', async () => {
  fetchAllGrades.mockResolvedValue({ data: [{ id: 'grade-1', assignment_cycle_id: 77, student_no: '26-0001',
    record_section: 'BSIT 1-1', subject_code: 'IT 101', status: 'ChairpersonApproved',
    grade: JSON.stringify({ midterm: 85, finals: '', standing: 'active' }), date: '2026-09-15' }] });
  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'View Grades' }));
  expect(screen.getByRole('button', { name: 'Save Draft' })).toBeDisabled();
  expect(screen.getAllByPlaceholderText('60-100')[0]).toBeDisabled();
});

test('Bulk Upload sends FacultySections.id instead of academicSectionId', async () => {
  fetchFacultySections.mockResolvedValue({ sections: [{ id: 123, facultySectionId: 123, assignmentCycleId: '123',
    department: 'BSIT', section: 'BSIT 1-1', canonicalSection: 'BSIT 1-1', academicSectionId: 45,
    schoolYear: '2026-2027', semester: 'FIRST', yearLevel: '1', subject: 'IT 101' }] });
  fetchFacultyStudents.mockResolvedValue({ students: [{ internalStudentId: 5, facultySectionId: 123,
    studentNumber: '26-0001', fullName: 'Juan Andres Dela Cruz', email: 'student@plv.edu.ph',
    enrollmentStatus: 'ENROLLED' }] });
  await openSection();

  const file = gradeWorkbook();
  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [file] } });

  await waitFor(() => expect(batchUploadGrades).toHaveBeenCalledWith(file, expect.objectContaining({
    facultySectionId: '123',
    academicSectionId: 45,
    subjectCode: 'IT 101',
    section: 'BSIT 1-1',
  })));
  expect(batchUploadGrades.mock.calls[0][1].facultySectionId).not.toBe(45);
});

test('offers only the XLSX grading template for the Faculty assignment', async () => {
  await openSection();
  expect(screen.queryByText(/accepted formats/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Bulk upload grades workbook')).toHaveAttribute(
    'accept',
    '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );

  fireEvent.click(screen.getByRole('button', { name: 'Excel Template' }));
  expect(screen.queryByRole('button', { name: 'CSV Template' })).not.toBeInTheDocument();
  await waitFor(() => expect(downloadGradingSheet).toHaveBeenCalledTimes(1));
  const suggestedName = downloadGradingSheet.mock.calls[0][1];
  expect(suggestedName).toMatch(/_grading_sheet$/);
  expect(downloadGradingSheet).toHaveBeenCalledWith('77', suggestedName, 'xlsx');
});

test('rejects a CSV grade upload before calling the API', async () => {
  await openSection();
  const file = new File(['Student ID,Grade\n26-0001,90'], 'grades.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [file] } });
  const dialog = await screen.findByRole('dialog', { name: 'Batch Upload Failed' });
  expect(dialog).toHaveTextContent('Please upload an XLSX grading template');
  expect(batchUploadGrades).not.toHaveBeenCalled();
});

test('successful Bulk Upload reports exact context and an editable Draft without claiming an IPFS commit', async () => {
  await openSection();
  const file = gradeWorkbook();

  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [file] } });

  const dialog = await screen.findByRole('dialog', { name: 'Upload Successful' });
  expect(dialog).toHaveTextContent('BSIT 1-1');
  expect(dialog).toHaveTextContent('IT 101');
  expect(dialog).toHaveTextContent('midterm');
  expect(dialog).toHaveTextContent('Status: Draft - grades remain editable.');
  expect(dialog).toHaveTextContent('No IPFS upload or Fabric write occurs during Draft import');
  expect(dialog).not.toHaveTextContent(/uploaded to IPFS|archived successfully/i);
  expect(submitSectionGrades).not.toHaveBeenCalled();
});

test.each(['final', 'finals', 'FINAL', 'FINALS'])('normalizes %s encoding season to the canonical finals upload term', async (term) => {
  getSystemSetting.mockResolvedValue({
    status: 'Success',
    value: { startDate: '2020-01-01', endDate: '2099-12-31', semester: '1st Semester', term },
  });
  await openSection();
  const file = gradeWorkbook('finals.xlsx');
  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [file] } });

  await waitFor(() => expect(batchUploadGrades).toHaveBeenCalledWith(file, expect.objectContaining({
    term: 'finals', facultySectionId: '77', academicSectionId: 1,
  })));
});

test('a rejected Bulk Upload preserves manually entered grades and shows the backend error', async () => {
  batchUploadGrades.mockRejectedValue(new Error('The workbook belongs to a different Faculty assignment.'));
  await openSection();
  const gradeInput = screen.getAllByPlaceholderText('60-100')[0];
  fireEvent.change(gradeInput, { target: { value: '88' } });
  const file = gradeWorkbook('wrong-assignment.xlsx');
  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [file] } });

  const dialog = await screen.findByRole('dialog', { name: 'Batch Upload Failed' });
  expect(dialog).toHaveTextContent('The workbook belongs to a different Faculty assignment.');
  expect(dialog).toHaveTextContent('Nothing was submitted or finalized.');
  expect(gradeInput).toHaveValue(88);
});

test('a backend-closed encoding period uses the failure modal and saves no upload', async () => {
  batchUploadGrades.mockRejectedValue(new Error('The grade encoding period is closed.'));
  await openSection();
  const file = gradeWorkbook();

  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [file] } });

  const dialog = await screen.findByRole('dialog', { name: 'Batch Upload Failed' });
  expect(dialog).toHaveTextContent('The grade encoding period is closed.');
  expect(dialog).toHaveTextContent('Nothing was submitted or finalized.');
  expect(submitSectionGrades).not.toHaveBeenCalled();
});

test('a Midterm upload modal reports only the active term as accepted workflow data', async () => {
  await openSection();
  const file = gradeWorkbook('mixed-terms.xlsx');
  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [file] } });

  const dialog = await screen.findByRole('dialog', { name: 'Upload Successful' });
  expect(dialog).toHaveTextContent('Term');
  expect(within(dialog).getByText(/^midterm$/i)).toBeInTheDocument();
  expect(within(dialog).queryByText(/^finals$/i)).not.toBeInTheDocument();
  expect(batchUploadGrades).toHaveBeenCalledWith(file, expect.objectContaining({ term: 'midterm' }));
});

test('switching exact FacultySections replaces the visible roster instead of merging students', async () => {
  fetchFacultySections.mockResolvedValue({ sections: [
    { id: 77, facultySectionId: 77, department: 'BSIT', section: 'BSIT 1-1', canonicalSection: 'BSIT 1-1',
      academicSectionId: 1, schoolYear: '2026-2027', semester: 'FIRST', yearLevel: '1', subject: 'IT 101' },
    { id: 88, facultySectionId: 88, department: 'BSIT', section: 'BSIT 1-2', canonicalSection: 'BSIT 1-2',
      academicSectionId: 2, schoolYear: '2026-2027', semester: 'FIRST', yearLevel: '1', subject: 'IT 101' },
  ] });
  fetchFacultyStudents.mockImplementation((_, facultySectionId) => Promise.resolve({ students:
    String(facultySectionId) === '77'
      ? [{ internalStudentId: 5, facultySectionId: 77, studentNumber: '26-0001', fullName: 'Section A Student',
          email: 'a@plv.edu.ph', enrollmentStatus: 'ENROLLED' }]
      : [{ internalStudentId: 6, facultySectionId: 88, studentNumber: '26-0002', fullName: 'Section B Student',
          email: 'b@plv.edu.ph', enrollmentStatus: 'ENROLLED' }]
  }));

  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);
  const sectionButtons = await screen.findAllByRole('button', { name: 'Encode Now' });
  fireEvent.click(sectionButtons[0]);
  expect(screen.getByText('Section A Student')).toBeInTheDocument();
  expect(screen.queryByText('Section B Student')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Back to section' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Encode Now' })[1]);
  expect(screen.getByText('Section B Student')).toBeInTheDocument();
  expect(screen.queryByText('Section A Student')).not.toBeInTheDocument();
  expect(fetchFacultyStudents).toHaveBeenCalledWith('faculty@plv.edu.ph', '77');
  expect(fetchFacultyStudents).toHaveBeenCalledWith('faculty@plv.edu.ph', '88');
});

test('bulk-uploaded Draft values remain editable and a manual correction can be saved', async () => {
  batchUploadGrades.mockImplementation(async () => {
    fetchAllGrades.mockResolvedValue({ data: [{
      id: 'bulk-grade-1', assignment_cycle_id: 77, student_no: '26-0001',
      record_section: 'BSIT 1-1', subject_code: 'IT 101', status: 'Draft',
      grade: JSON.stringify({ midterm: 80, finals: '', standing: 'active' }), date: '2026-09-20',
    }] });
    return { status: 'Success', totalProcessed: 1, successful: 1 };
  });
  await openSection();

  const file = gradeWorkbook();
  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [file] } });

  const gradeInput = screen.getAllByPlaceholderText('60-100')[0];
  await waitFor(() => expect(gradeInput).toHaveValue(80));
  expect(gradeInput).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save Draft' })).toBeEnabled();

  fireEvent.change(gradeInput, { target: { value: '85' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
  await waitFor(() => expect(issueGrade).toHaveBeenCalledWith(expect.objectContaining({
    student_id: '26-0001',
    grade: expect.stringContaining('"midterm":85'),
  })));
});

test('Finals Bulk Upload awaits the backend reload and displays the persisted student value', async () => {
  getSystemSetting.mockResolvedValue({ status: 'Success', value: {
    startDate: '2020-01-01', endDate: '2099-12-31', semester: '1st Semester', term: 'finals',
  } });
  batchUploadGrades.mockImplementation(async () => {
    fetchAllGrades.mockResolvedValue({ data: [{
      id: 'finals-grade-1', assignment_cycle_id: 77, student_no: '26-0001',
      record_section: 'BSIT 1-1', subject_code: 'IT 101', status: 'Draft',
      grade: JSON.stringify({ midterm: '88.50', finals: '91.50', standing: 'active' }), date: '2026-10-09',
    }] });
    return { status: 'Success', totalProcessed: 1, successful: 1, failed: 0 };
  });
  await openSection();

  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [gradeWorkbook('finals.xlsx')] } });

  await waitFor(() => expect(screen.getAllByPlaceholderText('60-100')[1]).toHaveValue(91.5));
  expect(fetchAllGrades.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(screen.getByRole('dialog', { name: 'Upload Successful' })).toHaveTextContent('1 of 1 grade rows were saved');
});

test('Finals Bulk Upload reloads a persisted INC standing instead of showing a missing student grade', async () => {
  getSystemSetting.mockResolvedValue({ status: 'Success', value: {
    startDate: '2020-01-01', endDate: '2099-12-31', semester: '1st Semester', term: 'finals',
  } });
  batchUploadGrades.mockImplementation(async () => {
    fetchAllGrades.mockResolvedValue({ data: [{
      id: 'finals-special-1', assignment_cycle_id: 77, student_no: '26-0001',
      record_section: 'BSIT 1-1', subject_code: 'IT 101', status: 'Draft',
      grade: JSON.stringify({ midterm: '88.50', finals: '', standing: 'incomplete' }), date: '2026-10-09',
    }] });
    return { status: 'Success', totalProcessed: 1, successful: 1, failed: 0 };
  });
  await openSection();

  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [gradeWorkbook('finals-special.xlsx')] } });

  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('incomplete'));
  expect(screen.getAllByPlaceholderText('60-100')[1]).toHaveValue(null);
});

test('partial Bulk Upload reports invariant counts and the exact failed workbook row', async () => {
  batchUploadGrades.mockResolvedValue({
    status: 'Partial Success', totalProcessed: 2, successful: 1, failed: 1,
    errors: [{ rowNumber: 3, studentId: '26-0002', code: 'TRUSTED_MIDTERM_NOT_FOUND', reason: 'Student is not ENROLLED.' }],
  });
  await openSection();
  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [gradeWorkbook()] } });

  const dialog = await screen.findByRole('dialog', { name: 'Upload Partially Completed' });
  expect(dialog).toHaveTextContent('Processed: 2 | Saved: 1 | Failed: 1');
  expect(dialog).toHaveTextContent('26-0002');
  expect(dialog).toHaveTextContent('TRUSTED_MIDTERM_NOT_FOUND');
  expect(dialog).toHaveTextContent('Student is not ENROLLED.');
  expect(within(dialog).getByText('3')).toBeInTheDocument();
});

test('fully rejected Bulk Upload retains backend counts and row-specific errors', async () => {
  const error = new Error('No grade rows were saved.');
  error.data = {
    totalProcessed: 1, successful: 0, failed: 1,
    errors: [{ rowNumber: 2, studentId: '26-9999', code: 'TRUSTED_MIDTERM_NOT_FOUND', reason: 'Student ID is not in this assignment roster.' }],
  };
  batchUploadGrades.mockRejectedValue(error);
  await openSection();
  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [gradeWorkbook()] } });

  const dialog = await screen.findByRole('dialog', { name: 'Batch Upload Failed' });
  expect(dialog).toHaveTextContent('Processed: 1 | Saved: 0 | Failed: 1');
  expect(dialog).toHaveTextContent('26-9999');
  expect(dialog).toHaveTextContent('TRUSTED_MIDTERM_NOT_FOUND');
  expect(dialog).toHaveTextContent('Student ID is not in this assignment roster.');
  expect(within(dialog).getByText('2')).toBeInTheDocument();
});

test('only explicit submission locks a bulk-imported Draft, while Returned remains editable', async () => {
  fetchAllGrades.mockResolvedValue({ data: [{ id: 'grade-1', assignment_cycle_id: 77, student_no: '26-0001',
    record_section: 'BSIT 1-1', subject_code: 'IT 101', status: 'SubmittedToChairperson',
    grade: JSON.stringify({ midterm: 85, finals: '', standing: 'active' }), date: '2026-09-20' }] });
  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'View Grades' }));
  expect(screen.getAllByPlaceholderText('60-100')[0]).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save Draft' })).toBeDisabled();

  fetchAllGrades.mockResolvedValue({ data: [{ id: 'grade-1', assignment_cycle_id: 77, student_no: '26-0001',
    record_section: 'BSIT 1-1', subject_code: 'IT 101', status: 'Returned', note: 'Revise',
    grade: JSON.stringify({ midterm: 85, finals: '', standing: 'active' }), date: '2026-09-21' }] });
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.getAllByPlaceholderText('60-100')[0]).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Save Draft' })).toBeEnabled();
});

test('an old grade row cannot add a student who is absent from the current roster', async () => {
  fetchAllGrades.mockResolvedValue({ data: [
    { id: 'current', assignment_cycle_id: 77, student_no: '26-0001', record_section: 'BSIT 1-1',
      subject_code: 'IT 101', status: 'Draft', grade: JSON.stringify({ midterm: 85 }) },
    { id: 'historical-outsider', assignment_cycle_id: 77, student_no: '26-9999', record_section: 'BSIT 1-1',
      subject_code: 'IT 101', status: 'Finalized', grade: JSON.stringify({ midterm: 90 }) },
  ] });

  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'View Grades' }));

  expect(screen.getByText('26-0001')).toBeInTheDocument();
  expect(screen.queryByText('26-9999')).not.toBeInTheDocument();
  expect(screen.queryByText('historical-outsider')).not.toBeInTheDocument();
});
