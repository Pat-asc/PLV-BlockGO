import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import RegistrarGradesLedger, { flattenLedgerItems } from './RegistrarGradesLedger';
import { buildLedgerHierarchy, canonicalizeLedgerPrograms, filterLedgerRecords } from '../../utils/registrarGradesLedger';
import { fetchAcademicPrograms, fetchAllGrades } from '../../services/api';
import { showSystemNotification } from '../../services/NotificationContext';

jest.mock('../../services/api', () => ({
  fetchAcademicPrograms: jest.fn(),
  fetchAllGrades: jest.fn(),
  fetchGradeHistory: jest.fn(),
  correctFinalizedGrade: jest.fn(),
}));
jest.mock('../../services/NotificationContext', () => ({
  ...jest.requireActual('../../services/NotificationContext'),
  showSystemNotification: jest.fn(),
}));

const record = (overrides = {}) => ({
  id: 'grade-1', program_id: 1, program_code: 'BSIT', program_name: 'BS Information Technology',
  faculty_user_id: 10, faculty_email: 'a@plv.edu.ph', professor_name: 'Professor A',
  assignment_cycle_id: '100', academic_section_id: 20, section: 'BSIT 1-1',
  subject_code: 'IT101', subject_title: 'Introduction to Computing', school_year: '2026-2027',
  semester: 'FIRST', term: 'midterm', student_user_id: 30, student_no: '2026-0001',
  student_name: 'Student One', grade: JSON.stringify({ midterm: '88' }), status: 'Finalized',
  date: '2026-09-01T00:00:00Z', ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  fetchAcademicPrograms.mockResolvedValue({ data: [
    { programId: 1, programCode: 'BSIT', programName: 'BS Information Technology' },
    { programId: 2, programCode: 'BECE', programName: 'Bachelor of Early Childhood Education' },
  ] });
  fetchAllGrades.mockResolvedValue({ data: [record()] });
});

test('renders a clean ledger-item list while filter selects stay collapsed', async () => {
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" />);
  expect(await screen.findByText('Available grade ledgers')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /IT101.*Introduction to Computing.*Professor A.*BSIT 1-1.*View details/i })).toBeInTheDocument();
  expect(screen.queryByLabelText('Program')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('clicking a ledger item opens grade details and close keeps the Registrar on the list', async () => {
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" />);
  fireEvent.click(await screen.findByRole('button', { name: /IT101.*View details/i }));
  const dialog = screen.getByRole('dialog', { name: /IT101.*Introduction to Computing/i });
  expect(within(dialog).getByRole('columnheader', { name: 'Student No.' })).toBeInTheDocument();
  expect(within(dialog).getByText('Student One')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close grade ledger details' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText('Available grade ledgers')).toBeInTheDocument();
});

test('real filters remain available and filter the list by exact program', async () => {
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Filters' }));
  fireEvent.change(screen.getByLabelText('Program'), { target: { value: '2' } });
  expect(await screen.findByText('No grade ledger items match the current search and filters.')).toBeInTheDocument();
});

test('search filters viewing items without opening editable controls', async () => {
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" />);
  const search = await screen.findByLabelText('Search grade ledgers');
  fireEvent.change(search, { target: { value: 'missing subject' } });
  expect(await screen.findByText('No grade ledger items match the current search and filters.')).toBeInTheDocument();
});

test('detail modal preserves program, faculty, and section PDF export scopes', async () => {
  const onExport = jest.fn();
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" onExport={onExport} />);
  fireEvent.click(await screen.findByRole('button', { name: /IT101.*View details/i }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Export Professor A faculty PDF' }));
  expect(onExport).toHaveBeenCalledWith(
    [expect.objectContaining({ id: 'grade-1' })],
    expect.objectContaining({ programId: 'all' }),
    { type: 'faculty', programId: '1', facultyUserId: '10' }
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Export BSIT 1-1 section PDF' }));
  expect(onExport.mock.calls[1][2]).toEqual({
    type: 'section', programId: '1', facultyUserId: '10', academicSectionId: '20',
    schoolYear: '2026-2027', semester: 'FIRST',
  });
});

test('empty finalized export is blocked with the existing message', async () => {
  const onExport = jest.fn();
  fetchAllGrades.mockResolvedValue({ data: [record({ status: 'Draft' })] });
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" onExport={onExport} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Export all filtered grade records PDF' }));
  expect(onExport).not.toHaveBeenCalled();
  expect(showSystemNotification).toHaveBeenCalledWith('No finalized grade records are available for this export.');
});

test('student detail pagination remains limited to 25 rows', async () => {
  fetchAllGrades.mockResolvedValue({ data: Array.from({ length: 51 }, (_, index) => record({
    id: `grade-${index + 1}`, student_user_id: 1000 + index,
    student_no: `2026-${String(index + 1).padStart(4, '0')}`, student_name: `Student ${index + 1}`,
  })) });
  render(<RegistrarGradesLedger loggedInEmail="registrar@plv.edu.ph" />);
  fireEvent.click(await screen.findByRole('button', { name: /IT101.*51 students/i }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getAllByRole('row')).toHaveLength(26);
  expect(within(dialog).getByText('Page 1 of 3')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
  expect(within(dialog).getByText('Page 2 of 3')).toBeInTheDocument();
});

test('flattened list retains multiple faculty, sections, subjects, and periods as separate items', () => {
  const items = flattenLedgerItems(buildLedgerHierarchy([
    record(),
    record({ id: 'subject-2', assignment_cycle_id: '101', subject_code: 'IT102' }),
    record({ id: 'section-2', assignment_cycle_id: '102', academic_section_id: 21, section: 'BSIT 2-1', subject_code: 'IT201' }),
    record({ id: 'faculty-2', assignment_cycle_id: '103', faculty_user_id: 11, professor_name: 'Professor B' }),
    record({ id: 'period-2', assignment_cycle_id: '104', semester: 'SECOND' }),
  ]));
  expect(items).toHaveLength(5);
  expect(new Set(items.map((item) => item.key)).size).toBe(5);
});

test('canonical program identity and existing filtering behavior remain unchanged', () => {
  const programs = [{ programId: 1, programCode: 'BSIT', programName: 'Bachelor of Science in Information Technology' }];
  const rows = canonicalizeLedgerPrograms([
    record({ id: 'code', program_id: 0, program_code: '', program_name: '', program: 'BSIT' }),
    record({ id: 'name', assignment_cycle_id: '101', program_id: 0, program_code: '', program_name: '', program: 'Bachelor of Science in Information Technology' }),
  ], programs);
  expect(buildLedgerHierarchy(rows)).toHaveLength(1);
  expect(filterLedgerRecords(rows, { programId: '1', schoolYear: '2026-2027', semester: 'FIRST' })).toHaveLength(2);
});
