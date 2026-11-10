import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RegistrarSectionsCreated from './RegistrarSectionsCreated';
import { fetchDepartmentSections, fetchNextStudentId, fetchSectionedEnrolledStudents,
  removeStudentFromSection, unlockEnrollmentSection, unlockAllEnrollmentSections } from '../../services/api';
import { STUDENT_BATCHES_KEY } from '../../utils/studentSectioningHelpers';
import { showSystemNotification } from '../../services/NotificationContext';
import { requestSystemConfirmation } from '../../services/SystemDialogContext';

jest.mock('../../services/api', () => ({
  fetchDepartmentSections: jest.fn(), fetchNextStudentId: jest.fn(),
  fetchSectionedEnrolledStudents: jest.fn(), removeStudentFromSection: jest.fn(),
  unlockEnrollmentSection: jest.fn(), assignStudentsToSection: jest.fn(),
  unlockAllEnrollmentSections: jest.fn(),
  createSection: jest.fn(), promoteStudentEnrollments: jest.fn(), deleteAcademicSection: jest.fn(),
}));
jest.mock('../../services/NotificationContext', () => ({ showSystemNotification: jest.fn() }));
jest.mock('../../services/SystemDialogContext', () => ({ requestSystemConfirmation: jest.fn(async () => true) }));
jest.mock('../../utils/sharedClientState', () => ({ pushSectioningSharedState: jest.fn() }));

const cached = [{ key: 'BSIT|2026-2027|FIRST|sectioning', program: 'BSIT',
  schoolYear: '2026-2027', batchYear: '2026', semester: 'FIRST', status: 'Sectioning',
  sectionPlans: [{ id: 9, academicSectionId: 9, yearLevel: '1st Year', sectionCode: '1-1' }],
  students: [{ studentId: '26-0021', firstName: 'Leandro Emilio Salazar',
    yearLevel: '1st Year', sectionCode: '1-1', academicSectionId: 9 }] }];

beforeEach(() => {
  jest.clearAllMocks();
  requestSystemConfirmation.mockResolvedValue(true);
  localStorage.clear();
  localStorage.setItem(STUDENT_BATCHES_KEY, JSON.stringify(cached));
  fetchNextStudentId.mockResolvedValue({ highestSequence: 25 });
  fetchDepartmentSections.mockResolvedValue({ data: [{ id: 9, yearLevel: 1, sectionNum: 1 }] });
  fetchSectionedEnrolledStudents.mockResolvedValue({ data: [] });
});
const requestRemoval = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'View Roster' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Remove' }));
  await waitFor(() => expect(removeStudentFromSection).toHaveBeenCalled());
};

test('bulk unlock confirms the exact period and refreshes cached departments after success', async () => {
  const other = { ...cached[0], key: 'BAC|2026-2027|FIRST|sectioning', program: 'BAC' };
  localStorage.setItem(STUDENT_BATCHES_KEY, JSON.stringify([...cached, other]));
  let complete;
  unlockAllEnrollmentSections.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  render(<RegistrarSectionsCreated />);
  fireEvent.click(screen.getByRole('button', { name: 'Unlock All Sections' }));
  await waitFor(() => expect(requestSystemConfirmation).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Unlock All Sections?', confirmLabel: 'Confirm Unlock All', cancelLabel: 'Cancel',
  })));
  await waitFor(() => expect(unlockAllEnrollmentSections).toHaveBeenCalledWith({ schoolYear: '2026-2027', semester: 'FIRST' }));
  expect(screen.getByRole('button', { name: 'Unlocking all sections...' })).toBeDisabled();
  complete({ sectionCount: 4, departmentCount: 2, enrollmentCount: 20 });
  await waitFor(() => expect(showSystemNotification).toHaveBeenCalledWith('Successfully unlocked 4 sections across 2 departments.', 'success'));
  expect(fetchSectionedEnrolledStudents).toHaveBeenCalledWith(expect.objectContaining({ department: 'Bachelor of Arts in Communication' }));
  expect(fetchSectionedEnrolledStudents).toHaveBeenCalledTimes(2);
});

