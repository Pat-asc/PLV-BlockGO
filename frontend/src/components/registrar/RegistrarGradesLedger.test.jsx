import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import RegistrarGradesLedger from './RegistrarGradesLedger';
import { buildLedgerHierarchy, canonicalizeLedgerPrograms, filterLedgerRecords } from '../../utils/registrarGradesLedger';
import { fetchAcademicPrograms, fetchAllGrades } from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchAcademicPrograms: jest.fn(),
  fetchAllGrades: jest.fn(),
}));

const record = (overrides = {}) => ({
  id: 'grade-1',
  program_id: 1,
  program_code: 'BSIT',
  program_name: 'BS Information Technology',
  faculty_user_id: 10,
  faculty_email: 'a@plv.edu.ph',
  professor_name: 'Professor A',
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

beforeEach(() => {
  jest.clearAllMocks();
  fetchAcademicPrograms.mockResolvedValue({ data: [
    { programId: 1, programCode: 'BSIT', programName: 'BS Information Technology' },
    { programId: 2, programCode: 'BECE', programName: 'Bachelor of Early Childhood Education' },
  ] });
});

test('1 - Program filter returns only the selected exact program ID', () => {
  const rows = [record(), record({ id: 'bece', program_id: 2, program_code: 'BECE', academic_section_id: 21 })];
  expect(filterLedgerRecords(rows, { programId: '1' })).toEqual([rows[0]]);
});

test('2 - multiple faculty are grouped separately by exact faculty user ID', () => {
  const hierarchy = buildLedgerHierarchy([record(), record({ id: 'g2', faculty_user_id: 11, professor_name: 'Professor B', assignment_cycle_id: '101' })]);
  expect(hierarchy[0].faculties.map((faculty) => faculty.userId).sort()).toEqual(['10', '11']);
});

test('3 - the same faculty retains multiple exact academic sections', () => {
  const hierarchy = buildLedgerHierarchy([record(), record({ id: 'g2', assignment_cycle_id: '101', academic_section_id: 22, section: 'BSIT 2-1', subject_code: 'IT201' })]);
  expect(hierarchy[0].faculties[0].sections).toHaveLength(2);
});

test('4 - same faculty, academic section, year, and semester produces one section with multiple subjects', () => {
  const hierarchy = buildLedgerHierarchy([
    record(),
    record({ id: 'g2', assignment_cycle_id: '102', subject_code: 'IT102' }),
    record({ id: 'g3', assignment_cycle_id: '103', subject_code: 'GE101' }),
  ]);
  expect(hierarchy[0].faculties[0].sections).toHaveLength(1);
  expect(hierarchy[0].faculties[0].sections[0].subjects.map((subject) => subject.subjectCode).sort()).toEqual(['GE101', 'IT101', 'IT102']);
});

test('5 - students remain isolated inside their exact academic section and subject', () => {
  const hierarchy = buildLedgerHierarchy([
    record(),
    record({ id: 'g2', student_user_id: 31, student_no: '2026-0002' }),
    record({ id: 'g3', assignment_cycle_id: '101', academic_section_id: 22, section: 'BSIT 2-1', student_user_id: 32, student_no: '2026-0003' }),
  ]);
  const sections = hierarchy[0].faculties[0].sections;
  expect(sections.find((item) => item.academicSectionId === '20').subjects[0].students.map((student) => student.studentNumber)).toEqual(['2026-0001', '2026-0002']);
  expect(sections.find((item) => item.academicSectionId === '22').subjects[0].students.map((student) => student.studentNumber)).toEqual(['2026-0003']);
});

test('6 - duplicate section labels in different programs stay isolated by IDs', () => {
  const hierarchy = buildLedgerHierarchy([
    record(),
    record({ id: 'g2', program_id: 2, program_code: 'BECE', program_name: 'Early Childhood Education', faculty_user_id: 12, assignment_cycle_id: '200', academic_section_id: 40, section: 'BECE 1-1' }),
  ]);
  expect(hierarchy.map((program) => program.id).sort()).toEqual(['1', '2']);
  expect(hierarchy.map((program) => program.faculties[0].sections[0].academicSectionId).sort()).toEqual(['20', '40']);
});

test('7 - historical school year and semester filters do not mix periods', () => {
  const rows = [record(), record({ id: 'old', assignment_cycle_id: '90', school_year: '2025-2026', semester: 'SECOND' })];
  expect(filterLedgerRecords(rows, { schoolYear: '2025-2026', semester: 'SECOND' }).map((item) => item.id)).toEqual(['old']);
});

test('8 - Midterm and Finals stay inside one section as separate subject-term groups', () => {
  const hierarchy = buildLedgerHierarchy([
    record(),
    record({ id: 'grade-finals', term: 'finals', grade: JSON.stringify({ finals: '91', finalAverage: '89.5' }), status: 'Finalized', date: '2026-10-01T00:00:00Z' }),
  ]);
  const section = hierarchy[0].faculties[0].sections[0];
  expect(section.subjects).toHaveLength(2);
  expect(section.subjects.map((subject) => subject.term)).toEqual(['finals', 'midterm']);
  expect(section.subjects.find((subject) => subject.term === 'finals').students[0].status).toBe('Finalized');
});

test('9 - a selected program without records shows the clean empty state', async () => {
  fetchAllGrades.mockResolvedValue({ data: [record()] });
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" />);
  await screen.findByRole('option', { name: /BECE/ });
  const programFilter = await screen.findByLabelText('Program');
  fireEvent.change(programFilter, { target: { value: '2' } });
  expect(programFilter).toHaveValue('2');
  expect(await screen.findByText('No grade records found for this program.')).toBeInTheDocument();
});

test('10 - a large roster mounts only when expanded and paginates at 25 rows', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => record({
    id: `grade-${index + 1}`,
    student_user_id: 1000 + index,
    student_no: `2026-${String(index + 1).padStart(4, '0')}`,
    student_name: `Student ${index + 1}`,
  }));
  fetchAllGrades.mockResolvedValue({ data: rows });
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" />);

  expect(await screen.findByRole('button', { name: /BSIT.*1 Faculty.*1 Sections.*51 Grade Records/i })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Student No.' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /BSIT.*1 Faculty.*1 Sections.*51 Grade Records/i }));
  fireEvent.click(screen.getByRole('button', { name: /Professor A.*1 Sections.*1 Subjects.*51 Students/i }));
  fireEvent.click(screen.getByRole('button', { name: /BSIT 1-1.*1 Subject.*51 Grade Records/i }));
  fireEvent.click(screen.getByRole('button', { name: /IT101.*midterm.*51 students/i }));

  const table = screen.getByRole('table');
  expect(within(table).getAllByRole('row')).toHaveLength(26);
  expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
});

test('program grouping fix 1 - code and full-name history resolve to one canonical program ID', () => {
  const programs = [{ programId: 1, programCode: 'BSIT', programName: 'Bachelor of Science in Information Technology' }];
  const normalized = canonicalizeLedgerPrograms([
    record({ id: 'code', program_id: 0, program_code: '', program_name: '', program: 'BSIT' }),
    record({ id: 'name', assignment_cycle_id: '101', program_id: 0, program_code: '', program_name: '', program: 'Bachelor of Science in Information Technology' }),
  ], programs);
  const hierarchy = buildLedgerHierarchy(normalized);
  expect(hierarchy).toHaveLength(1);
  expect(hierarchy[0]).toMatchObject({ key: '1', id: '1', code: 'BSIT', name: 'Bachelor of Science in Information Technology' });
});

test('program grouping fix 2 - dropdown has one canonical BSIT option and filters all BSIT aliases', async () => {
  fetchAcademicPrograms.mockResolvedValue({ data: [
    { programId: 1, programCode: 'BSIT', programName: 'Bachelor of Science in Information Technology' },
    { programId: 1, programCode: 'BSIT', programName: 'Bachelor of Science in Information Technology' },
  ] });
  fetchAllGrades.mockResolvedValue({ data: [
    record({ id: 'code', program_id: 0, program_code: '', program_name: '', program: 'BSIT' }),
    record({ id: 'name', assignment_cycle_id: '101', program_id: 0, program_code: '', program_name: '', program: 'Bachelor of Science in Information Technology' }),
  ] });
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" />);

  const options = await screen.findAllByRole('option', { name: /BSIT — Bachelor of Science in Information Technology/i });
  expect(options).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Program'), { target: { value: '1' } });
  expect(await screen.findByRole('button', { name: /BSIT.*1 Sections.*1 Grade Records/i })).toBeInTheDocument();
});

test('program grouping fix 3 - different exact program IDs remain separate', () => {
  const hierarchy = buildLedgerHierarchy([
    record(),
    record({ id: 'bece', program_id: 2, program_code: 'BECE', program_name: 'Early Childhood Education', assignment_cycle_id: '200' }),
  ]);
  expect(hierarchy.map((program) => program.key).sort()).toEqual(['1', '2']);
});

test('program grouping fix 4 - display casing cannot split records with the same program ID', () => {
  const hierarchy = buildLedgerHierarchy([
    record({ program: 'BSIT' }),
    record({ id: 'lower', assignment_cycle_id: '101', program_code: 'bsit', program_name: '' }),
    record({ id: 'full', assignment_cycle_id: '102', program_code: '', program_name: 'Bachelor of Science in Information Technology' }),
  ]);
  expect(hierarchy).toHaveLength(1);
  expect(hierarchy[0].key).toBe('1');
});

test('program grouping fix 5 - program card React keys are stable program IDs', () => {
  const hierarchy = buildLedgerHierarchy([record(), record({ id: 'second', assignment_cycle_id: '101' })]);
  expect(hierarchy.map((program) => program.key)).toEqual(['1']);
  expect(new Set(hierarchy.map((program) => program.key)).size).toBe(hierarchy.length);
});

test('program grouping fix 6 - rendered ledger uses SVG chevrons and no emoji arrows', async () => {
  fetchAllGrades.mockResolvedValue({ data: [record()] });
  const { container } = render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" />);
  await screen.findByRole('button', { name: /BSIT.*1 Grade Records/i });
  expect(container.textContent).not.toMatch(/[▶▼🔽]/u);
  expect(screen.getAllByTestId('chevron-icon')).toHaveLength(1);
});

test('program grouping fix 7 - SVG controls expand Program, Faculty, Section, and Subject levels', async () => {
  fetchAllGrades.mockResolvedValue({ data: [record()] });
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" />);
  const programButton = await screen.findByRole('button', { name: /BSIT.*1 Grade Records/i });
  fireEvent.click(programButton);
  expect(programButton).toHaveAttribute('aria-expanded', 'true');
  const facultyButton = screen.getByRole('button', { name: /Professor A.*1 Sections.*1 Subjects.*1 Students/i });
  fireEvent.click(facultyButton);
  expect(facultyButton).toHaveAttribute('aria-expanded', 'true');
  const sectionButton = screen.getByRole('button', { name: /BSIT 1-1.*1 Subject.*1 Grade Records/i });
  fireEvent.click(sectionButton);
  expect(sectionButton).toHaveAttribute('aria-expanded', 'true');
  const subjectButton = screen.getByRole('button', { name: /IT101.*midterm.*1 student/i });
  fireEvent.click(subjectButton);
  expect(subjectButton).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('columnheader', { name: 'Student No.' })).toBeInTheDocument();
});

