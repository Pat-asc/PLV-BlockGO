import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GradeVersionHistory from './GradeVersionHistory';
import { correctFinalizedGrade, fetchGradeHistory } from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchGradeHistory: jest.fn(),
  correctFinalizedGrade: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  fetchGradeHistory.mockResolvedValue({ data: { logicalGradeId: 'grade-1', currentVersion: 2, versions: [
    { version: 1, grade: '82', status: 'Superseded', transactionId: 'tx-1', finalizedAt: '2026-10-01T00:00:00Z' },
    { version: 2, grade: '88', status: 'Current', transactionId: 'tx-2', previousTransactionId: 'tx-1', correctionReason: 'Incorrect exam score', finalizedAt: '2026-10-03T00:00:00Z' },
  ] } });
});

test('shows current and superseded finalized versions with transaction linkage', async () => {
  render(<GradeVersionHistory recordId="grade-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'View Version History' }));
  expect(await screen.findByText('Version 2')).toBeInTheDocument();
  expect(screen.getByText('Version 1')).toBeInTheDocument();
  expect(screen.getByText('Incorrect exam score')).toBeInTheDocument();
  expect(screen.getAllByText('tx-1').length).toBeGreaterThan(0);
});

test('Chairperson correction sends the expected version and mandatory reason', async () => {
  correctFinalizedGrade.mockResolvedValue({ status: 'Success' });
  render(<GradeVersionHistory recordId="grade-1" allowCorrection />);
  fireEvent.click(screen.getByRole('button', { name: 'View Version History' }));
  await screen.findByText('Version 2');
  fireEvent.change(screen.getByLabelText('Corrected grade'), { target: { value: '90' } });
  fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Verified examination total' } });
  fireEvent.click(screen.getByRole('button', { name: 'Commit Version 3' }));
  await waitFor(() => expect(correctFinalizedGrade).toHaveBeenCalledWith({
    recordId: 'grade-1', newGrade: '90', reason: 'Verified examination total', expectedGradeVersion: 2,
  }));
});
