import { fetchAssignedCurriculum } from './api';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'Success', data: null }),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('assigned BSIT curriculum uses the production API route without an empty batch year', async () => {
  await fetchAssignedCurriculum('BSIT');

  expect(global.fetch).toHaveBeenCalledWith(
    '/api/Curriculums/assigned?program=BSIT',
    expect.objectContaining({ headers: expect.any(Object) })
  );
});
