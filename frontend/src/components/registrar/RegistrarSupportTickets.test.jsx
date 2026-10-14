import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RegistrarSupportTickets from './RegistrarSupportTickets';
import { createSupportTicket, fetchSupportSpecialists, fetchSupportTickets } from '../../services/api';

jest.mock('../../services/api', () => ({
  createSupportTicket: jest.fn(),
  downloadSupportAttachment: jest.fn(),
  fetchSupportSpecialists: jest.fn(),
  fetchSupportTickets: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  fetchSupportTickets.mockResolvedValue({ data: [] });
  fetchSupportSpecialists.mockResolvedValue({ data: [{
    specialistId: 'BACKEND_DEVELOPER', label: 'API Issues', scope: 'Backend Developer',
  }] });
  createSupportTicket.mockResolvedValue({ status: 'Success', data: { ticketId: 17 } });
});

test.each(['LOW', 'NORMAL', 'HIGH', 'CRITICAL'])(
  'Registrar submission preserves %s severity in the request payload',
  async (severity) => {
    render(<RegistrarSupportTickets />);
    await screen.findByRole('option', { name: /API Issues - Backend Developer/i });

    fireEvent.change(screen.getByPlaceholderText(/Short, descriptive title/i), {
      target: { value: 'Grade submission error' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /priority/i }), {
      target: { value: severity },
    });
    fireEvent.change(screen.getByPlaceholderText(/Describe the error/i), {
      target: { value: 'Unable to submit grades for the selected section.' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /support specialist/i }), {
      target: { value: 'specialty:BACKEND_DEVELOPER' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit Ticket/i }));

    await waitFor(() => expect(createSupportTicket).toHaveBeenCalledWith({
      title: 'Grade submission error',
      description: 'Unable to submit grades for the selected section.',
      severity,
      assignedSpecialist: 'BACKEND_DEVELOPER',
    }, []));
  }
);
