import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import StudentAccountList, { mergeStudentAccountEnrollments, resolveStudentAccountPeriod } from './StudentAccountList';

const programs = [
  { code: 'BAC', name: 'Bachelor of Arts in Communication' },
  { code: 'BAC', name: 'BAC' },
  { code: 'BSIT', name: 'Bachelor of Science in Information Technology' },
];
const students = [
  { id: 1, studentno: '26-0021', fullname: 'Salazar, Leandro Emilio', department: 'BAC', yearLevel: '1', section: '1-1' },
  { id: 2, studentno: '26-0023', fullname: 'Maria Santos Reyes', department: programs[0].name, yearLevel: '2', section: '2-1' },
  { id: 3, studentno: '26-0025', fullname: 'Juan Dela Cruz', department: 'BSIT', yearLevel: '1', section: '1-1' },
  { id: 4, studentno: '26-0030', fullname: 'Ana Garcia', department: 'BSIT', yearLevel: '3', section: null },
];
const renderList = (rows = students, props = {}) => render(
  <StudentAccountList students={rows} programs={programs} {...props}>
    {(student) => <article key={student.id} data-testid="account">{student.studentno} {student.fullname}</article>}
  </StudentAccountList>
);

test('preserves unenrolled accounts without reusing historical year or section assignments', () => {
  const historical = { ...students[0], schoolYear: '2025-2026', semester: 'SECOND', enrollmentId: 80 };
  const current = { ...students[1], schoolYear: '2026-2027', semester: 'FIRST', enrollmentId: 90 };
  const result = mergeStudentAccountEnrollments([historical, students[1]], [current], {
    schoolYear: '2026-2027', semester: 'FIRST',
  });
  expect(result).toHaveLength(2);
  expect(result[0]).toEqual(expect.objectContaining({ id: 1, yearLevel: '', section: null, enrollmentId: null, assignmentStatus: 'Unassigned' }));
  expect(result[1]).toEqual(current);
  expect(historical.enrollmentId).toBe(80);
  renderList(result);
  filter('Filter student section', '__unassigned__');
  expect(screen.getByTestId('account')).toHaveTextContent('26-0021');
});
const search = (value) => fireEvent.change(screen.getByLabelText('Search student accounts'), { target: { value } });
const filter = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

test.each(['26-0021', '0021', 'leandro', 'Emilio', 'SALAZAR', ' Leandro Emilio Salazar ', 'Salazar, Leandro Emilio'])(
  'finds a student by ID or name in either order: %s', (value) => {
    renderList(); search(value);
    expect(screen.getAllByTestId('account')).toHaveLength(1);
    expect(screen.getByTestId('account')).toHaveTextContent('26-0021');
  }
);

test('combines program, enrollment year, section, and name and canonicalizes BAC options', () => {
  const snapshot = JSON.stringify(students);
  renderList();
  const departments = within(screen.getByLabelText('Filter student department'));
  expect(departments.getAllByRole('option', { name: programs[0].name })).toHaveLength(1);
  expect(departments.queryByRole('option', { name: 'BAC', exact: true })).not.toBeInTheDocument();
  filter('Filter student department', programs[0].name);
  expect(screen.getAllByTestId('account')).toHaveLength(2);
  filter('Filter student year level', '1');
  expect(within(screen.getByLabelText('Filter student section')).queryByRole('option', { name: '2-1' })).not.toBeInTheDocument();
  filter('Filter student section', '1-1'); search('Salazar');
  expect(screen.getByRole('status')).toHaveTextContent('1 matching student');
  expect(screen.getByTestId('account')).toHaveTextContent('26-0021');
  expect(JSON.stringify(students)).toBe(snapshot);
});

test('deduplicates section choices, includes unassigned students, and clears all controls', () => {
  renderList();
  expect(within(screen.getByLabelText('Filter student section')).getAllByRole('option', { name: '1-1' })).toHaveLength(1);
  filter('Filter student department', programs[2].name);
  filter('Filter student year level', '3');
  filter('Filter student section', '__unassigned__');
  expect(screen.getByTestId('account')).toHaveTextContent('Ana Garcia');
  fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
  expect(screen.getAllByTestId('account')).toHaveLength(4);
});

