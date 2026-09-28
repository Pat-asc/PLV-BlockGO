import { batchUploadGrades, fetchRegistrarFinalizationQueue } from './api';

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
  const file = new File(['Student ID,Grade\n26-0001,90'], 'grades.csv', { type: 'text/csv' });
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
  await expect(batchUploadGrades(new File(['Student ID,Grade\n26-0001,90'], 'grades.csv', { type: 'text/csv' }), {
    academicSectionId: 45,
  })).rejects.toThrow('exact Faculty assignment is missing');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('finals bulk upload sends the canonical term with the complete multipart identity', async () => {
  await batchUploadGrades(new File(['Student ID,Grade\n26-0001,90'], 'finals.csv', { type: 'text/csv' }), {
    facultySectionId: 77,
    academicSectionId: 12,
    subjectCode: 'IT 101',
    section: 'BSIT 1-1',
    schoolYear: '2026-2027',
    semester: 'FIRST',
    facultyId: 'faculty@plv.edu.ph',
    term: 'finals',
  });

  const [, options] = global.fetch.mock.calls[0];
  expect(options.body.get('term')).toBe('finals');
  expect(options.body.get('facultySectionId')).toBe('77');
  expect(options.body.get('academicSectionId')).toBe('12');
  expect(options.body.get('subjectCode')).toBe('IT 101');
  expect(options.body.get('schoolYear')).toBe('2026-2027');
  expect(options.body.get('semester')).toBe('FIRST');
  expect(options.body.get('facultyId')).toBe('faculty@plv.edu.ph');
  expect(options.body.get('section')).toBe('BSIT 1-1');
});

test('bulk grade upload accepts XLSX and preserves canonical Finals context', async () => {
  const workbook = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])], 'finals.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  await batchUploadGrades(workbook, {
    facultySectionId: 77, academicSectionId: 12, subjectCode: 'IT 101',
    section: 'BSIT 1-1', schoolYear: '2026-2027', semester: 'FIRST', term: 'finals',
  });

  const [, options] = global.fetch.mock.calls[0];
  expect(options.body.get('file')).toBe(workbook);
  expect(options.body.get('term')).toBe('finals');
});

test('draft overwrite confirmation is explicit in multipart data', async () => {
  await batchUploadGrades(new File(['Student ID,Grade\n26-0001,90'], 'grades.csv', { type: 'text/csv' }), {
    facultySectionId: 77, academicSectionId: 12, subjectCode: 'IT 101',
    section: 'BSIT 1-1', schoolYear: '2026-2027', semester: 'FIRST',
    term: 'midterm', confirmOverwrite: true,
  });
  const [, options] = global.fetch.mock.calls[0];
  expect(options.body.get('confirmOverwrite')).toBe('true');
});

test('Chairperson finalization queue uses the current-cycle backend queue', async () => {
  await fetchRegistrarFinalizationQueue();

  expect(global.fetch.mock.calls[0][0]).toContain('/Grades/finalization-queue');
});
