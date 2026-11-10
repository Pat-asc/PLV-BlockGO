import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RegistrarGradeFinalization, { groupApprovedGradeRecords, parseApprovedGradePayload } from './RegistrarGradeFinalization';
import { fetchRegistrarFinalizationQueue, finalizeApprovedGrades } from '../../services/api';
import { showSystemNotification } from '../../services/NotificationContext';
import { requestSystemConfirmation } from '../../services/SystemDialogContext';

jest.mock('../../services/api', () => ({
  fetchRegistrarFinalizationQueue: jest.fn(),
  finalizeApprovedGrades: jest.fn(),
}));

jest.mock('../../services/NotificationContext', () => ({
  showSystemNotification: jest.fn(),
}));
jest.mock('../../services/SystemDialogContext', () => ({
  requestSystemConfirmation: jest.fn(),
}));

jest.mock('../../services/Modal', () => ({ isOpen, title, children }) => isOpen ? (
  <div role="dialog" aria-label={title}>{children}</div>
) : null);

const approved = (overrides = {}) => ({
  id: 'grade-1', assignmentCycleId: '41', studentNo: '26-0001', studentName: 'Student One',
  facultyId: 'faculty@plv.edu.ph', section: 'BSIT 1-1', course: 'BSIT', program: 'BSIT',
  subjectCode: 'IT 101', schoolYear: '2026-2027', semester: 'FIRST', term: 'finals',
  status: 'SubmittedToRegistrar', grade: '{"midterm":"88.50","finals":"91.25","finalAverage":"89.875"}',
  current_grade: '91.25', reference_grade: '90.00', integrity_status: 'MISMATCH', reference_source: 'FABRIC_FINALIZED',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  fetchRegistrarFinalizationQueue.mockResolvedValue({ data: [] });
  requestSystemConfirmation.mockResolvedValue(true);
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

test('one global action finalizes exact section batches across departments in sequence', async () => {
  const bsit = approved();
  const bsa = approved({
    id: 'grade-bsa', assignmentCycleId: '88', facultyId: 'accounting@plv.edu.ph',
    professorName: 'Faculty Accounting', program: 'BSA', course: 'BSA', section: 'BSA 1-1', subjectCode: 'FIN 101',
  });
  fetchRegistrarFinalizationQueue.mockResolvedValueOnce({ data: [bsit, bsa] }).mockResolvedValue({ data: [] });
  finalizeApprovedGrades.mockResolvedValue({ status: 'Success' });

  render(<RegistrarGradeFinalization />);
  expect(await screen.findByText('BSIT')).toBeInTheDocument();
  expect(screen.getByText('BSA')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Finalize All Departments' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Finalize All Departments' }));

  await waitFor(() => expect(finalizeApprovedGrades).toHaveBeenCalledTimes(2));
  expect(finalizeApprovedGrades.mock.calls).toEqual([[['grade-bsa']], [['grade-1']]]);
});

test('renders the exact approved queue and sends one section request despite repeat clicks', async () => {
  const records = [approved({ id: 'grade-2', studentNo: '26-0002' }), approved()];
  fetchRegistrarFinalizationQueue
    .mockResolvedValueOnce({ data: records })
    .mockResolvedValue({ data: [] });
  let complete;
  finalizeApprovedGrades.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));

  render(<RegistrarGradeFinalization />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review Students' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getAllByText('91.25')).toHaveLength(2);
  expect(within(dialog).getAllByText('90.00')).toHaveLength(2);
  expect(within(dialog).getAllByText('91.25')).toHaveLength(2);
  const referenceScroll = within(dialog).getByTestId('registrar-reference-comparison-scroll');
  const submittedScroll = within(dialog).getByTestId('registrar-submitted-comparison-scroll');
  expect(referenceScroll).toHaveClass('overflow-x-auto', 'overflow-y-hidden');
  expect(submittedScroll).toHaveClass('overflow-x-auto', 'overflow-y-hidden');
  expect(referenceScroll).toHaveProperty('scrollLeft', 0);
  expect(submittedScroll).toHaveProperty('scrollLeft', 0);
  const referenceCanvas = within(referenceScroll).getByTestId('registrar-reference-comparison-canvas');
  const submittedCanvas = within(submittedScroll).getByTestId('registrar-submitted-comparison-canvas');
  expect(referenceCanvas).toHaveAttribute('class', 'box-border w-full min-w-[520px]');
  expect(submittedCanvas).toHaveAttribute('class', 'box-border w-full min-w-[520px]');
  expect(within(referenceCanvas).getByRole('table')).toHaveClass('box-border', 'w-full', 'border-collapse');
  expect(within(submittedCanvas).getByRole('table')).toHaveClass('box-border', 'w-full', 'border-collapse');
  expect(within(dialog).getByRole('heading', { name: 'Reference / Previous Grade Data' })).toHaveClass('w-full', 'text-white');
  expect(within(dialog).getByRole('heading', { name: 'Currently Submitted Grade Data' })).toHaveClass('w-full', 'text-white', 'dark:bg-sky-900');
  expect(within(dialog).queryByRole('button', { name: 'Approve and Finalize' })).not.toBeInTheDocument();
  const confirm = screen.getByRole('button', { name: 'Finalize All Departments' });
  fireEvent.click(confirm);
  await waitFor(() => expect(finalizeApprovedGrades).toHaveBeenCalledTimes(1));
  fireEvent.click(confirm);
  expect(finalizeApprovedGrades).toHaveBeenCalledTimes(1);
  expect(finalizeApprovedGrades).toHaveBeenCalledWith(['grade-1', 'grade-2']);

  complete({ status: 'Success', message: 'Committed' });
  await waitFor(() => expect(showSystemNotification).toHaveBeenCalledWith(
    'All ready grades were finalized successfully. The Grades Ledger has been updated.',
    'success',
    { title: 'All grades finalized' }
  ));
  expect(requestSystemConfirmation).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Finalize All Departments' }));
});

