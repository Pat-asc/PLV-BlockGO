import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DeptAdminGradesView from './DeptAdminGradesView';
import {
  fetchAllGrades, fetchApprovedFaculties, fetchDepartmentSections,
  fetchFacultySections, getSystemSetting,
} from '../../services/api';

jest.mock('../../services/NotificationContext', () => ({
  useNotification: () => ({ addNotification: jest.fn() }),
}));
jest.mock('./ChairpersonHeader', () => () => null);
jest.mock('./ChairpersonOverview', () => () => null);
jest.mock('./CurriculumBuilder', () => () => null);
jest.mock('./StudentSectioning', () => () => null);
jest.mock('./AcademicAssignment', () => () => null);
jest.mock('../faculty/FacultyStatusTable', () => ({ rows = [] }) => (
  <div data-testid="review-rows">{rows.length}</div>
));
jest.mock('./SectionReviewPanel', () => () => null);
jest.mock('../../services/Modal', () => () => null);
jest.mock('./ChairpersonSidebar', () => ({ setActiveTab }) => (
  <button type="button" onClick={() => setActiveTab('forReview')}>For Review</button>
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
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('1'));

  fireEvent(window, new CustomEvent('blockgo:system-setting-changed', { detail: {
    key: 'encoding_period',
    value: JSON.stringify({ semester: '2nd Semester', term: 'midterm', startDate: '', endDate: '' }),
  } }));

  await waitFor(() => expect(fetchAllGrades).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByTestId('review-rows')).toHaveTextContent('0'));
});
