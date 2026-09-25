import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FacultyPortal from './FacultyPortal';
import { batchUploadGrades, fetchFacultySections, fetchFacultyStudents, fetchAllGrades, getSystemSetting, issueGrade, submitSectionGrades } from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchFacultySections: jest.fn(), fetchFacultyStudents: jest.fn(), fetchAllGrades: jest.fn(),
  getSystemSetting: jest.fn(), issueGrade: jest.fn(), submitSectionGrades: jest.fn(),
  batchUploadGrades: jest.fn(), downloadGradingSheet: jest.fn(),
}));

jest.setTimeout(15000);

const assignment = {
  id: 77, academicSectionId: 1,
  program: 'BSIT', sectionName: 'BSIT 1-1', subjectCode: 'IT 101', subjectTitle: 'Introduction to IT',
  yearLevel: '1', schoolYear: '2026-2027', semester: '2nd Semester',
  rosterStudents: [{ studentId: '2026-0001', email: '26-0001', firstName: 'Juan' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  window.alert = jest.fn();
  localStorage.setItem('registrarAssignments', JSON.stringify([assignment]));
  getSystemSetting.mockResolvedValue({ status: 'Success', value: { startDate: '2020-01-01', endDate: '2099-12-31', semester: '2nd Semester', term: 'midterm' } });
  fetchFacultySections.mockResolvedValue({ sections: [{ id: 77, facultySectionId: 77, assignmentCycleId: 77, department: 'BSIT', section: 'BSIT 1-1',
    canonicalSection: 'BSIT 1-1', academicSectionId: 1, schoolYear: '2026-2027', semester: 'FIRST',
    yearLevel: '1', subject: 'IT 101' }] });
  fetchFacultyStudents.mockResolvedValue({ students: [{ internalStudentId: 5, facultySectionId: 77, studentNumber: '26-0001', fullName: 'Juan Andres Dela Cruz',
    email: '26-0001', department: 'BSIT', section: '1-1', enrollmentStatus: 'ENROLLED' }] });
  fetchAllGrades.mockResolvedValue({ data: [] });
  issueGrade.mockResolvedValue({ status: 'Success' });
  submitSectionGrades.mockResolvedValue({ status: 'Success' });
  batchUploadGrades.mockResolvedValue({ status: 'Success', totalProcessed: 1, successful: 1 });
});

const openSection = async () => {
  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Encode Now' }));
};

test('backend enrollment period overrides a stale SECOND assignment and Save sends FIRST', async () => {
  await openSection();
  expect(screen.getByText('26-0001')).toBeInTheDocument();
  fireEvent.change(screen.getAllByPlaceholderText('60-100')[0], { target: { value: '85' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
  await waitFor(() => expect(issueGrade).toHaveBeenCalledWith(expect.objectContaining({
    student_id: '26-0001', school_year: '2026-2027', semester: 'FIRST',
    section: 'BSIT 1-1', subject_code: 'IT 101',
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
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith(
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
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Student account was not found')));
  expect(submitSectionGrades).not.toHaveBeenCalled();
});

test('an empty authoritative enrollment roster cannot stage grades', async () => {
  fetchFacultyStudents.mockResolvedValue({ students: [] });
  await openSection();
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('no active Registrar enrollment roster')));
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

  const file = new File(['workbook'], 'grades.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [file] } });

  await waitFor(() => expect(batchUploadGrades).toHaveBeenCalledWith(file, expect.objectContaining({
    facultySectionId: '123',
    academicSectionId: 45,
    subjectCode: 'IT 101',
    section: 'BSIT 1-1',
  })));
  expect(batchUploadGrades.mock.calls[0][1].facultySectionId).not.toBe(45);
});

test('successful Bulk Upload reports exact context and an editable Draft without claiming an IPFS commit', async () => {
  await openSection();
  const file = new File(['workbook'], 'grades.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

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
  const file = new File(['workbook'], 'finals.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
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
  const file = new File(['workbook'], 'wrong-assignment.xlsx');
  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [file] } });

  const dialog = await screen.findByRole('dialog', { name: 'Batch Upload Failed' });
  expect(dialog).toHaveTextContent('The workbook belongs to a different Faculty assignment.');
  expect(dialog).toHaveTextContent('Nothing was submitted or finalized.');
  expect(gradeInput).toHaveValue(88);
});

test('a backend-closed encoding period uses the failure modal and saves no upload', async () => {
  batchUploadGrades.mockRejectedValue(new Error('The grade encoding period is closed.'));
  await openSection();
  const file = new File(['workbook'], 'grades.xlsx');

  fireEvent.change(screen.getByLabelText('Bulk upload grades workbook'), { target: { files: [file] } });

  const dialog = await screen.findByRole('dialog', { name: 'Batch Upload Failed' });
  expect(dialog).toHaveTextContent('The grade encoding period is closed.');
  expect(dialog).toHaveTextContent('Nothing was submitted or finalized.');
  expect(submitSectionGrades).not.toHaveBeenCalled();
});

test('a Midterm upload modal reports only the active term as accepted workflow data', async () => {
  await openSection();
  const file = new File(['midterm-and-finals'], 'mixed-terms.xlsx');
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

  const file = new File(['workbook'], 'grades.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
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