test('PDF export 1 - All Records exports only the current filtered dataset', async () => {
  const onExport = jest.fn();
  fetchAllGrades.mockResolvedValue({ data: [
    record(),
    record({ id: 'finals', assignment_cycle_id: '101', term: 'finals', student_user_id: 31 }),
    record({ id: 'other-program', program_id: 2, program_code: 'BECE', assignment_cycle_id: '200', faculty_user_id: 12 }),
  ] });
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" onExport={onExport} />);
  await screen.findByRole('button', { name: /BSIT.*Grade Records/i });
  fireEvent.change(screen.getByLabelText('Program'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Term'), { target: { value: 'midterm' } });
  fireEvent.click(screen.getByRole('button', { name: 'Export all filtered grade records PDF' }));
  expect(onExport).toHaveBeenCalledWith(
    [expect.objectContaining({ id: 'grade-1', program_id: 1 })],
    expect.objectContaining({ programId: '1', term: 'midterm' }),
    { type: 'all' }
  );
});

test('PDF export 2 - Program export sends exact program identity only', async () => {
  const onExport = jest.fn();
  fetchAllGrades.mockResolvedValue({ data: [record(), record({ id: 'bece', program_id: 2, program_code: 'BECE', assignment_cycle_id: '200' })] });
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" onExport={onExport} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Export BSIT program PDF' }));
  expect(onExport.mock.calls[0][0].map((item) => item.id)).toEqual(['grade-1']);
  expect(onExport.mock.calls[0][2]).toEqual({ type: 'program', programId: '1' });
});

test('PDF export 3 - Faculty export sends exact faculty_user_id in program context', async () => {
  const onExport = jest.fn();
  fetchAllGrades.mockResolvedValue({ data: [record(), record({ id: 'other', faculty_user_id: 11, professor_name: 'Professor A', assignment_cycle_id: '101' })] });
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" onExport={onExport} />);
  fireEvent.click(await screen.findByRole('button', { name: /BSIT.*2 Faculty/i }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Export Professor A faculty PDF' })[0]);
  expect(onExport.mock.calls[0][0].map((item) => item.faculty_user_id)).toEqual([10]);
  expect(onExport.mock.calls[0][2]).toEqual({ type: 'faculty', programId: '1', facultyUserId: '10' });
});

test('PDF export 4 - Section export includes all subjects using exact section and period identity', async () => {
  const onExport = jest.fn();
  fetchAllGrades.mockResolvedValue({ data: [
    record(),
    record({ id: 'other-subject', assignment_cycle_id: '101', faculty_section_id: '101', subject_code: 'IT102' }),
  ] });
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" onExport={onExport} />);
  fireEvent.click(await screen.findByRole('button', { name: /BSIT.*1 Sections/i }));
  fireEvent.click(screen.getByRole('button', { name: /Professor A.*1 Sections.*2 Subjects/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Export BSIT 1-1 section PDF' }));
  expect(onExport.mock.calls[0][0].map((item) => item.id)).toEqual(['grade-1', 'other-subject']);
  expect(onExport.mock.calls[0][2]).toEqual({
    type: 'section', programId: '1', facultyUserId: '10', academicSectionId: '20', schoolYear: '2026-2027', semester: 'FIRST',
  });
});

test('PDF export 5 - empty filtered export is blocked with the requested message', async () => {
  const onExport = jest.fn();
  const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
  fetchAllGrades.mockResolvedValue({ data: [record()] });
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" onExport={onExport} />);
  await screen.findByRole('option', { name: /BECE/ });
  fireEvent.change(screen.getByLabelText('Program'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Export all filtered grade records PDF' }));
  expect(onExport).not.toHaveBeenCalled();
  expect(alertSpy).toHaveBeenCalledWith('No grade records available for this export.');
  alertSpy.mockRestore();
});

test('section grouping 3 - the same section label with different academic_section_id stays separate', () => {
  const hierarchy = buildLedgerHierarchy([
    record(),
    record({ id: 'other-section', assignment_cycle_id: '101', academic_section_id: 21 }),
  ]);
  expect(hierarchy[0].faculties[0].sections).toHaveLength(2);
});

test('section grouping 4 and 5 - semester and school year remain part of exact section identity', () => {
  const hierarchy = buildLedgerHierarchy([
    record(),
    record({ id: 'second-semester', assignment_cycle_id: '101', semester: 'SECOND' }),
    record({ id: 'next-year', assignment_cycle_id: '102', school_year: '2027-2028' }),
  ]);
  expect(hierarchy[0].faculties[0].sections).toHaveLength(3);
});

test('section grouping 6 - repeated logical grade rows and recreated assignment cycles render once', () => {
  const hierarchy = buildLedgerHierarchy([
    record(),
    record(),
    record({ id: 'recreated-copy', assignment_cycle_id: '999', status: 'Finalized', date: '2026-10-01T00:00:00Z' }),
  ]);
  const subject = hierarchy[0].faculties[0].sections[0].subjects[0];
  expect(subject.students).toHaveLength(1);
  expect(subject.students[0].status).toBe('Finalized');
  expect(subject.students[0].sourceRecordIds).toEqual(expect.arrayContaining(['grade-1', 'recreated-copy']));
  expect(subject.assignmentIds.sort()).toEqual(['100', '999']);
});

test('section grouping 7 - employee number and email metadata share one exact faculty_user_id card', () => {
  const hierarchy = buildLedgerHierarchy([
    record({ faculty_email: '', faculty_number: 'FAH-8975' }),
    record({ id: 'email-copy', assignment_cycle_id: '101', faculty_email: 'faculty@plv.edu.ph', faculty_number: '' }),
  ]);
  expect(hierarchy[0].faculties).toHaveLength(1);
  expect(hierarchy[0].faculties[0]).toMatchObject({ userId: '10', facultyNumber: 'FAH-8975', email: 'faculty@plv.edu.ph' });
});
