import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SectionReviewPanel from './SectionReviewPanel';

const section = {
  reviewKey: 'cycle-10',
  reviewStatus: 'submitted',
  reviewNote: '',
  facultyName: 'Professor A',
  sectionName: 'BSIT 1-1',
  semester: 'FIRST',
  department: 'BSIT',
  totalStudents: 1,
  encodedCount: 1,
  progress: 100,
  students: [{ studentId: '26-0001', studentNo: '26-0001', fullName: 'Student A' }],
  grades: {
    '26-0001': { midterm: '85', finals: '90', standing: 'active' },
  },
  reviewLogs: [],
};

const renderPanel = (activeTerm) => render(
  <SectionReviewPanel
    selectedSection={section}
    activeTerm={activeTerm}
    onSendBack={jest.fn()}
    onApprove={jest.fn()}
    onFinalize={jest.fn()}
    onViewIpfs={jest.fn()}
  />
);

test('midterm review does not render closed Finals workflow columns or values', () => {
  renderPanel('midterm');

  expect(screen.getByRole('columnheader', { name: 'Midterm' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Finals' })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Final Grade' })).not.toBeInTheDocument();
  expect(screen.queryByText('90')).not.toBeInTheDocument();
});

test('finals review renders preserved Midterm and active Finals values', () => {
  renderPanel('finals');

  expect(screen.getByRole('columnheader', { name: 'Finals' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Final Grade' })).toBeInTheDocument();
  expect(screen.getByText('85')).toBeInTheDocument();
  expect(screen.getByText('90')).toBeInTheDocument();
});

test('approval requires confirmation and cancel makes no request', () => {
  const onApprove = jest.fn();
  render(<SectionReviewPanel {...{
    selectedSection: section, activeTerm: 'midterm',
    onSendBack: jest.fn(), onApprove, onFinalize: jest.fn(), onViewIpfs: jest.fn(),
  }} />);

  fireEvent.click(screen.getByRole('button', { name: 'Approve Section' }));
  expect(screen.getByRole('dialog', { name: 'Approve Grades' })).toBeInTheDocument();
  expect(onApprove).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(onApprove).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('approval confirmation calls approval exactly once and disables repeat submission while busy', async () => {
  let resolveApprove;
  const onApprove = jest.fn(() => new Promise((resolve) => { resolveApprove = resolve; }));
  render(<SectionReviewPanel {...{
    selectedSection: section, activeTerm: 'midterm',
    onSendBack: jest.fn(), onApprove, onFinalize: jest.fn(), onViewIpfs: jest.fn(),
  }} />);

  fireEvent.click(screen.getByRole('button', { name: 'Approve Section' }));
  const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve Grades' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(onApprove).toHaveBeenCalledTimes(1);
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: /Approving/ })).toBeDisabled();

  resolveApprove();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('failed approval remains retryable and shows a safe error', async () => {
  const onApprove = jest.fn().mockRejectedValueOnce(new Error('Approval state could not be verified.'));
  render(<SectionReviewPanel {...{
    selectedSection: section, activeTerm: 'midterm',
    onSendBack: jest.fn(), onApprove, onFinalize: jest.fn(), onViewIpfs: jest.fn(),
  }} />);

  fireEvent.click(screen.getByRole('button', { name: 'Approve Section' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve Grades' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Approval state could not be verified.');
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve Grades' })).toBeEnabled();
});

test('finalization requires confirmation and cancel makes no request', () => {
  const onFinalize = jest.fn();
  render(<SectionReviewPanel {...{
    selectedSection: { ...section, reviewStatus: 'approved' }, activeTerm: 'finals',
    onSendBack: jest.fn(), onApprove: jest.fn(), onFinalize, onViewIpfs: jest.fn(),
  }} />);

  fireEvent.click(screen.getByRole('button', { name: 'Finalize Grades' }));
  expect(screen.getByRole('dialog', { name: 'Finalize Grades' })).toBeInTheDocument();
  expect(onFinalize).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onFinalize).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('confirmation calls finalization exactly once and disables repeat submission while busy', async () => {
  let resolveFinalize;
  const onFinalize = jest.fn(() => new Promise((resolve) => { resolveFinalize = resolve; }));
  render(<SectionReviewPanel {...{
    selectedSection: { ...section, reviewStatus: 'approved' }, activeTerm: 'finals',
    onSendBack: jest.fn(), onApprove: jest.fn(), onFinalize, onViewIpfs: jest.fn(),
  }} />);

  fireEvent.click(screen.getByRole('button', { name: 'Finalize Grades' }));
  const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Finalize Grades' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(onFinalize).toHaveBeenCalledTimes(1);
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: /Finalizing/ })).toBeDisabled();

  resolveFinalize();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('failed finalization remains retryable and shows a safe error', async () => {
  const onFinalize = jest.fn().mockRejectedValueOnce(new Error('Ledger verification failed.'));
  render(<SectionReviewPanel {...{
    selectedSection: { ...section, reviewStatus: 'approved' }, activeTerm: 'finals',
    onSendBack: jest.fn(), onApprove: jest.fn(), onFinalize, onViewIpfs: jest.fn(),
  }} />);

  fireEvent.click(screen.getByRole('button', { name: 'Finalize Grades' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Finalize Grades' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Ledger verification failed.');
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Finalize Grades' })).toBeEnabled();
});
