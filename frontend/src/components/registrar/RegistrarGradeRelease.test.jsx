import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RegistrarGradeRelease, { buildGradeReleaseHierarchy } from './RegistrarGradeRelease';
import { fetchGradeReleaseCandidates, releaseProgramGrades } from '../../services/api';
import { requestSystemConfirmation } from '../../services/SystemDialogContext';

jest.mock('../../services/api', () => ({
  fetchGradeReleaseCandidates: jest.fn(),
  releaseProgramGrades: jest.fn(),
}));
jest.mock('../../services/SystemDialogContext', () => ({ requestSystemConfirmation: jest.fn() }));
jest.mock('../../services/NotificationContext', () => ({ showSystemNotification: jest.fn() }));

const candidate = {
  studentIdentifier: 'student@plv.edu.ph', studentId: '26-0001', studentName: 'Juan Dela Cruz',
  program: 'BSIT', yearLevel: '1', section: 'BSIT 1-1', schoolYear: '2026-2027',
  semester: 'FIRST', term: 'finals', releaseStatus: 'Ready for Release',
  subjects: [{ recordId: 'grade-1', subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing',
    grade: '{"midterm":"90","finals":"92","finalAverage":"91"}', units: 3, faculty: 'Faculty One',
    facultyId: 'faculty@plv.edu.ph', assignmentCycleId: '41', academicSectionId: 11, section: 'BSIT 1-1', status: 'Finalized' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  fetchGradeReleaseCandidates.mockResolvedValue({ data: [candidate] });
  requestSystemConfirmation.mockResolvedValue(true);
  releaseProgramGrades.mockResolvedValue({ message: 'Finalized program grades released successfully.' });
});

test('previews Department to Faculty to section students and releases everyone from one action', async () => {
  render(<RegistrarGradeRelease />);
  expect(await screen.findByRole('button', { name: 'Release Grades for Everyone' })).toBeInTheDocument();
  const search = screen.getByPlaceholderText('Program name');
  fireEvent.change(search, { target: { value: 'bs' } });
  fireEvent.click(screen.getByRole('button', { name: 'View Students' }));
  expect(screen.getByRole('dialog', { name: 'BSIT 1-1 · IT 101' })).toBeInTheDocument();
  expect(screen.getAllByTestId('grade-release-modal-details')).toHaveLength(1);
  expect(screen.getByText('Juan Dela Cruz')).toBeInTheDocument();
  expect(screen.getByText('IT 101')).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: /status/i })).not.toBeInTheDocument();
  expect(screen.getByRole('article', { hidden: true })).not.toHaveTextContent('Juan Dela Cruz');
  fireEvent.click(screen.getByRole('button', { name: 'Close BSIT 1-1 · IT 101' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(search).toHaveValue('bs');
  fireEvent.click(screen.getByRole('button', { name: 'Release Grades for Everyone' }));

  await waitFor(() => expect(releaseProgramGrades).toHaveBeenCalledWith({
    program: 'BSIT', schoolYear: '2026-2027', semester: 'FIRST', term: 'finals',
  }));
  expect(requestSystemConfirmation).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Release Grades for Everyone' }));
});

test('keeps one department group when the same program has multiple finalized periods', () => {
  const hierarchy = buildGradeReleaseHierarchy([
    candidate,
    { ...candidate, term: 'midterm', studentId: '26-0002', studentName: 'Student Two', subjects: [{ ...candidate.subjects[0], recordId: 'grade-2', assignmentCycleId: '42', subjectCode: 'IT 102' }] },
  ]);
  expect(hierarchy).toHaveLength(1);
  expect(hierarchy[0].name).toBe('BSIT');
  expect(hierarchy[0].faculties).toHaveLength(1);
  expect(hierarchy[0].faculties[0].sections).toHaveLength(2);
});
