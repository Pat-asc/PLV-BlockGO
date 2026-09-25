import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RegistrarStudentSectioning from './RegistrarStudentSectioning';
import {
  fetchDepartmentSections,
  fetchNextStudentId,
  fetchSectionedEnrolledStudents,
  fetchUnassignedEnrolledStudents,
  getSystemSetting,
} from '../../services/api';
import { syncSectioningBatchToBackend } from '../../utils/registrarSectioningBackendSync';
import { STUDENT_BATCHES_KEY } from '../../utils/studentSectioningHelpers';

jest.mock('../../services/api', () => ({
  fetchDepartmentSections: jest.fn(),
  fetchNextStudentId: jest.fn(),
  fetchSectionedEnrolledStudents: jest.fn(),
  fetchUnassignedEnrolledStudents: jest.fn(),
  getSystemSetting: jest.fn(),
}));
jest.mock('../../utils/registrarSectioningBackendSync', () => ({ syncSectioningBatchToBackend: jest.fn() }));
jest.mock('../../utils/sharedClientState', () => ({ pushSectioningSharedState: jest.fn() }));

const student = { id: 42, enrollmentId: 73, studentNo: '26-0042', fullName: 'Test Student',
  department: 'BSIT', yearLevel: '1', enrollmentStatus: 'ENROLLED', schoolYear: '2026-2027', semester: 'FIRST' };

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  window.alert = jest.fn();
  fetchNextStudentId.mockResolvedValue({ highestSequence: 42 });
  getSystemSetting.mockResolvedValue({ status: 'Success', value: { schoolYear: '2026-2027', semester: 'FIRST' } });
  fetchUnassignedEnrolledStudents.mockImplementation(async (period) => ({ data: [{ ...student, ...period }] }));
  fetchSectionedEnrolledStudents.mockResolvedValue({ data: [] });
  fetchDepartmentSections.mockImplementation(async (department) => ({ data: department === 'BSIT' ? [
    { id: 1, department: 'BS Information Technology', yearLevel: 1, sectionNum: 1 },
    { id: 2, department: 'BS Information Technology', yearLevel: 1, sectionNum: 2 },
  ] : [] }));
  syncSectioningBatchToBackend.mockResolvedValue({ sectionsSynced: 1, studentsSynced: 1 });
});

test('loads enrollments automatically and generates sections using the saved student identity', async () => {
  render(<RegistrarStudentSectioning chairpersonDepartment="BSIT" />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Auto-Populate Enrolled/ })).toBeEnabled());
  await waitFor(() => expect(JSON.parse(localStorage.getItem(STUDENT_BATCHES_KEY))[0]?.students[0]?.studentId).toBe('26-0042'));
  fireEvent.click(screen.getByRole('button', { name: 'Generate Sections' }));
  await waitFor(() => expect(syncSectioningBatchToBackend).toHaveBeenCalled());
  expect(syncSectioningBatchToBackend.mock.calls[0][0]).toEqual(expect.objectContaining({
    schoolYear: expect.stringMatching(/^\d{4}-\d{4}$/), semester: expect.any(String),
    students: [expect.objectContaining({ id: 42, enrollmentId: 73, studentId: '26-0042', sectionCode: '1-1' })],
  }));
});

