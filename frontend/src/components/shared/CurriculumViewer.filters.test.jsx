import { fireEvent, render, screen } from '@testing-library/react';
import CurriculumViewer from './CurriculumViewer';

const curriculum = {
  curriculumId: 1, programCode: 'BSIT', programName: 'Information Technology', curriculumName: 'BSIT 2026', status: 'PUBLISHED',
  subjects: [
    { subjectId: 1, subjectCode: 'IT101', subjectTitle: 'First', units: 2, yearLevel: 1, semester: 'FIRST' },
    { subjectId: 2, subjectCode: 'IT102', subjectTitle: 'Second', units: 3, yearLevel: 1, semester: 'SECOND' },
    { subjectId: 3, subjectCode: 'IT201', subjectTitle: 'Advanced', units: 4, yearLevel: 2, semester: 'FIRST' },
  ],
};

const choose = (fieldName, optionName) => {
  fireEvent.click(screen.getByRole('button', { name: fieldName }));
  fireEvent.click(screen.getByRole('option', { name: optionName }));
};

test('Year Level and Semester filters work independently and together without mutating curriculum', () => {
  const original = JSON.stringify(curriculum);
  render(<CurriculumViewer curricula={[curriculum]} />);
  choose('Year Level', '2nd Year');
  expect(screen.getByText('IT201')).toBeInTheDocument();
  expect(screen.queryByText('IT101')).not.toBeInTheDocument();
  choose('Semester', 'First Semester');
  expect(screen.getByText('IT201')).toBeInTheDocument();
  expect(screen.queryByText('IT102')).not.toBeInTheDocument();
  expect(JSON.stringify(curriculum)).toBe(original);
});

test('only semesters actually present in curriculum data are offered', () => {
  render(<CurriculumViewer curricula={[curriculum]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Semester' }));
  expect(screen.queryByRole('option', { name: /Midyear/i })).not.toBeInTheDocument();
});

test('catalog-only views use neutral rows instead of student progress styling', () => {
  const stripedCurriculum = {
    ...curriculum,
    subjects: curriculum.subjects.map((subject) => subject.subjectId === 2 ? { ...subject, semester: 'FIRST' } : subject),
  };
  render(<CurriculumViewer curricula={[stripedCurriculum]} />);

  const firstRow = screen.getByRole('row', { name: /Subject code IT101 Subject title First/ });
  const secondRow = screen.getByRole('row', { name: /Subject code IT102 Subject title Second/ });
  expect(firstRow).not.toHaveAttribute('data-progress-status');
  expect(firstRow).toHaveClass('dark:bg-slate-900', 'dark:text-slate-200', 'dark:hover:bg-slate-800');
  expect(secondRow).toHaveClass('dark:bg-slate-800/60', 'dark:text-slate-200');
  expect(screen.getByTestId('curriculum-viewer')).toHaveClass('dark:border-slate-700', 'dark:bg-slate-900');
});

test('student progress rows use readable status-specific dark surfaces', () => {
  render(<CurriculumViewer curricula={[curriculum]} progressBySubject={{
    IT101: { status: 'Completed', grade: '1.25' },
    IT102: { status: 'In Progress' },
    IT201: { status: 'Not Yet Taken' },
  }} />);

  expect(screen.getByRole('row', { name: /Subject code IT101 Subject title First/ })).toHaveClass('dark:bg-emerald-950/40', 'dark:text-slate-100');
  expect(screen.getByRole('row', { name: /Subject code IT102 Subject title Second/ })).toHaveClass('dark:bg-amber-950/40', 'dark:text-slate-100');
  expect(screen.getByRole('row', { name: /Subject code IT201 Subject title Advanced/ })).toHaveClass('dark:bg-slate-800/60', 'dark:text-slate-200');
});

test('renders phone and tablet labels without duplicating curriculum rows', () => {
  render(<CurriculumViewer curricula={[curriculum]} />);

  expect(screen.getAllByText('Subject code')).toHaveLength(curriculum.subjects.length);
  expect(screen.getAllByText('Subject title')).toHaveLength(curriculum.subjects.length);
  expect(screen.queryByText(/swipe horizontally/i)).not.toBeInTheDocument();
  expect(screen.getAllByRole('row', { name: /IT10[12]|IT201/ })).toHaveLength(curriculum.subjects.length);
});