test('filters before pagination, resets page on search/filter, and keeps controls in empty state', () => {
  renderList(students, { pageSize: 2 });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  search('0021');
  expect(screen.getByTestId('account')).toHaveTextContent('Salazar');
  fireEvent.click(screen.getByRole('button', { name: 'Clear student search' }));
  expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  filter('Filter student year level', '1');
  expect(screen.getAllByTestId('account')[0]).toHaveTextContent('Salazar');
  search('nonexistent');
  expect(screen.getByText('No students found matching your search and filters')).toBeInTheDocument();
  expect(screen.getByLabelText('Search student accounts')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('0 matching students');
});

test('retains search selections when account details are opened and closed', () => {
  function Fixture() {
    const [opened, setOpened] = React.useState(false);
    return <StudentAccountList students={students} programs={programs}>
      {(student) => <article key={student.id}>
        {student.fullname}
        <button onClick={() => setOpened(!opened)}>{opened ? 'Close details' : 'View details'}</button>
        {opened && <p>Account information</p>}
      </article>}
    </StudentAccountList>;
  }
  render(<Fixture />); search('Salazar');
  filter('Filter student department', programs[0].name);
  fireEvent.click(screen.getByRole('button', { name: 'View details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
  expect(screen.getByLabelText('Search student accounts')).toHaveValue('Salazar');
  expect(screen.getByLabelText('Filter student department')).toHaveValue(programs[0].name);
});

test.each([1, 2, 3])('uses promoted enrollment for Year %s progression, not historical profile data', (sourceYear) => {
  const old = { ...students[0], yearLevel: String(sourceYear), enrollmentId: 10,
    schoolYear: '2026-2027', semester: 'FIRST', enrollmentStatus: 'ENROLLED' };
  const promoted = { ...old, yearLevel: String(sourceYear + 1), enrollmentId: 20,
    schoolYear: '2027-2028', section: `${sourceYear + 1}-1` };
  const untouched = { ...students[1], enrollmentId: 30, schoolYear: '2027-2028', semester: 'FIRST' };
  const input = [old, promoted, untouched];
  const snapshot = JSON.stringify(input);
  const period = resolveStudentAccountPeriod([promoted], { schoolYear: old.schoolYear, semester: old.semester });
  expect(period).toEqual({ schoolYear: '2027-2028', semester: 'FIRST' });
  const rows = mergeStudentAccountEnrollments([old, untouched], input, period);
  expect(rows.find((student) => student.id === old.id)).toEqual(promoted);
  expect(rows.find((student) => student.id === untouched.id)).toEqual(untouched);
  renderList(rows);
  search('Salazar');
  filter('Filter student department', programs[0].name);
  filter('Filter student year level', String(sourceYear + 1));
  filter('Filter student section', promoted.section);
  expect(screen.getByTestId('account')).toHaveTextContent('Salazar');
  filter('Filter student year level', String(sourceYear));
  expect(screen.queryByTestId('account')).not.toBeInTheDocument();
  expect(JSON.stringify(input)).toBe(snapshot);
});

test('selects periods deterministically and excludes historical or wrong-semester enrollments', () => {
  const active = { schoolYear: '2026-2027', semester: 'FIRST' };
  const old = { ...students[0], ...active, enrollmentId: 10, enrollmentStatus: 'ENROLLED' };
  const next = { ...old, enrollmentId: 11, semester: 'SECOND', yearLevel: '2' };
  expect(resolveStudentAccountPeriod([next, old], active)).toEqual({ ...active, semester: 'SECOND' });
  expect(resolveStudentAccountPeriod([old, next], active)).toEqual({ ...active, semester: 'SECOND' });
  expect(resolveStudentAccountPeriod([{ ...next, enrollmentStatus: 'DROPPED' }, old], active)).toEqual(active);
  expect(resolveStudentAccountPeriod([], active)).toEqual(active);
  expect(mergeStudentAccountEnrollments([old], [next, old], active)[0]).toEqual(old);
  expect(mergeStudentAccountEnrollments([next], [old], { ...active, semester: 'MIDYEAR' })[0])
    .toEqual(expect.objectContaining({ yearLevel: '', section: null, enrollmentId: null, assignmentStatus: 'Unassigned' }));
});