test('bulk unlock cancellation makes no request and failure preserves cached rosters', async () => {
  requestSystemConfirmation.mockResolvedValueOnce(false);
  unlockAllEnrollmentSections.mockRejectedValue(new Error('Sections changed. Refresh and try again.'));
  const before = localStorage.getItem(STUDENT_BATCHES_KEY);
  render(<RegistrarSectionsCreated />);
  fireEvent.click(screen.getByRole('button', { name: 'Unlock All Sections' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Unlock All Sections' })).toBeEnabled());
  expect(unlockAllEnrollmentSections).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('School year for unlocking'), { target: { value: '2027-2028' } });
  fireEvent.change(screen.getByLabelText('Semester for unlocking'), { target: { value: 'SECOND' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock All Sections' }));
  await waitFor(() => expect(showSystemNotification).toHaveBeenCalledWith('Sections changed. Refresh and try again.', 'error'));
  expect(unlockAllEnrollmentSections).toHaveBeenCalledWith({ schoolYear: '2027-2028', semester: 'SECOND' });
  expect(localStorage.getItem(STUDENT_BATCHES_KEY)).toBe(before);
});
test('locked removal preserves all persisted frontend roster state', async () => {
  removeStudentFromSection.mockRejectedValue(new Error('This section is finalized and locked. Unlock the section before removing students.'));
  localStorage.setItem('studentSections', JSON.stringify([{ unchanged: true }]));
  const before = localStorage.getItem(STUDENT_BATCHES_KEY);
  const sectionsBefore = localStorage.getItem('studentSections');
  render(<RegistrarSectionsCreated />);
  await requestRemoval();
  await waitFor(() => expect(showSystemNotification).toHaveBeenCalledWith(expect.stringContaining('finalized and locked'), 'error'));
  expect(localStorage.getItem(STUDENT_BATCHES_KEY)).toBe(before);
  expect(localStorage.getItem('studentSections')).toBe(sectionsBefore);
  expect(fetchSectionedEnrolledStudents).not.toHaveBeenCalled();
});

test('unlocked orphan removal awaits backend and replaces cached roster from server', async () => {
  unlockEnrollmentSection.mockResolvedValue({ status: 'Success', unlocked: 2 });
  let finishRemoval;
  removeStudentFromSection.mockImplementation(() => new Promise((resolve) => { finishRemoval = resolve; }));
  // The unlock refresh keeps the cached orphan for this fixture; removal refresh drops it.
  fetchSectionedEnrolledStudents.mockResolvedValueOnce({ data: [{
    studentNo: '26-0021', fullName: 'Leandro Emilio Salazar', yearLevel: '1',
    academicSectionId: 9, section: '1-1', enrollmentState: 'PLANNING',
  }] }).mockResolvedValue({ data: [] });
  render(<RegistrarSectionsCreated />);
  fireEvent.click(screen.getByRole('button', { name: 'View Roster' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unlock Section' }));
  await waitFor(() => expect(unlockEnrollmentSection).toHaveBeenCalledWith(9, {
    schoolYear: '2026-2027', semester: 'FIRST',
  }));
  await waitFor(() => expect(showSystemNotification).toHaveBeenCalledWith('Section unlocked successfully.', 'success'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Remove' }));
  await waitFor(() => expect(finishRemoval).toEqual(expect.any(Function)));
  expect(JSON.parse(localStorage.getItem(STUDENT_BATCHES_KEY))[0].students).toHaveLength(1);
  finishRemoval({ status: 'Success' });
  await waitFor(() => expect(JSON.parse(localStorage.getItem(STUDENT_BATCHES_KEY))[0].students).toEqual([]));
  expect(removeStudentFromSection).toHaveBeenCalledWith(9, '26-0021', {
    schoolYear: '2026-2027', semester: 'FIRST',
  });
  expect(fetchSectionedEnrolledStudents).toHaveBeenCalledTimes(2);
});

test('alreadyAbsent=true causes frontend to refresh and remove stale local row', async () => {
  removeStudentFromSection.mockResolvedValue({
    status: 'Success',
    code: 'STUDENT_ALREADY_ABSENT',
    alreadyAbsent: true,
    studentId: '26-0021',
    sectionId: 9,
    message: 'The student is already absent from the authoritative section roster.',
  });
  fetchSectionedEnrolledStudents.mockResolvedValue({ data: [] });

  render(<RegistrarSectionsCreated />);
  await requestRemoval();

  await waitFor(() => expect(removeStudentFromSection).toHaveBeenCalledWith(9, '26-0021', {
    schoolYear: '2026-2027', semester: 'FIRST',
  }));
  await waitFor(() => expect(fetchSectionedEnrolledStudents).toHaveBeenCalledTimes(1));
  await waitFor(() => {
    const batches = JSON.parse(localStorage.getItem(STUDENT_BATCHES_KEY));
    expect(batches[0].students).toEqual([]);
  });
  expect(showSystemNotification).toHaveBeenCalledWith(
    'The student is already absent from the authoritative section roster.',
    'success'
  );
});

test('consolidates duplicate BAC batches, removes standalone BAC option, and excludes 26-0021 from active roster', async () => {
  const duplicateBatches = [
    {
      key: 'BAC|2026-2027|FIRST|sectioning',
      program: 'BAC',
      schoolYear: '2026-2027',
      batchYear: '2026',
      semester: 'FIRST',
      status: 'Sectioning',
      sectionPlans: [{ id: 9, academicSectionId: 9, yearLevel: '1st Year', sectionCode: '1-1' }],
      students: [
        { studentId: '26-0021', firstName: 'Leandro Emilio Salazar', yearLevel: '1st Year', sectionCode: '1-1', academicSectionId: 9 },
        { studentId: '26-0001', firstName: 'Juan Dela Cruz', yearLevel: '1st Year', sectionCode: '1-1', academicSectionId: 9 },
      ],
      removedStudents: [
        {
          studentId: '26-0021',
          removalReason: 'Duplicate student record',
          removalNote: 'Duplicate student record',
          removedAt: '2026-11-10T08:00:00.000Z',
          removedFromSectionCode: '1-1',
          yearLevel: '1st Year',
        },
      ],
    },
    {
      key: 'Bachelor of Arts in Communication|2026-2027|FIRST|sectioning',
      program: 'Bachelor of Arts in Communication',
      schoolYear: '2026-2027',
      batchYear: '2026',
      semester: 'FIRST',
      status: 'Sectioning',
      sectionPlans: [{ id: 9, academicSectionId: 9, yearLevel: '1st Year', sectionCode: '1-1' }],
      students: [
        { studentId: '26-0002', firstName: 'Maria Santos', yearLevel: '1st Year', sectionCode: '1-1', academicSectionId: 9 },
      ],
      removedStudents: [],
    },
  ];

  localStorage.setItem(STUDENT_BATCHES_KEY, JSON.stringify(duplicateBatches));
  fetchDepartmentSections.mockResolvedValue({ data: [{ id: 9, yearLevel: 1, sectionNum: 1 }] });

  render(<RegistrarSectionsCreated />);

  // Department dropdown must only have "Bachelor of Arts in Communication", no standalone "BAC"
  const select = screen.getByLabelText('Department');
  expect(within(select).getByRole('option', { name: 'Bachelor of Arts in Communication' })).toBeInTheDocument();
  expect(within(select).queryByRole('option', { name: 'BAC' })).not.toBeInTheDocument();

  // Open roster
  fireEvent.click(screen.getByRole('button', { name: 'View Roster' }));

  // Active roster should contain valid students, but NOT 26-0021
  expect(screen.getByText(/26-0001/)).toBeInTheDocument();
  expect(screen.getByText(/26-0002/)).toBeInTheDocument();
  expect(screen.queryByText('Leandro Emilio Salazar')).not.toBeInTheDocument();

  // Removed Students table must retain 26-0021 with Duplicate student record
  expect(screen.getAllByText('Duplicate student record').length).toBeGreaterThan(0);

  // Attempting to restore 26-0021 must be blocked
  const restoreButtons = screen.getAllByRole('button', { name: 'Restore' });
  expect(restoreButtons.length).toBeGreaterThan(0);
  fireEvent.click(restoreButtons[0]);

  expect(showSystemNotification).toHaveBeenCalledWith(
    'Duplicate or revoked student records cannot be restored to active sections.',
    'error'
  );
  await waitFor(() => expect(fetchNextStudentId).toHaveBeenCalledWith('2026'));
});
