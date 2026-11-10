import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DeptAdminGradesView, { resolveRawStudentEntry } from './DeptAdminGradesView';
import { fetchAllGrades, fetchApprovedFaculties, fetchDepartmentSections, fetchFacultySections, getSystemSetting } from '../../services/api';

const mockAddNotification = jest.fn();
jest.mock('../../services/NotificationContext', () => ({ useNotification: () => ({ addNotification: mockAddNotification }) }));
jest.mock('./ChairpersonHeader', () => ({ departmentCount }) => <div data-testid="header-faculty-count">{departmentCount ?? 'unavailable'}</div>);
jest.mock('./CurriculumBuilder', () => () => null);
jest.mock('./StudentSectioning', () => () => null);
jest.mock('./AcademicAssignment', () => () => null);
jest.mock('../faculty/FacultyStatusTable', () => ({ rows = [], viewMode, loadError, onSelectSection }) => (
  <div data-testid="review-rows">
    <span>{viewMode}:{rows.length}:{rows.map((row) => `${row.reviewStatus}-${row.subjectCode}`).join(',')}:{loadError}</span>
    {rows[0] ? <button type="button" onClick={() => onSelectSection(rows[0])}>Select first section</button> : null}
  </div>
));
jest.mock('./SectionReviewPanel', () => ({ selectedSection, onApprove, onSendToRegistrar, onSendBack, observerOnly }) => (
  <div>
    <span data-testid="selected-section">{selectedSection.reviewKey}</span>
    <span data-testid="observer-only">{String(observerOnly)}</span>
    <span data-testid="mutation-callbacks">{String(Boolean(onApprove || onSendToRegistrar || onSendBack))}</span>
  </div>
));
jest.mock('../../services/Modal', () => () => null);
jest.mock('./ChairpersonSidebar', () => ({ setActiveTab }) => (
  <div>
    <button type="button" onClick={() => setActiveTab('grades')}>Dashboard</button>
    <button type="button" onClick={() => setActiveTab('forReview')}>For Review</button>
    <button type="button" onClick={() => setActiveTab('returned')}>Returned</button>
    <button type="button" onClick={() => setActiveTab('approved')}>Approved</button>
    <button type="button" onClick={() => setActiveTab('forwarded')}>Finalized</button>
  </div>
));
jest.mock('../../services/api', () => ({
  fetchAllGrades: jest.fn(), ensureFinalizedGradeArchive: jest.fn(), batchUploadGrades: jest.fn(),
  fetchFacultySections: jest.fn(), fetchFacultyStudents: jest.fn(), fetchDepartmentSections: jest.fn(),
  batchEnrollStudentsToSection: jest.fn(), dropStudent: jest.fn(), fetchApprovedFaculties: jest.fn(),
  unassignFacultySection: jest.fn(), openDecryptedIpfsFile: jest.fn(), getSystemSetting: jest.fn(), issueGrade: jest.fn(),
}));

const record = (overrides = {}) => ({
  id: overrides.id || `grade-${overrides.assignment_cycle_id || '41'}-${overrides.student_no || '26-0001'}`,
  assignment_cycle_id: '41', student_no: '26-0001', student_name: 'Student One',
  faculty_id: 'faculty@plv.edu.ph', department: 'BSIT', course: 'BSIT',
  record_section: 'BSIT 1-1', section: 'BSIT 1-1', subject_code: 'IT 101',
  school_year: '2026-2027', semester: 'FIRST', term: 'midterm', status: 'SubmittedToRegistrar',
  submitted_at: '2026-10-01T08:00:00Z', grade: JSON.stringify({ midterm: 85 }), ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  getSystemSetting.mockImplementation((key) => Promise.resolve(key === 'encoding_period'
    ? { status: 'Success', value: JSON.stringify({ semester: 'FIRST', term: 'midterm', startDate: '2026-01-01', endDate: '2026-12-31' }) }
    : { status: 'Success', value: '75' }));
  fetchAllGrades.mockResolvedValue({ data: [] });
  fetchApprovedFaculties.mockResolvedValue({ status: 'Success', faculties: [] });
  fetchDepartmentSections.mockResolvedValue({ status: 'Success', data: [] });
  fetchFacultySections.mockResolvedValue({ status: 'Success', sections: [] });
});

test('roster remapping uses Student ID before array position', () => {
  const entries = [{ studentNumber: '26-0002' }, { studentNumber: '26-0001' }];
  expect(resolveRawStudentEntry({ rawStudentEntries: entries, rosterStudentId: '26-0001', index: 0 })).toBe(entries[1]);
  expect(resolveRawStudentEntry({ rawStudentEntries: entries, rosterStudentId: 'placeholder', index: 0, allowPositionalFallback: true })).toBe(entries[0]);
});

test('dashboard shows monitoring metrics without removed or obsolete grade cards', async () => {
  fetchAllGrades.mockResolvedValue({ data: [
    record({ assignment_cycle_id: '1', subject_code: 'IT 101' }),
    record({ assignment_cycle_id: '2', subject_code: 'IT 102', status: 'Returned', returned_at: '2026-10-02T08:00:00Z' }),
    record({ assignment_cycle_id: '3', subject_code: 'IT 103', status: 'DepartmentApproved', approved_at: '2026-10-03T08:00:00Z' }),
    record({ assignment_cycle_id: '4', subject_code: 'IT 104', status: 'Finalized', finalized_at: '2026-10-04T08:00:00Z' }),
  ] });
  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" department="BSIT" />);
  expect(await screen.findByText('Grade Review')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('header-faculty-count')).toHaveTextContent('0'));
  expect(screen.getByText('Faculty in Department')).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['0', '1']));
  for (const title of ['Returned Grades', 'Approved Grades', 'Finalized Grades']) {
    expect(screen.queryByText(title)).not.toBeInTheDocument();
  }
  expect(screen.queryByText(/Legacy Chairperson/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Compatibility rows|former approval workflow/i)).not.toBeInTheDocument();
});

