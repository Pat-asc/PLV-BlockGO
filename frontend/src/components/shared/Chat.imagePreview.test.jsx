import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Chat from './Chat';

const mockHandlers = {};
const mockConnection = {
  on: jest.fn((event, handler) => { mockHandlers[event] = handler; }),
  start: jest.fn(() => Promise.resolve()),
  stop: jest.fn(() => Promise.resolve()),
  invoke: jest.fn(() => Promise.resolve([])),
  onreconnected: jest.fn(),
};

jest.mock('@microsoft/signalr', () => ({
  HubConnectionBuilder: class {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    build() { return mockConnection; }
  },
}));
jest.mock('../../services/api', () => ({ getChatHubUrl: () => '/chat' }));
jest.mock('../../services/authSession', () => ({ getAuthToken: () => 'test-token' }));
jest.mock('../../utils/sharedClientState', () => ({ pullSharedClientState: jest.fn(() => Promise.resolve()) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockConnection.on.mockImplementation((event, handler) => { mockHandlers[event] = handler; });
  mockConnection.start.mockResolvedValue();
  mockConnection.stop.mockResolvedValue();
  mockConnection.invoke.mockResolvedValue([]);
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  Object.keys(mockHandlers).forEach((event) => delete mockHandlers[event]);
});

test('image preview is centered in a viewport overlay outside the clipped chat window', async () => {
  const { container } = render(<Chat userEmail="system-admin@plv.edu.ph" userRole="system_admin" isOpen
    autoOpenTarget={{ email: 'registrar@plv.edu.ph', nonce: 1 }} />);
  await waitFor(() => expect(mockHandlers.ReceiveMessage).toBeDefined());
  act(() => mockHandlers.ReceiveMessage({ messageId: 1, sender: 'registrar@plv.edu.ph',
    receiver: 'system-admin@plv.edu.ph', sentAt: '2026-09-15T05:00:00Z',
    attachmentName: 'Screenshot.png', attachmentMime: 'image/png', attachmentDataBase64: 'aGVsbG8=' }));
  fireEvent.click(await screen.findByTitle('Open image preview'));

  const close = screen.getByTitle('Close image preview');
  expect(within(container).queryByTitle('Close image preview')).not.toBeInTheDocument();
  expect(screen.getAllByAltText('Screenshot.png')[1]).toHaveClass('mx-auto', 'object-contain');
  fireEvent.click(close);
  expect(screen.queryByTitle('Close image preview')).not.toBeInTheDocument();
});
