import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SystemAdminTransactions from './SystemAdminTransactions';
import { fetchApplicationTransactions, fetchLedgerTransactions } from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchApplicationTransactions: jest.fn(),
  fetchLedgerTransactions: jest.fn(),
}));

beforeEach(() => {
  fetchApplicationTransactions.mockResolvedValue({ data: Array.from({ length: 11 }, (_, index) => ({ auditId: index + 1, action: `ACTION_${index + 1}`, actor: 'System', entityId: `record-${index + 1}`, actorRole: 'system_admin', occurredAt: `2026-09-25T00:${String(index).padStart(2, '0')}:00Z` })) });
  fetchLedgerTransactions.mockResolvedValue({ data: [] });
});

test('shows ten transactions per page and appends the SignalR transaction payload', async () => {
  render(<SystemAdminTransactions />);
  expect(await screen.findByText('ACTION_11')).toBeInTheDocument();
  expect(screen.queryByText('ACTION_1')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('ACTION_1')).toBeInTheDocument();
  fireEvent(window, new CustomEvent('blockgo:transaction-recorded', { detail: {
    auditId: 99, action: 'LIVE_ACTION', actor: 'Registrar', entityId: 'record-live',
    actorRole: 'registrar', occurredAt: '2026-09-25T01:00:00Z',
  } }));
  expect(await screen.findByText('LIVE_ACTION')).toBeInTheDocument();
  expect(fetchApplicationTransactions).toHaveBeenCalledTimes(1);
});
