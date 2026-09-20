import { batchUploadGrades } from './api';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'Success' }),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('bulk grade multipart data always carries the exact assignment identity', async () => {
  const file = new File(['xlsx'], 'grades.xlsx');
  await batchUploadGrades(file, {
    facultySectionId: 123,
    academicSectionId: 45,
    subjectCode: 'IT 101',
    section: 'BSIT 1-1',
    schoolYear: '2026-2027',
    semester: 'FIRST',
    course: 'BSIT',
    facultyId: 'faculty@plv.edu.ph',
    term: 'midterm',
  });

  const [, options] = global.fetch.mock.calls[0];
  expect(options.body).toBeInstanceOf(FormData);
  expect(options.body.get('facultySectionId')).toBe('123');
  expect(options.body.get('academicSectionId')).toBe('45');
  expect(options.body.get('facultySectionId')).not.toBe(options.body.get('academicSectionId'));
});

test('bulk grade upload refuses to send when the exact assignment ID is absent', async () => {
  await expect(batchUploadGrades(new File(['xlsx'], 'grades.xlsx'), {
    academicSectionId: 45,
  })).rejects.toThrow('exact Faculty assignment is missing');
  expect(global.fetch).not.toHaveBeenCalled();
});
