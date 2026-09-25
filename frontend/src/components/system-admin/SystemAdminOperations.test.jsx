import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SupportTicketManagement from './SupportTicketManagement';
import SystemMonitoring from './SystemMonitoring';
import {
  fetchSupportSpecialists,
  fetchSupportTickets,
  fetchSystemMonitoringSummary,
  updateSupportTicket,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  broadcastSupportNotice: jest.fn(),
  fetchSupportSpecialists: jest.fn(),
  fetchSupportTickets: jest.fn(),
  fetchSystemMonitoringSummary: jest.fn(),
  resolveSecurityEvent: jest.fn(),
  updateSupportTicket: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('System Administrator can change ticket severity as part of the existing update form', async () => {
  fetchSupportTickets.mockResolvedValue({ data: [{
    ticketId: 17,
    title: 'API support request',
    description: 'The Registrar API is unavailable.',
    severity: 'NORMAL',
    status: 'OPEN',
    registrarName: 'Registrar One',
    registrarEmail: 'registrar@plv.edu.ph',
    assignedSpecialist: 'BACKEND_DEVELOPER',
    assignedSpecialistLabel: 'API Issues - Backend Developer',
  }] });
  fetchSupportSpecialists.mockResolvedValue({ data: [{
    specialistId: 'BACKEND_DEVELOPER', label: 'API Issues', scope: 'Backend Developer',
  }] });
  updateSupportTicket.mockResolvedValue({ status: 'Success' });

  render(<SupportTicketManagement />);
  const severity = await screen.findByRole('combobox', { name: /severity for ticket 17/i });
  fireEvent.change(severity, { target: { value: 'CRITICAL' } });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

  await waitFor(() => expect(updateSupportTicket).toHaveBeenCalledWith(17, expect.objectContaining({
    severity: 'CRITICAL',
    status: 'OPEN',
    assignedSpecialist: 'BACKEND_DEVELOPER',
  })));
});

test('System Monitoring renders the backend-provided service availability results', async () => {
  fetchSystemMonitoringSummary.mockResolvedValue({
    status: 'healthy',
    generatedAt: '2026-09-25T00:00:00Z',
    services: [
      { id: 'frontend', name: 'Frontend', layer: 'Application', status: 'healthy', latencyMs: 12, message: 'HTTP 200' },
      { id: 'middleware-ledger', name: 'Ledger Service', layer: 'Middleware', status: 'healthy', latencyMs: 21, message: 'Ready' },
    ],
    alerts: [],
    runtime: { uptimeSeconds: 120 },
    infrastructure: { source: 'runtime' },
  });

  render(<SystemMonitoring />);

  expect(await screen.findByText('Service Availability')).toBeInTheDocument();
  expect(screen.getByText('Frontend')).toBeInTheDocument();
  expect(screen.getByText('Ledger Service')).toBeInTheDocument();
  expect(screen.getByText('HTTP 200')).toBeInTheDocument();
});
