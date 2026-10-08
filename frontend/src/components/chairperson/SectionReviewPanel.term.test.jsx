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
    '26-0001': { recordId: 'grade-001', midterm: '85', finals: '90', standing: 'active' },
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
  expect(screen.getByRole('columnheader', { name: 'Reference' })).toBeInTheDocument();
  expect(screen.getByText('85')).toBeInTheDocument();
  expect(screen.getByText('90')).toBeInTheDocument();
});

test('section review details reports active Midterm outcomes and special standings', () => {
  const students = [
    { studentId: '26-0001', fullName: 'Passing Student' },
    { studentId: '26-0002', fullName: 'Failing Student' },
    { studentId: '26-0003', fullName: 'Dropped Student' },
    { studentId: '26-0004', fullName: 'Unofficially Dropped Student' },
    { studentId: '26-0005', fullName: 'Withdrawn Student' },
    { studentId: '26-0006', fullName: 'Incomplete Student' },
    { studentId: '26-0007', fullName: 'Pending Student' },
  ];
  const selectedSection = {
    ...section,
    totalStudents: students.length,
    encodedCount: 6,
    students,
    grades: {
      '26-0001': { midterm: '85', standing: 'active', flagged: true },
      '26-0002': { midterm: '70', standing: 'active' },
      '26-0003': { midterm: '-', standing: 'dropped' },
      '26-0004': { midterm: '-', standing: 'unofficially_dropped' },
      '26-0005': { midterm: '-', standing: 'withdrawn' },
      '26-0006': { midterm: '-', standing: 'incomplete' },
      '26-0007': { midterm: '-', standing: 'active' },
    },
  };

  render(<SectionReviewPanel {...{
    selectedSection, activeTerm: 'midterm', onSendBack: jest.fn(), onApprove: jest.fn(),
    onFinalize: jest.fn(), onViewIpfs: jest.fn(),
  }} />);

  expect(screen.getByText('Passed').parentElement).toHaveTextContent('Passed1');
  expect(screen.getByText('Failed').parentElement).toHaveTextContent('Failed1');
  expect(screen.getByText('D').parentElement).toHaveTextContent('D1');
  expect(screen.getByText('UD').parentElement).toHaveTextContent('UD1');
  expect(screen.getByText('W').parentElement).toHaveTextContent('W1');
  expect(screen.getByText('INC').parentElement).toHaveTextContent('INC1');
  expect(screen.getByText('Flagged').parentElement).toHaveTextContent('Flagged1');
});

test('section review details uses the combined grade for Finals outcomes', () => {
  const selectedSection = {
    ...section,
    totalStudents: 2,
    encodedCount: 2,
    students: [
      { studentId: '26-0001', fullName: 'Passing Student' },
      { studentId: '26-0002', fullName: 'Failing Student' },
    ],
    grades: {
      '26-0001': { midterm: '80', finals: '70', standing: 'active' },
      '26-0002': { midterm: '74', finals: '74', standing: 'active' },
    },
  };

  render(<SectionReviewPanel {...{
    selectedSection, activeTerm: 'finals', onSendBack: jest.fn(), onApprove: jest.fn(),
    onFinalize: jest.fn(), onViewIpfs: jest.fn(),
  }} />);

  expect(screen.getByText('Passed').parentElement).toHaveTextContent('Passed1');
  expect(screen.getByText('Failed').parentElement).toHaveTextContent('Failed1');
});

test('staged grade IDs do not expose Fabric history before finalization', () => {
  renderPanel('midterm');

  expect(screen.getByText('Not yet finalized')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'View Version History' })).not.toBeInTheDocument();
});

test('finalized grades expose the immutable version history control', () => {
  render(<SectionReviewPanel {...{
    selectedSection: { ...section, reviewStatus: 'forwarded' }, activeTerm: 'midterm',
    onSendBack: jest.fn(), onApprove: jest.fn(), onFinalize: jest.fn(), onViewIpfs: jest.fn(),
  }} />);

  expect(screen.getByRole('button', { name: 'View Version History' })).toBeInTheDocument();
  expect(screen.queryByText('Not yet finalized')).not.toBeInTheDocument();
});

test('comparison rows align by authoritative Student ID without changing grade mappings', () => {
  const students = [
    { studentId: '26-0001', studentNo: '26-0001', fullName: 'Reyes, Carla', lastName: 'Reyes', firstName: 'Carla' },
    { studentId: '26-0004', studentNo: '26-0004', fullName: 'Cruz, Juan B', lastName: 'Cruz', firstName: 'Juan', middleName: 'B' },
    { studentId: '26-0005', studentNo: '26-0005', fullName: 'Cruz, Juan A', lastName: 'Cruz', firstName: 'Juan', middleName: 'A' },
    { studentId: '26-0003', studentNo: '26-0003', fullName: 'Cruz, Juan A', lastName: 'Cruz', firstName: 'Juan', middleName: 'A' },
    { studentId: '26-0002', studentNo: '26-0002', fullName: 'Abarquez, Ana', lastName: 'Abarquez', firstName: 'Ana' },
  ];
  const selectedSection = {
    ...section,
    totalStudents: students.length,
    encodedCount: students.length,
    students,
    grades: Object.fromEntries(students.map((student, index) => [student.studentId, {
      midterm: String(81 + index), finals: String(91 + index), standing: 'active',
    }])),
  };

  render(<SectionReviewPanel {...{
    selectedSection, activeTerm: 'finals', onSendBack: jest.fn(), onApprove: jest.fn(),
    onFinalize: jest.fn(), onViewIpfs: jest.fn(),
  }} />);

  const tables = screen.getAllByRole('table');
  const bodyRows = within(tables[0]).getAllByRole('row').slice(1);
  const referenceRows = within(tables[1]).getAllByRole('row').slice(1);
  expect(bodyRows.map((row) => within(row).getAllByRole('cell')[1].textContent)).toEqual([
    'Reyes, Carla', 'Abarquez, Ana', 'Cruz, Juan A', 'Cruz, Juan B', 'Cruz, Juan A',
  ]);
  expect(bodyRows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
    '26-0001', '26-0002', '26-0003', '26-0004', '26-0005',
  ]);
  expect(within(bodyRows[0]).getByText('91')).toBeInTheDocument();
  expect(within(bodyRows[1]).getByText('95')).toBeInTheDocument();
  expect(within(referenceRows[0]).getByText('81')).toBeInTheDocument();
  expect(within(referenceRows[1]).getByText('85')).toBeInTheDocument();
  expect(students.map((student) => student.studentNo)).toEqual([
    '26-0001', '26-0004', '26-0005', '26-0003', '26-0002',
  ]);
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
