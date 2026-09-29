import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DeptAdminGradesView from './DeptAdminGradesView';
import {
  approveGrade, fetchAllGrades, fetchApprovedFaculties, fetchDepartmentSections,
  fetchFacultySections, finalizeGrade, getSystemSetting,
} from '../../services/api';

const mockAddNotification = jest.fn();
jest.mock('../../services/NotificationContext', () => ({
  useNotification: () => ({ addNotification: mockAddNotification }),
}));
jest.mock('./ChairpersonHeader', () => () => null);
jest.mock('./ChairpersonOverview', () => () => null);
jest.mock('./CurriculumBuilder', () => () => null);
jest.mock('./StudentSectioning', () => () => null);
jest.mock('./AcademicAssignment', () => () => null);
jest.mock('../faculty/FacultyStatusTable', () => ({ rows = [], viewMode, loadError, onSelectSection }) => (
  <div data-testid="review-rows">
    {viewMode}:{rows.length}:{rows.map((row) => row.reviewStatus).join(',')}:{loadError}
    {rows[0] && <button type="button" onClick={() => onSelectSection(rows[0])}>Select first section</button>}
  </div>
));
jest.mock('./SectionReviewPanel', () => ({ onApprove, onFinalize }) => (
  <div>
    <button type="button" onClick={() => onApprove('').catch(() => {})}>Approve selected section</button>
    <button type="button" onClick={() => onFinalize('').catch(() => {})}>Finalize selected section</button>
  </div>
));
jest.mock('../../services/Modal', () => () => null);
jest.mock('./ChairpersonSidebar', () => ({ setActiveTab }) => (
  <div>
    <button type="button" onClick={() => setActiveTab('forReview')}>For Review</button>
    <button type="button" onClick={() => setActiveTab('approved')}>Approved</button>
    <button type="button" onClick={() => setActiveTab('forwarded')}>Finalized</button>
  </div>
));
jest.mock('../../services/api', () => ({
  fetchAllGrades: jest.fn(), approveGrade: jest.fn(), finalizeGrade: jest.fn(), returnGrade: jest.fn(),
  batchUploadGrades: jest.fn(), fetchFacultySections: jest.fn(), fetchFacultyStudents: jest.fn(),
  fetchDepartmentSections: jest.fn(), batchEnrollStudentsToSection: jest.fn(), dropStudent: jest.fn(),
  fetchApprovedFaculties: jest.fn(), unassignFacultySection: jest.fn(), openDecryptedIpfsFile: jest.fn(),
  getSystemSetting: jest.fn(), issueGrade: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  getSystemSetting.mockImplementation((key) => Promise.resolve(key === 'encoding_period'
    ? { status: 'Success', value: JSON.stringify({ semester: 'FIRST', term: 'midterm', startDate: '2026-01-01', endDate: '2026-12-31' }) }
    : { status: 'Success', value: '75' }));
  fetchApprovedFaculties.mockResolvedValue({ status: 'Success', faculties: [] });
  fetchDepartmentSections.mockResolvedValue({ status: 'Success', data: [] });
  fetchFacultySections.mockResolvedValue({ status: 'Success', sections: [] });
});

test('encoding-season reset clears and refetches Chairperson For Review without logout', async () => {
  fetchAllGrades
    .mockResolvedValueOnce({ data: [{
      id: 'old-submission', assignment_cycle_id: '41', student_no: '26-0001',
      student_name: 'Old Student', faculty_id: 'faculty@plv.edu.ph',
      department: 'BSIT', course: 'BSIT', record_section: 'BSIT 1-1', section: 'BSIT 1-1',
      subject_code: 'IT 101', school_year: '2026-2027', semester: 'FIRST',
      status: 'SubmittedToChairperson', grade: JSON.stringify({ midterm: 85 }),
    }] })
    .mockResolvedValue({ data: [] });

  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" loggedInName="Chair" department="BSIT" />);
  fireEvent.click(screen.getByRole('button', { name: 'For Review' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('forReview:1'));

  fireEvent(window, new CustomEvent('blockgo:system-setting-changed', { detail: {
    key: 'encoding_period',
    value: JSON.stringify({ semester: '2nd Semester', term: 'midterm', startDate: '', endDate: '' }),
  } }));

  await waitFor(() => expect(fetchAllGrades).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('forReview:0'));
});

test('one realtime section event creates one notification and its listener is cleaned up', async () => {
  fetchAllGrades.mockResolvedValue({ data: [] });
  const view = render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" loggedInName="Chair" department="BSIT" />);
  await waitFor(() => expect(fetchAllGrades).toHaveBeenCalled());
  localStorage.setItem('studentSections', JSON.stringify([{
    program: 'BSIT', yearLevel: '1st Year', section: 'BSIT 1-1', schoolYear: '2026-2027', semester: 'FIRST',
  }]));
  mockAddNotification.mockClear();
  const event = new CustomEvent('blockgo:academic-data-changed', { detail: {
    reason: 'section_created', department: 'BSIT', actor: 'registrar@plv.edu.ph', changedAt: '2026-09-29T01:00:00Z',
  } });
  fireEvent(window, event);
  expect(mockAddNotification).toHaveBeenCalledTimes(1);
  expect(mockAddNotification).toHaveBeenCalledWith(
    'Registrar created a new section in BSIT.',
    'success',
    { eventKey: 'academic|section_created|bsit|registrar@plv.edu.ph|2026-09-29T01:00:00Z' }
  );
  view.unmount();
  mockAddNotification.mockClear();
  fireEvent(window, event);
  expect(mockAddNotification).not.toHaveBeenCalled();
});

test('DepartmentApproved remains in Approved until ledger finalization succeeds', async () => {
  fetchAllGrades.mockResolvedValue({ data: [{
    id: 'approved-grade', assignment_cycle_id: '41', student_no: '26-0001',
    student_name: 'Student', faculty_id: 'faculty@plv.edu.ph', department: 'BSIT',
    course: 'BSIT', record_section: 'BSIT 1-1', section: 'BSIT 1-1', subject_code: 'IT 101',
    school_year: '2026-2027', semester: 'FIRST', status: 'DepartmentApproved',
    grade: JSON.stringify({ midterm: 85 }),
  }] });

  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" loggedInName="Chair" department="BSIT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('approved:1:approved'));
  fireEvent.click(screen.getByRole('button', { name: 'Finalized' }));
  expect(screen.getByTestId('review-rows')).toHaveTextContent('forwarded:0');
});

test('approval sends one section request and moves the record to Finalize Queue, not Finalized', async () => {
  const submitted = {
    id: 'submitted-grade', assignment_cycle_id: '41', student_no: '26-0001', student_name: 'Student',
    faculty_id: 'faculty@plv.edu.ph', department: 'BSIT', course: 'BSIT', record_section: 'BSIT 1-1',
    section: 'BSIT 1-1', subject_code: 'IT 101', school_year: '2026-2027', semester: 'FIRST',
    term: 'midterm', status: 'SubmittedToChairperson', grade: JSON.stringify({ midterm: 85 }),
  };
  fetchAllGrades
    .mockResolvedValueOnce({ data: [submitted] })
    .mockResolvedValue({ data: [{ ...submitted, status: 'ChairpersonApproved' }] });
  approveGrade.mockResolvedValue({ status: 'Success' });

  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" loggedInName="Chair" department="BSIT" />);
  fireEvent.click(screen.getByRole('button', { name: 'For Review' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('forReview:1:submitted'));
  fireEvent.click(screen.getByRole('button', { name: 'Select first section' }));
  fireEvent.click(screen.getByRole('button', { name: 'Approve selected section' }));

  await waitFor(() => expect(approveGrade).toHaveBeenCalledTimes(1));
  expect(approveGrade).toHaveBeenCalledWith(['submitted-grade'], 'chair@plv.edu.ph');
  fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('approved:1:approved'));
  fireEvent.click(screen.getByRole('button', { name: 'Finalized' }));
  expect(screen.getByTestId('review-rows')).toHaveTextContent('forwarded:0');
});

test('approval failure refreshes authoritative state and leaves the record in For Review', async () => {
  const submitted = {
    id: 'submitted-grade', assignment_cycle_id: '41', student_no: '26-0001', student_name: 'Student',
    faculty_id: 'faculty@plv.edu.ph', department: 'BSIT', course: 'BSIT', record_section: 'BSIT 1-1',
    section: 'BSIT 1-1', subject_code: 'IT 101', school_year: '2026-2027', semester: 'FIRST',
    term: 'midterm', status: 'SubmittedToChairperson', grade: JSON.stringify({ midterm: 85 }),
  };
  fetchAllGrades.mockResolvedValue({ data: [submitted] });
  approveGrade.mockRejectedValue(new Error('Approval unavailable.'));

  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" loggedInName="Chair" department="BSIT" />);
  fireEvent.click(screen.getByRole('button', { name: 'For Review' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('forReview:1:submitted'));
  fireEvent.click(screen.getByRole('button', { name: 'Select first section' }));
  fireEvent.click(screen.getByRole('button', { name: 'Approve selected section' }));

  await waitFor(() => expect(approveGrade).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(fetchAllGrades.mock.calls.length).toBeGreaterThan(1));
  expect(screen.getByTestId('review-rows')).toHaveTextContent('forReview:1:submitted');
});

test('a Finalized record leaves For Review and remains in current Finalized tracking', async () => {
  fetchAllGrades.mockResolvedValue({ data: [{
    id: 'finalized-grade', assignment_cycle_id: '41', student_no: '26-0001',
    student_name: 'Student', faculty_id: 'faculty@plv.edu.ph', department: 'BSIT', course: 'BSIT',
    record_section: 'BSIT 1-1', section: 'BSIT 1-1', subject_code: 'IT 101',
    school_year: '2026-2027', semester: 'FIRST', term: 'midterm', status: 'Finalized',
    finalized_at: '2026-09-28T10:00:00Z', finalized_by: 'chair@plv.edu.ph',
    grade: JSON.stringify({ midterm: 85 }),
  }] });

  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" loggedInName="Chair" department="BSIT" />);
  fireEvent.click(screen.getByRole('button', { name: 'For Review' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('forReview:0'));
  fireEvent.click(screen.getByRole('button', { name: 'Finalized' }));
  expect(screen.getByTestId('review-rows')).toHaveTextContent('forwarded:1:forwarded');
});

test('Finalized tracking reports load failure instead of a false empty state', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  fetchAllGrades.mockRejectedValue(new Error('service unavailable'));

  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" loggedInName="Chair" department="BSIT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Finalized' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('Unable to load finalized grades'));
  consoleError.mockRestore();
});

test('finalization API failure reconciles and leaves the approved record available', async () => {
  const approvedRecord = {
    id: 'approved-grade', assignment_cycle_id: '41', student_no: '26-0001', student_name: 'Student',
    faculty_id: 'faculty@plv.edu.ph', department: 'BSIT', course: 'BSIT', record_section: 'BSIT 1-1',
    section: 'BSIT 1-1', subject_code: 'IT 101', school_year: '2026-2027', semester: 'FIRST',
    status: 'DepartmentApproved', grade: JSON.stringify({ midterm: 85 }),
  };
  fetchAllGrades.mockResolvedValue({ data: [approvedRecord] });
  finalizeGrade.mockRejectedValue(new Error('Ledger unavailable.'));

  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" loggedInName="Chair" department="BSIT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('approved:1:approved'));
  fireEvent.click(screen.getByRole('button', { name: 'Select first section' }));
  fireEvent.click(screen.getByRole('button', { name: 'Finalize selected section' }));

  await waitFor(() => expect(finalizeGrade).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(fetchAllGrades.mock.calls.length).toBeGreaterThan(1));
  expect(screen.getByTestId('review-rows')).toHaveTextContent('approved:1:approved');
});

test('successful finalization removes the approved item and shows authoritative Finalized tracking', async () => {
  const approvedRecord = {
    id: 'approved-grade', assignment_cycle_id: '41', student_no: '26-0001', student_name: 'Student',
    faculty_id: 'faculty@plv.edu.ph', department: 'BSIT', course: 'BSIT', record_section: 'BSIT 1-1',
    section: 'BSIT 1-1', subject_code: 'IT 101', school_year: '2026-2027', semester: 'FIRST',
    term: 'midterm', status: 'ChairpersonApproved', grade: JSON.stringify({ midterm: 85 }),
  };
  fetchAllGrades
    .mockResolvedValueOnce({ data: [approvedRecord] })
    .mockResolvedValue({ data: [{
      ...approvedRecord, status: 'Finalized', finalized_at: '2026-09-28T10:00:00Z',
      finalized_by: 'chair@plv.edu.ph',
    }] });
  finalizeGrade.mockResolvedValue({ status: 'Success' });

  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" loggedInName="Chair" department="BSIT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('approved:1:approved'));
  fireEvent.click(screen.getByRole('button', { name: 'Select first section' }));
  fireEvent.click(screen.getByRole('button', { name: 'Finalize selected section' }));

  await waitFor(() => expect(finalizeGrade).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('approved:0'));
  fireEvent.click(screen.getByRole('button', { name: 'Finalized' }));
  expect(screen.getByTestId('review-rows')).toHaveTextContent('forwarded:1:forwarded');
});