test('failed Fabric finalization keeps the approved section visible for retry with safe message', async () => {
  fetchRegistrarFinalizationQueue.mockResolvedValue({ data: [approved()] });
  finalizeApprovedGrades.mockRejectedValue(new Error('Fabric unavailable'));
  render(<RegistrarGradeFinalization />);

  await screen.findByRole('button', { name: 'Review Students' });
  fireEvent.click(screen.getByRole('button', { name: 'Finalize All Departments' }));

  await waitFor(() => expect(showSystemNotification).toHaveBeenCalledWith(
    'The grades could not be finalized right now. Your approved grades were preserved. Please try again.',
    'error',
    { title: 'Finalization could not be completed' }
  ));
  expect(screen.queryByText('The grades could not be finalized right now. Your approved grades were preserved. Please try again.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Review Students' })).toBeEnabled();
});

test('sanitizes 23502 year_level error so technical database details are never exposed to Registrar', async () => {
  fetchRegistrarFinalizationQueue.mockResolvedValue({ data: [approved()] });
  finalizeApprovedGrades.mockRejectedValue(new Error('23502: null value in column "year_level" of relation "grade_submission_snapshots" violates not-null constraint'));
  render(<RegistrarGradeFinalization />);

  await screen.findByRole('button', { name: 'Review Students' });
  fireEvent.click(screen.getByRole('button', { name: 'Finalize All Departments' }));

  await waitFor(() => expect(showSystemNotification).toHaveBeenCalledWith(
    'Unable to finalize this section because some academic information is incomplete. No approved grades were lost. Please refresh and try again.',
    'error',
    { title: 'Finalization could not be completed' }
  ));
  expect(showSystemNotification.mock.calls.flat().join(' ')).not.toMatch(/23502|year_level|grade_submission_snapshots|PostgreSQL|Npgsql|null value|constraint/i);
});

test('sanitizes technical errors while loading the Registrar finalization queue', async () => {
  fetchRegistrarFinalizationQueue.mockRejectedValue(
    new Error('Npgsql.PostgresException 23502: null value in column year_level of relation grade_submission_snapshots')
  );
  render(<RegistrarGradeFinalization />);

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Unable to finalize this section because some academic information is incomplete. No approved grades were lost. Please refresh and try again.');
  expect(alert.textContent).not.toMatch(/23502|year_level|grade_submission_snapshots|Npgsql|null value/i);
});

test('shows friendly message when section is already finalized (idempotent retry)', async () => {
  fetchRegistrarFinalizationQueue.mockResolvedValueOnce({ data: [approved()] }).mockResolvedValue({ data: [] });
  finalizeApprovedGrades.mockResolvedValue({
    status: 'Success',
    idempotent: true,
    message: 'This section was already finalized successfully. The Grades Ledger has been updated.'
  });
  render(<RegistrarGradeFinalization />);

  await screen.findByRole('button', { name: 'Review Students' });
  fireEvent.click(screen.getByRole('button', { name: 'Finalize All Departments' }));

  await waitFor(() => expect(showSystemNotification).toHaveBeenCalledWith(
    'All ready grades were finalized successfully. The Grades Ledger has been updated.',
    'success',
    { title: 'All grades finalized' }
  ));
});

test('shows pending grading sheet archive message when IPFS attachment is pending', async () => {
  fetchRegistrarFinalizationQueue.mockResolvedValueOnce({ data: [approved()] }).mockResolvedValue({ data: [] });
  finalizeApprovedGrades.mockResolvedValue({
    status: 'Success',
    ipfsArchiveStatus: 'PENDING',
    message: 'Grades were finalized successfully, but the grading sheet is still being prepared. You can retry the document attachment without finalizing the grades again.'
  });
  render(<RegistrarGradeFinalization />);

  await screen.findByRole('button', { name: 'Review Students' });
  fireEvent.click(screen.getByRole('button', { name: 'Finalize All Departments' }));

  await waitFor(() => expect(showSystemNotification).toHaveBeenCalledWith(
    'All ready grades were finalized, but one or more grading sheets are still being prepared. They can be retried without finalizing the grades again.',
    'warning',
    { title: 'Grades finalized — grading sheets pending' }
  ));
});

test('Registrar review modal does not expose the removed return-grades action', async () => {
  fetchRegistrarFinalizationQueue.mockResolvedValueOnce({ data: [approved()] }).mockResolvedValue({ data: [] });
  render(<RegistrarGradeFinalization />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review Students' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).queryByRole('button', { name: 'Return Grades' })).not.toBeInTheDocument();
  expect(within(dialog).queryByPlaceholderText(/Required when returning grades/i)).not.toBeInTheDocument();
});
