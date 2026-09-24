import {
  exportRegistrarGradesLedgerPdf,
  getLedgerExportFilename,
  selectLedgerExportRecords,
} from './registrarGradesLedgerPdf';

const record = (overrides = {}) => ({
  id: 'grade-1',
  program_id: 1,
  program_code: 'BSIT',
  program_name: 'BS Information Technology',
  faculty_user_id: 10,
  faculty_email: 'juan@plv.edu.ph',
  professor_name: 'Juan Dela Cruz',
  faculty_section_id: '100',
  assignment_cycle_id: '100',
  academic_section_id: 20,
  section: 'BSIT 1-1',
  subject_code: 'IT101',
  subject_title: 'Introduction to Computing',
  school_year: '2026-2027',
  semester: 'FIRST',
  term: 'midterm',
  student_user_id: 30,
  student_no: '2026-0001',
  student_name: 'Student One',
  grade: JSON.stringify({ midterm: '88' }),
  status: 'SubmittedToChairperson',
  date: '2026-09-01T00:00:00Z',
  ...overrides,
});

const createdDocuments = [];
class MockJsPdf {
  constructor() {
    this.pages = 1;
    this.textCalls = [];
    this.tableCalls = [];
    this.savedAs = '';
    this.internal = {
      pageSize: { getWidth: () => 297, getHeight: () => 210 },
      getNumberOfPages: () => this.pages,
    };
    createdDocuments.push(this);
  }

  setTextColor() {}
  setFont() {}
  setFontSize() {}
  setPage() {}
  addPage() { this.pages += 1; }
  text(...args) { this.textCalls.push(args); }
  save(filename) { this.savedAs = filename; }
  autoTable(options) {
    this.tableCalls.push(options);
    this.pages += Math.max(0, Math.ceil(options.body.length / 25) - 1);
    this.lastAutoTable = { finalY: options.startY + Math.min(options.body.length, 25) * 5 + 8 };
  }
}

beforeEach(() => { createdDocuments.length = 0; });

test('PDF scope selector keeps all currently filtered records for the complete export', () => {
  const records = [record(), record({ id: 'grade-2', program_id: 2 })];
  expect(selectLedgerExportRecords(records, { type: 'all' })).toEqual(records);
});

test('program export uses exact programId without cross-program leakage', () => {
  const records = [record(), record({ id: 'bece', program_id: 2, program_code: 'BECE' })];
  expect(selectLedgerExportRecords(records, { type: 'program', programId: '1' }).map((item) => item.id)).toEqual(['grade-1']);
});

test('faculty export uses exact faculty_user_id without cross-faculty leakage', () => {
  const records = [record(), record({ id: 'other-faculty', faculty_user_id: 11, professor_name: 'Juan Dela Cruz' })];
  expect(selectLedgerExportRecords(records, { type: 'faculty', programId: 1, facultyUserId: 10 }).map((item) => item.id)).toEqual(['grade-1']);
});

test('section export includes every subject and recreated cycle in the exact section period', () => {
  const records = [
    record(),
    record({ id: 'subject-2', faculty_section_id: '101', assignment_cycle_id: '101', subject_code: 'IT102' }),
    record({ id: 'recreated', faculty_section_id: '102', assignment_cycle_id: '102' }),
    record({ id: 'same-cycle-other-section', academic_section_id: 21 }),
  ];
  const selected = selectLedgerExportRecords(records, {
    type: 'section', programId: 1, facultyUserId: 10, academicSectionId: 20, schoolYear: '2026-2027', semester: 'FIRST',
  });
  expect(selected.map((item) => item.id)).toEqual(['grade-1', 'subject-2', 'recreated']);
});

test('scoped exports with missing exact identities are blocked instead of broadening scope', () => {
  expect(selectLedgerExportRecords([record()], { type: 'faculty', programId: 1, facultyUserId: '' })).toEqual([]);
  expect(selectLedgerExportRecords([record()], { type: 'section', programId: 1, facultyUserId: 10, academicSectionId: 20, schoolYear: '', semester: 'FIRST' })).toEqual([]);
});

test('empty export does not create or save a PDF', () => {
  const result = exportRegistrarGradesLedgerPdf({ records: [], jsPDF: MockJsPdf });
  expect(result).toEqual({ exported: false, reason: 'empty' });
  expect(createdDocuments).toHaveLength(0);
});

test('long roster uses repeated headers, avoids split rows, paginates, and writes page numbers', () => {
  const records = Array.from({ length: 51 }, (_, index) => record({
    id: `grade-${index}`,
    student_user_id: 1000 + index,
    student_no: `2026-${String(index).padStart(4, '0')}`,
  }));
  const result = exportRegistrarGradesLedgerPdf({
    records,
    filters: { schoolYear: '2026-2027', semester: 'FIRST', term: 'midterm', status: 'all' },
    jsPDF: MockJsPdf,
    generatedAt: new Date('2026-09-24T00:00:00Z'),
  });
  const doc = createdDocuments[0];
  expect(result.pageCount).toBeGreaterThan(1);
  expect(doc.tableCalls[0]).toMatchObject({ showHead: 'everyPage', rowPageBreak: 'avoid', pageBreak: 'auto' });
  expect(doc.textCalls.filter(([text]) => /^Page \d+ of \d+$/.test(text))).toHaveLength(result.pageCount);
});

test('PDF filename is meaningful for every scope', () => {
  const hierarchy = [{
    code: 'BSIT',
    faculties: [{ name: 'Juan Dela Cruz', sections: [{ section: 'BSIT 1-1', semester: 'FIRST', schoolYear: '2026-2027' }] }],
  }];
  const filters = { schoolYear: '2026-2027' };
  expect(getLedgerExportFilename({ type: 'all' }, hierarchy, filters)).toBe('grades-ledger-all-2026-2027.pdf');
  expect(getLedgerExportFilename({ type: 'program', programId: 1 }, hierarchy, filters)).toBe('grades-ledger-BSIT-2026-2027.pdf');
  expect(getLedgerExportFilename({ type: 'faculty', programId: 1, facultyUserId: 10 }, hierarchy, filters)).toBe('grades-ledger-BSIT-juan-dela-cruz-2026-2027.pdf');
  expect(getLedgerExportFilename({ type: 'section', programId: 1, facultyUserId: 10, academicSectionId: 20, schoolYear: '2026-2027', semester: 'FIRST' }, hierarchy, filters)).toBe('grades-ledger-BSIT-1-1-FIRST-2026-2027.pdf');
});