test('Faculty count uses unique active approved accounts even when there are no grades', async () => {
  fetchApprovedFaculties.mockResolvedValue({ status: 'Success', faculties: [
    { id: 11, email: 'one@plv.edu.ph', fullname: 'Faculty One', department: 'BSIT' },
    { id: 11, email: 'one@plv.edu.ph', fullname: 'Faculty One', department: 'BSIT' },
    { id: 12, email: 'two@plv.edu.ph', fullname: 'Faculty Two', department: 'Bachelor of Science in Information Technology' },
  ] });
  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" department="BSIT" />);
  await waitFor(() => expect(screen.getByTestId('header-faculty-count')).toHaveTextContent('2'));
  expect(within(screen.getByText('Faculty in Department').closest('div')).getByText('2')).toBeInTheDocument();
});

test('Faculty directory failure does not display a genuine zero count', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  fetchApprovedFaculties.mockRejectedValue(new Error('directory unavailable'));
  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" department="BSIT" />);
  expect(await screen.findByText('Faculty count unavailable')).toBeInTheDocument();
  expect(screen.getByTestId('header-faculty-count')).toHaveTextContent('unavailable');
  consoleError.mockRestore();
});

test.each([
  ['For Review', 'forReview:1:submitted-IT 101'],
  ['Returned', 'returned:1:returned-IT 102'],
  ['Approved', 'approved:1:approved-IT 103'],
  ['Finalized', 'forwarded:1:forwarded-IT 104'],
])('%s contains only its current lifecycle workload', async (buttonName, expected) => {
  fetchAllGrades.mockResolvedValue({ data: [
    record({ assignment_cycle_id: '1', subject_code: 'IT 101' }),
    record({ assignment_cycle_id: '2', subject_code: 'IT 102', status: 'Returned', returned_at: '2026-10-02T08:00:00Z' }),
    record({ assignment_cycle_id: '3', subject_code: 'IT 103', status: 'DepartmentApproved', approved_at: '2026-10-03T08:00:00Z' }),
    record({ assignment_cycle_id: '4', subject_code: 'IT 104', status: 'Finalized', finalized_at: '2026-10-04T08:00:00Z' }),
  ] });
  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" department="BSIT" />);
  await waitFor(() => expect(screen.getByTestId('header-faculty-count')).toHaveTextContent('0'));
  fireEvent.click(screen.getByRole('button', { name: buttonName }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent(expected));
});

test('one workload appears only in its latest lifecycle tab', async () => {
  fetchAllGrades.mockResolvedValue({ data: [
    record({ id: 'old-approved', status: 'DepartmentApproved', date: '2026-10-01T08:00:00Z' }),
    record({ id: 'current-finalized', student_no: '26-0002', status: 'Finalized', finalized_at: '2026-10-05T08:00:00Z' }),
  ] });
  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" department="BSIT" />);
  await waitFor(() => expect(screen.getByTestId('header-faculty-count')).toHaveTextContent('0'));
  fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('approved:0'));
  fireEvent.click(screen.getByRole('button', { name: 'Finalized' }));
  expect(screen.getByTestId('review-rows')).toHaveTextContent('forwarded:1:forwarded-IT 101');
});

test('lifecycle tabs sort by their state timestamp newest first', async () => {
  fetchAllGrades.mockResolvedValue({ data: [
    record({ assignment_cycle_id: '1', subject_code: 'IT OLD', submitted_at: '2026-10-01T08:00:00Z' }),
    record({ assignment_cycle_id: '2', subject_code: 'IT NEW', submitted_at: '2026-10-09T08:00:00Z' }),
  ] });
  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" department="BSIT" />);
  await waitFor(() => expect(screen.getByTestId('header-faculty-count')).toHaveTextContent('0'));
  fireEvent.click(screen.getByRole('button', { name: 'For Review' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('submitted-IT NEW,submitted-IT OLD'));
});

test('Chairperson detail is observer-only and receives no workflow mutation callbacks', async () => {
  fetchAllGrades.mockResolvedValue({ data: [record()] });
  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" department="BSIT" />);
  await waitFor(() => expect(screen.getByTestId('header-faculty-count')).toHaveTextContent('0'));
  fireEvent.click(screen.getByRole('button', { name: 'For Review' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('forReview:1'));
  fireEvent.click(screen.getByRole('button', { name: 'Select first section' }));
  expect(screen.getByTestId('observer-only')).toHaveTextContent('true');
  expect(screen.getByTestId('mutation-callbacks')).toHaveTextContent('false');
});

test('direct Faculty submission event refreshes monitoring without reload', async () => {
  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" department="BSIT" />);
  await waitFor(() => expect(screen.getByTestId('header-faculty-count')).toHaveTextContent('0'));
  await waitFor(() => expect(fetchAllGrades).toHaveBeenCalledTimes(1));
  fireEvent(window, new CustomEvent('blockgo:academic-data-changed', { detail: {
    reason: 'section_submitted_to_registrar', department: 'BSIT', actor: 'faculty@plv.edu.ph', changedAt: 'new-submission',
  } }));
  await waitFor(() => expect(fetchAllGrades).toHaveBeenCalledTimes(2));
});

test('Finalized tracking reports load failure instead of a false empty state', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  fetchAllGrades.mockRejectedValue(new Error('service unavailable'));
  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" department="BSIT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Finalized' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('Unable to load finalized grades'));
  await waitFor(() => expect(screen.getByTestId('header-faculty-count')).toHaveTextContent('0'));
  consoleError.mockRestore();
});
