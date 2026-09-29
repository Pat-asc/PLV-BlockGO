import { fetchSharedClientState, saveSharedClientState } from '../services/api';
import { pullSharedClientState } from './sharedClientState';

jest.mock('../services/api', () => ({
  fetchSharedClientState: jest.fn(),
  saveSharedClientState: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

test('pull is read-only even when local state exists and the server has no value', async () => {
  localStorage.setItem('registrarAssignments', JSON.stringify([{ id: 1 }]));
  fetchSharedClientState.mockResolvedValue({ value: null });

  await expect(pullSharedClientState(['registrarAssignments'])).resolves.toEqual([]);

  expect(fetchSharedClientState).toHaveBeenCalledTimes(1);
  expect(saveSharedClientState).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem('registrarAssignments'))).toEqual([{ id: 1 }]);
});

test('pull stores authoritative server state and dispatches one local update', async () => {
  const listener = jest.fn();
  window.addEventListener('blockgo:shared-client-state-changed', listener);
  fetchSharedClientState.mockResolvedValue({ value: [{ id: 2 }] });

  await expect(pullSharedClientState(['registrarAssignments'])).resolves.toEqual(['registrarAssignments']);

  expect(saveSharedClientState).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem('registrarAssignments'))).toEqual([{ id: 2 }]);
  expect(listener).toHaveBeenCalledTimes(1);
  window.removeEventListener('blockgo:shared-client-state-changed', listener);
});
