import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FacultyPortal from './FacultyPortal';
import { fetchFacultySections, fetchFacultyStudents, fetchAllGrades, getSystemSetting, issueGrade, submitSectionGrades } from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchFacultySections: jest.fn(), fetchFacultyStudents: jest.fn(), fetchAllGrades: jest.fn(),
  getSystemSetting: jest.fn(), issueGrade: jest.fn(), submitSectionGrades: jest.fn(),
}));

const assignment = {
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
  fetchFacultySections.mockResolvedValue({ sections: [{ department: 'BSIT', section: 'BSIT 1-1',
    canonicalSection: 'BSIT 1-1', academicSectionId: 1, schoolYear: '2026-2027', semester: 'FIRST',
    yearLevel: '1', subject: 'IT 101' }] });
  fetchFacultyStudents.mockResolvedValue({ students: [{ id: 5, studentno: '26-0001', fullname: 'Juan Andres Dela Cruz',
    email: '26-0001', department: 'BSIT', section: '1-1', enrollmentStatus: 'Enrolled' }] });
  fetchAllGrades.mockResolvedValue({ data: [] });
  issueGrade.mockResolvedValue({ status: 'Success' });
  submitSectionGrades.mockResolvedValue({ status: 'Success' });
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
  await waitFor(() => expect(submitSectionGrades).toHaveBeenCalledWith('BSIT', 'BSIT 1-1 (IT 101)', '2026-2027', 'FIRST'));
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
    'BSIT', 'BSIT 1-1 (IT 101)', '2026-2027', 'FIRST'));
});

test('legacy Faculty section 1 resolves to academic section BSIT 1-1', async () => {
  fetchFacultySections.mockResolvedValue({ sections: [{ department: 'BSIT', section: '1',
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
  fetchFacultySections.mockResolvedValue({ sections: [{ department: 'BSIT', section: 'BSIT 1-1',
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

test('an unverified legacy roster cannot stage grades', async () => {
  fetchFacultyStudents.mockResolvedValue({ students: [] });
  await openSection();
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('no Registrar student number')));
  expect(issueGrade).not.toHaveBeenCalled();
});

test('a returned grade retains its note, can be corrected, and resubmits the same assignment', async () => {
  fetchAllGrades.mockResolvedValue({ data: [{ id: 'grade-1', student_no: '26-0001',
    record_section: 'BSIT 1-1', subject_code: 'IT 101', status: 'Returned', note: 'Correct the grade',
    grade: JSON.stringify({ midterm: 85, finals: '', standing: 'active' }), date: '2026-09-15' }] });
  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'View Grades' }));
  expect(screen.getByText('Correct the grade')).toBeInTheDocument();
  fireEvent.change(screen.getAllByPlaceholderText('60-100')[0], { target: { value: '90' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit to Chairperson' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, Submit Final Grades' }));
  await waitFor(() => expect(issueGrade).toHaveBeenCalledWith(expect.objectContaining({ student_id: '26-0001' })));
  await waitFor(() => expect(submitSectionGrades).toHaveBeenCalledWith('BSIT', 'BSIT 1-1 (IT 101)', '2026-2027', 'FIRST'));
});

test('chairperson-approved grades stay locked against Faculty editing', async () => {
  fetchAllGrades.mockResolvedValue({ data: [{ id: 'grade-1', student_no: '26-0001',
    record_section: 'BSIT 1-1', subject_code: 'IT 101', status: 'ChairpersonApproved',
    grade: JSON.stringify({ midterm: 85, finals: '', standing: 'active' }), date: '2026-09-15' }] });
  render(<FacultyPortal facultyData={{ email: 'faculty@plv.edu.ph', name: 'Faculty Testing one' }} onLogout={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'View Grades' }));
  expect(screen.getByRole('button', { name: 'Save Draft' })).toBeDisabled();
  expect(screen.getAllByPlaceholderText('60-100')[0]).toBeDisabled();
});
