import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RegistrarGradeRelease from './RegistrarGradeRelease';
import { fetchGradeReleaseCandidates, releaseStudentGrades } from '../../services/api';
import { requestSystemConfirmation } from '../../services/SystemDialogContext';

jest.mock('../../services/api', () => ({
  fetchGradeReleaseCandidates: jest.fn(),
  releaseStudentGrades: jest.fn(),
}));
jest.mock('../../services/SystemDialogContext', () => ({ requestSystemConfirmation: jest.fn() }));
jest.mock('../../services/NotificationContext', () => ({ showSystemNotification: jest.fn() }));

const candidate = {
  studentIdentifier: 'student@plv.edu.ph', studentId: '26-0001', studentName: 'Juan Dela Cruz',
  program: 'BSIT', yearLevel: '1', section: 'BSIT 1-1', schoolYear: '2026-2027',
  semester: 'FIRST', term: 'finals', releaseStatus: 'Ready for Release',
  subjects: [{ recordId: 'grade-1', subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing',
    grade: '{"midterm":"90","finals":"92","finalAverage":"91"}', units: 3, faculty: 'Faculty One', status: 'Finalized' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  fetchGradeReleaseCandidates.mockResolvedValue({ data: [candidate] });
  requestSystemConfirmation.mockResolvedValue(true);
  releaseStudentGrades.mockResolvedValue({ message: 'Finalized grades released successfully.' });
});

test('previews finalized subjects and releases one student after confirmation', async () => {
  render(<RegistrarGradeRelease />);
  expect(await screen.findByText('Juan Dela Cruz')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View Subjects (1)' }));
  expect(screen.getByText('IT 101')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Release Grades' }));

  await waitFor(() => expect(releaseStudentGrades).toHaveBeenCalledWith({
    studentIdentifier: 'student@plv.edu.ph', schoolYear: '2026-2027', semester: 'FIRST', term: 'finals',
  }));
  expect(requestSystemConfirmation).toHaveBeenCalled();
});
