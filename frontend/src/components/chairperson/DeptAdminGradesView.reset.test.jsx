import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DeptAdminGradesView, { resolveRawStudentEntry } from './DeptAdminGradesView';
import {
  approveGrade, fetchAllGrades, fetchApprovedFaculties, fetchDepartmentSections,
  fetchFacultySections, finalizeGrade, getSystemSetting, returnGrade,
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
jest.mock('./SectionReviewPanel', () => ({ selectedSection, onApprove, onFinalize, onSendBack }) => (
  <div>
    <span>{selectedSection.reviewNote}</span>
    <span data-testid="reference-grade">
      {selectedSection.referenceGrades?.[selectedSection.students?.[0]?.studentId]?.grade || '-'}
    </span>
    <button type="button" onClick={() => onApprove('').catch(() => {})}>Approve selected section</button>
    <button type="button" onClick={() => onFinalize('').catch(() => {})}>Finalize selected section</button>
    <button type="button" onClick={() => onSendBack('Correct the encoded grade')}>Return selected section</button>
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
    <button type="button" onClick={() => setActiveTab('myClasses')}>My Classes</button>
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

test('roster remapping uses Student ID before array position', () => {
  const rawStudentEntries = [
    { studentNumber: '26-0002', grade: { midterm: '82' }, referenceGrade: { grade: '82' } },
    { studentNumber: '26-0001', grade: { midterm: '91' }, referenceGrade: { grade: '91' } },
  ];

  expect(resolveRawStudentEntry({
    rawStudentEntries, rosterStudentId: '26-0001', index: 0,
  })).toBe(rawStudentEntries[1]);
  expect(resolveRawStudentEntry({
    rawStudentEntries, rosterStudentId: 'legacy-placeholder', index: 0, allowPositionalFallback: true,
  })).toBe(rawStudentEntries[0]);
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

test('maps the backend reference grade into the selected Chairperson comparison section', async () => {
  fetchAllGrades.mockResolvedValue({ data: [{
    id: 'comparison-grade', assignment_cycle_id: '41', student_no: '26-0001',
    student_name: 'Reference Student', faculty_id: 'faculty@plv.edu.ph',
    department: 'BSIT', course: 'BSIT', record_section: 'BSIT 1-1', section: 'BSIT 1-1',
    subject_code: 'IT 101', school_year: '2026-2027', semester: 'FIRST', term: 'midterm',
    status: 'SubmittedToChairperson', grade: JSON.stringify({ midterm: 85 }),
    reference_grade: '82.50', integrity_status: 'MISMATCH',
  }] });

  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" loggedInName="Chair" department="BSIT" />);
  fireEvent.click(screen.getByRole('button', { name: 'For Review' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('forReview:1'));
  fireEvent.click(screen.getByRole('button', { name: 'Select first section' }));

  expect(screen.getByTestId('reference-grade')).toHaveTextContent('82.50');
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
    { eventKey: 'burst|section_created||bsit|registrar@plv.edu.ph' }
  );
  view.unmount();
  mockAddNotification.mockClear();
  fireEvent(window, event);
  expect(mockAddNotification).not.toHaveBeenCalled();

  const { unmount: unmountRemounted } = render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" loggedInName="Chair" department="BSIT" />);
  await waitFor(() => expect(fetchAllGrades.mock.calls.length).toBeGreaterThan(1));
  mockAddNotification.mockClear();
  fireEvent(window, event);
  expect(mockAddNotification).toHaveBeenCalledTimes(1);
  unmountRemounted();
});

test('mount, unsupported My Classes, repeated events, and tab changes never request Faculty assignments', async () => {
  fetchAllGrades.mockResolvedValue({ data: [] });
  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" loggedInName="Chair" department="BSIT" />);
  await waitFor(() => expect(fetchDepartmentSections).toHaveBeenCalledTimes(1));
  const initialGradeCalls = fetchAllGrades.mock.calls.length;
  const initialFacultyCalls = fetchApprovedFaculties.mock.calls.length;
  const event = new CustomEvent('blockgo:academic-data-changed', { detail: {
    reason: 'section_created', department: 'BSIT', actor: 'registrar@plv.edu.ph', changedAt: 'request-count-event',
  } });

  for (let index = 0; index < 20; index += 1) fireEvent(window, event);
  await waitFor(() => expect(fetchDepartmentSections).toHaveBeenCalledTimes(2));
  expect(fetchAllGrades).toHaveBeenCalledTimes(initialGradeCalls);
  expect(fetchApprovedFaculties).toHaveBeenCalledTimes(initialFacultyCalls);
  expect(mockAddNotification).toHaveBeenCalledTimes(1);

  for (let index = 0; index < 10; index += 1) {
    fireEvent.click(screen.getByRole('button', { name: 'My Classes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
  }
  fireEvent.click(screen.getByRole('button', { name: 'My Classes' }));
  expect(await screen.findByText(/Teaching assignments are available from a Faculty account/)).toBeInTheDocument();
  expect(fetchFacultySections).not.toHaveBeenCalled();
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

test('return moves the authoritative record out of For Review and exposes its persisted remark', async () => {
  const submitted = {
    id: 'returned-grade', assignment_cycle_id: '41', student_no: '26-0001', student_name: 'Student',
    faculty_id: 'faculty@plv.edu.ph', department: 'BSIT', course: 'BSIT', record_section: 'BSIT 1-1',
    section: 'BSIT 1-1', subject_code: 'IT 101', school_year: '2026-2027', semester: 'FIRST',
    term: 'midterm', status: 'SubmittedToChairperson', grade: JSON.stringify({ midterm: 85 }),
  };
  fetchAllGrades
    .mockResolvedValueOnce({ data: [submitted] })
    .mockResolvedValue({ data: [{ ...submitted, status: 'Returned', note: 'Correct the encoded grade' }] });
  returnGrade.mockResolvedValue({ status: 'Success' });

  render(<DeptAdminGradesView loggedInEmail="chair@plv.edu.ph" loggedInName="Chair" department="BSIT" />);
  fireEvent.click(screen.getByRole('button', { name: 'For Review' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('forReview:1:submitted'));
  fireEvent.click(screen.getByRole('button', { name: 'Select first section' }));
  fireEvent.click(screen.getByRole('button', { name: 'Return selected section' }));

  await waitFor(() => expect(returnGrade).toHaveBeenCalledWith(
    'returned-grade', 'Correct the encoded grade', 'chair@plv.edu.ph'));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('forReview:0'));
  fireEvent.click(screen.getByRole('button', { name: 'Returned' }));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('returned:1:returned'));
  fireEvent.click(screen.getByRole('button', { name: 'Select first section' }));
  expect(screen.getByText('Correct the encoded grade')).toBeInTheDocument();
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
