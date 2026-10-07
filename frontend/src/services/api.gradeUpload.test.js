import { approveGrade, batchUploadGrades, downloadGradingSheet, fetchGradeReleaseCandidates, fetchRegistrarFinalizationQueue, releaseStudentGrades } from './api';

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

const gradeWorkbook = (name = 'grades.xlsx') => new File(
  [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])],
  name,
  { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
);

test('bulk grade multipart data always carries the exact assignment identity', async () => {
  const file = gradeWorkbook();
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
  await expect(batchUploadGrades(gradeWorkbook(), {
    academicSectionId: 45,
  })).rejects.toThrow('exact Faculty assignment is missing');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('finals bulk upload sends the canonical term with the complete multipart identity', async () => {
  await batchUploadGrades(gradeWorkbook('finals.xlsx'), {
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
  await batchUploadGrades(gradeWorkbook(), {
    facultySectionId: 77, academicSectionId: 12, subjectCode: 'IT 101',
    section: 'BSIT 1-1', schoolYear: '2026-2027', semester: 'FIRST',
    term: 'midterm', confirmOverwrite: true,
  });
  const [, options] = global.fetch.mock.calls[0];
  expect(options.body.get('confirmOverwrite')).toBe('true');
});

test('template download requests and names the XLSX grading workbook', async () => {
  const format = 'xlsx';
  global.fetch.mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['template']) });
  window.URL.createObjectURL = jest.fn(() => 'blob:grade-template');
  window.URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

  await downloadGradingSheet(77, 'BSIT_1-1_grading_sheet', format);

  expect(global.fetch.mock.calls[0][0]).toContain('/GradeTemplate/faculty-section/77/download?format=' + format);
  expect(click).toHaveBeenCalledTimes(1);
  expect(click.mock.instances[0].download).toBe(`BSIT_1-1_grading_sheet.${format}`);
  click.mockRestore();
});

test.each(['csv', 'xls'])('template download rejects unsupported %s before making a request', async (format) => {
  await expect(downloadGradingSheet(77, 'template', format)).rejects.toThrow('Only XLSX');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('Chairperson finalization queue uses the current-cycle backend queue', async () => {
  await fetchRegistrarFinalizationQueue();

  expect(global.fetch.mock.calls[0][0]).toContain('/Grades/finalization-queue');
});

test('Registrar grade release APIs use the visibility endpoints and preserve the student period', async () => {
  await fetchGradeReleaseCandidates();
  expect(global.fetch.mock.calls[0][0]).toContain('/Grades/release-candidates');

  const payload = { studentIdentifier: 'student@plv.edu.ph', schoolYear: '2026-2027', semester: 'FIRST', term: 'finals' };
  await releaseStudentGrades(payload);
  const [url, options] = global.fetch.mock.calls[1];
  expect(url).toContain('/Grades/release-student');
  expect(options.method).toBe('POST');
  expect(JSON.parse(options.body)).toEqual(payload);
});

test('Chairperson section approval sends all record IDs in one request', async () => {
  await approveGrade(['grade-1', 'grade-2'], 'chair@plv.edu.ph');

  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toContain('/Grades/approve?');
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ recordIds: ['grade-1', 'grade-2'] });
});
