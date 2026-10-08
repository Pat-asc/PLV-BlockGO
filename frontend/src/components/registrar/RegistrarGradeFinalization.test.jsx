import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RegistrarGradeFinalization, { groupApprovedGradeRecords, parseApprovedGradePayload } from './RegistrarGradeFinalization';
import { fetchRegistrarFinalizationQueue, finalizeApprovedGrades } from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchRegistrarFinalizationQueue: jest.fn(),
  finalizeApprovedGrades: jest.fn(),
}));

jest.mock('../../services/Modal', () => ({ isOpen, title, children }) => isOpen ? (
  <div role="dialog" aria-label={title}>{children}</div>
) : null);

const approved = (overrides = {}) => ({
  id: 'grade-1', assignmentCycleId: '41', studentNo: '26-0001', studentName: 'Student One',
  facultyId: 'faculty@plv.edu.ph', section: 'BSIT 1-1', course: 'BSIT', program: 'BSIT',
  subjectCode: 'IT 101', schoolYear: '2026-2027', semester: 'FIRST', term: 'finals',
  status: 'ChairpersonApproved', grade: '{"midterm":"88.50","finals":"91.25","finalAverage":"89.875"}',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  fetchRegistrarFinalizationQueue.mockResolvedValue({ data: [] });
});

test('preserves approved Midterm, Finals, average, and decimal formatting without recomputation', () => {
  expect(parseApprovedGradePayload('{"midterm":"88.50","finals":"91.25","finalAverage":"89.875"}', 'finals'))
    .toEqual({ midterm: '88.50', finals: '91.25', finalAverage: '89.875' });
  expect(parseApprovedGradePayload('91.50', 'finals'))
    .toEqual({ midterm: '—', finals: '91.50', finalAverage: '—' });
});

test('groups by stable academic identity and maps reordered students by record and Student ID', () => {
  const second = approved({ id: 'grade-2', studentNo: '26-0002', studentName: 'Student Two', grade: '{"midterm":"70.00","finals":"75.00"}' });
  const firstResult = groupApprovedGradeRecords([second, approved()]);
  const reloadResult = groupApprovedGradeRecords([approved(), second]);

  expect(firstResult[0].records.map((record) => [record.id, record.studentNo, record.gradePayload]))
    .toEqual([
      ['grade-1', '26-0001', '{"midterm":"88.50","finals":"91.25","finalAverage":"89.875"}'],
      ['grade-2', '26-0002', '{"midterm":"70.00","finals":"75.00"}'],
    ]);
  expect(reloadResult[0].records.map((record) => record.id)).toEqual(['grade-1', 'grade-2']);
});

test('renders the exact approved queue and sends one section request despite repeat clicks', async () => {
  const records = [approved({ id: 'grade-2', studentNo: '26-0002' }), approved()];
  fetchRegistrarFinalizationQueue
    .mockResolvedValueOnce({ data: records })
    .mockResolvedValue({ data: [] });
  let complete;
  finalizeApprovedGrades.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));

  render(<RegistrarGradeFinalization />);
  expect(await screen.findAllByText('88.50')).toHaveLength(2);
  expect(screen.getAllByText('91.25')).toHaveLength(2);
  expect(screen.getAllByText('89.875')).toHaveLength(2);

  fireEvent.click(screen.getByRole('button', { name: 'Finalize Section' }));
  const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Finalize Grades' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(finalizeApprovedGrades).toHaveBeenCalledTimes(1);
  expect(finalizeApprovedGrades).toHaveBeenCalledWith(['grade-1', 'grade-2']);

  complete({ status: 'Success', message: 'Committed' });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Committed'));
});

test('failed Fabric finalization keeps the approved section visible for retry', async () => {
  fetchRegistrarFinalizationQueue.mockResolvedValue({ data: [approved()] });
  finalizeApprovedGrades.mockRejectedValue(new Error('Fabric unavailable'));
  render(<RegistrarGradeFinalization />);

  await screen.findByText('88.50');
  fireEvent.click(screen.getByRole('button', { name: 'Finalize Section' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Finalize Grades' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Fabric unavailable');
  expect(screen.getByText('88.50')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Finalize Section' })).toBeEnabled();
});