test('uses the active encoding period without a manual semester control', async () => {
  render(<RegistrarStudentSectioning chairpersonDepartment="BSIT" />);
  expect(screen.queryByLabelText('Enrollment semester')).not.toBeInTheDocument();
  expect(await screen.findByLabelText('Active enrollment term')).toHaveTextContent('First Semester');
  await waitFor(() => expect(screen.getByRole('button', { name: /Auto-Populate Enrolled \(1\)/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Generate Sections' }));
  await waitFor(() => expect(syncSectioningBatchToBackend).toHaveBeenCalledWith(expect.objectContaining({ semester: 'FIRST', schoolYear: '2026-2027' })));
});

test('shows fetch failures and allows refresh even with zero students', async () => {
  fetchUnassignedEnrolledStudents.mockRejectedValue(new Error('Enrollment server unavailable'));
  render(<RegistrarStudentSectioning chairpersonDepartment="BSIT" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Enrollment server unavailable');
  expect(screen.getByRole('button', { name: /Auto-Populate Enrolled \(0\)/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Generate Sections' }));
  expect(syncSectioningBatchToBackend).not.toHaveBeenCalled();
});

test('ignores a stale response after the department changes', async () => {
  let resolveFirst;
  fetchUnassignedEnrolledStudents.mockImplementation(({ department }) => department === 'BSIT'
    ? new Promise((resolve) => { resolveFirst = resolve; })
    : Promise.resolve({ data: [] }));
  const { rerender } = render(<RegistrarStudentSectioning chairpersonDepartment="BSIT" />);
  await waitFor(() => expect(resolveFirst).toEqual(expect.any(Function)));
  rerender(<RegistrarStudentSectioning chairpersonDepartment="BSCS" />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Auto-Populate Enrolled/ })).toBeEnabled());
  await act(async () => resolveFirst({ data: [student] }));
  expect(JSON.parse(localStorage.getItem(STUDENT_BATCHES_KEY))).toEqual([]);
});

test('refreshing the enrolled roster does not duplicate students', async () => {
  render(<RegistrarStudentSectioning chairpersonDepartment="BSIT" />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Auto-Populate Enrolled \(1\)/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /Auto-Populate Enrolled/ }));
  await waitFor(() => expect(fetchUnassignedEnrolledStudents).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: /Auto-Populate Enrolled \(1\)/ })).toBeEnabled());
  expect(JSON.parse(localStorage.getItem(STUDENT_BATCHES_KEY))[0].students).toHaveLength(1);
});

test('failed assignment does not publish a sectioned roster', async () => {
  syncSectioningBatchToBackend.mockRejectedValue(new Error('Student already assigned'));
  render(<RegistrarStudentSectioning chairpersonDepartment="BSIT" />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Auto-Populate Enrolled/ })).toBeEnabled());
  const sectionPlansBeforeAttempt = JSON.parse(localStorage.getItem(STUDENT_BATCHES_KEY))[0].sectionPlans;
  fireEvent.click(screen.getByRole('button', { name: 'Generate Sections' }));
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Section assignment failed: Student already assigned'));
  const workspace = JSON.parse(localStorage.getItem(STUDENT_BATCHES_KEY))[0];
  expect(workspace.sectionPlans).toEqual(sectionPlansBeforeAttempt);
  expect(workspace.students[0].sectionCode).toBe('');
  expect(JSON.parse(localStorage.getItem('studentSections'))
    .every((section) => section.students.length === 0)).toBe(true);
});

test('rehydrates the Section List from the exact persisted academic section ID', async () => {
  fetchUnassignedEnrolledStudents.mockResolvedValue({ data: [] });
  fetchSectionedEnrolledStudents.mockResolvedValue({ data: [{
    ...student,
    academicSectionId: 2,
    section: '1-2',
  }] });

  render(<RegistrarStudentSectioning chairpersonDepartment="BSIT" />);

  await waitFor(() => {
    const workspace = JSON.parse(localStorage.getItem(STUDENT_BATCHES_KEY))[0];
    expect(workspace.students).toEqual([
      expect.objectContaining({ studentId: '26-0042', academicSectionId: 2, sectionCode: '1-2' }),
    ]);
  });
  const workspace = JSON.parse(localStorage.getItem(STUDENT_BATCHES_KEY))[0];
  expect(workspace.sectionPlans).toEqual(expect.arrayContaining([
    expect.objectContaining({ academicSectionId: 1, sectionCode: '1-1' }),
    expect.objectContaining({ academicSectionId: 2, sectionCode: '1-2' }),
  ]));
});

test('refetches authoritative enrollment membership immediately after assignment', async () => {
  fetchUnassignedEnrolledStudents
    .mockResolvedValueOnce({ data: [student] })
    .mockResolvedValue({ data: [] });
  fetchSectionedEnrolledStudents
    .mockResolvedValueOnce({ data: [] })
    .mockResolvedValue({ data: [{ ...student, academicSectionId: 1, section: '1-1' }] });

  render(<RegistrarStudentSectioning chairpersonDepartment="BSIT" />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Auto-Populate Enrolled \(1\)/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Generate Sections' }));

  await waitFor(() => expect(fetchSectionedEnrolledStudents).toHaveBeenCalledTimes(2));
  await waitFor(() => {
    const workspace = JSON.parse(localStorage.getItem(STUDENT_BATCHES_KEY))[0];
    expect(workspace.students).toEqual([
      expect.objectContaining({ studentId: '26-0042', academicSectionId: 1, sectionCode: '1-1' }),
    ]);
  });
});
