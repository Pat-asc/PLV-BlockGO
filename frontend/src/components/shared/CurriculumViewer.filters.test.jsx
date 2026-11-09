import { fireEvent, render, screen, within } from '@testing-library/react';
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

test('places Registrar-assigned cross-department subjects first before regular curriculum subjects', () => {
  const mixedCurriculum = {
    ...curriculum,
    subjects: [
      { subjectId: 1, subjectCode: 'IT101', subjectTitle: 'First', units: 3, yearLevel: 1, semester: 'FIRST', priority: 1 },
      { subjectId: 2, subjectCode: 'BSA201', subjectTitle: 'Intermediate Accounting', units: 3, yearLevel: 3, semester: 'FIRST', isCrossAssigned: true, priority: 0, sourceProgramCode: 'BSA' },
      { subjectId: 3, subjectCode: 'IT102', subjectTitle: 'Second', units: 3, yearLevel: 1, semester: 'SECOND', priority: 1 },
    ],
  };
  render(<CurriculumViewer curricula={[mixedCurriculum]} />);

  const crossSection = screen.getByTestId('cross-assigned-curriculum-subjects');
  expect(within(crossSection).getByText('BSA201')).toBeInTheDocument();
  const allRows = screen.getAllByRole('row', { name: /Subject code/i });
  expect(allRows[0]).toHaveTextContent('BSA201');
  expect(allRows[1]).toHaveTextContent('IT101');
  expect(allRows[2]).toHaveTextContent('IT102');
});

test('supports real-time search by code and title without mutating curriculum and keeps cross subjects first', () => {
  const mixedCurriculum = {
    ...curriculum,
    subjects: [
      { subjectId: 1, subjectCode: 'IT201', subjectTitle: 'Data Structures and Algorithms', units: 3, yearLevel: 2, semester: 'FIRST', priority: 1 },
      { subjectId: 2, subjectCode: 'BSA201', subjectTitle: 'Accounting Data Systems', units: 3, yearLevel: 3, semester: 'FIRST', isCrossAssigned: true, priority: 0 },
      { subjectId: 3, subjectCode: 'IT101', subjectTitle: 'Introduction to Computing', units: 3, yearLevel: 1, semester: 'FIRST', priority: 1 },
    ],
  };
  const original = JSON.stringify(mixedCurriculum);
  render(<CurriculumViewer curricula={[mixedCurriculum]} />);

  const searchInput = screen.getByPlaceholderText('Search subject code or subject name...');
  fireEvent.change(searchInput, { target: { value: 'data' } });
  const matchingRows = screen.getAllByRole('row', { name: /Subject code/i });
  expect(matchingRows).toHaveLength(2);
  expect(matchingRows[0]).toHaveTextContent('BSA201');
  expect(matchingRows[1]).toHaveTextContent('IT201');

  fireEvent.change(searchInput, { target: { value: 'nonexistent-subject-xyz' } });
  expect(screen.getByText('No subjects found.')).toBeInTheDocument();

  fireEvent.change(searchInput, { target: { value: '' } });
  expect(screen.getAllByRole('row', { name: /Subject code/i })).toHaveLength(3);
  expect(JSON.stringify(mixedCurriculum)).toBe(original);
});

test('keeps shifter credits and historical subjects in recorded year-semester tables without inflating curriculum units', () => {
  const shiftedBsaCurriculum = {
    curriculumId: 10,
    programCode: 'BSA',
    programName: 'Bachelor of Science in Accountancy',
    curriculumName: 'BSA 2026',
    status: 'PUBLISHED',
    subjects: [
      { subjectId: 1, subjectCode: 'GE 101', subjectTitle: 'Understanding the Self', units: 3, yearLevel: 1, semester: 'FIRST', isCompleted: true, isCredited: true, isShifterCredit: true, sourceProgramCode: 'BSIT', completionStatus: 'COMPLETED', finalGrade: 1.75 },
      { subjectId: 2, subjectCode: 'PE 101', subjectTitle: 'Movement Enhancement', units: 2, yearLevel: 1, semester: 'FIRST', isCompleted: true, isCredited: true, completionStatus: 'COMPLETED', finalGrade: 1.5 },
      { subjectId: 3, subjectCode: 'BSA 101', subjectTitle: 'Financial Accounting 1', units: 3, yearLevel: 1, semester: 'FIRST', isCompleted: false, completionStatus: 'REMAINING' },
      { subjectId: 4, subjectCode: 'MATH 101', subjectTitle: 'Business Mathematics', units: 3, yearLevel: 1, semester: 'FIRST', isCompleted: false, completionStatus: 'REMAINING' },
      { subjectId: 0, subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing', units: 3, yearLevel: 1, semester: 'FIRST', isCompleted: true, isHistorical: true, countsTowardCurriculum: false, sourceProgramCode: 'BSIT', completionStatus: 'COMPLETED', finalGrade: 1.25 },
    ],
    totalUnits: 11,
  };
  render(<CurriculumViewer curricula={[shiftedBsaCurriculum]} showInternalMetadata={false} />);

  const remainingSection = screen.getByTestId('remaining-curriculum-subjects');
  for (const code of ['GE 101', 'PE 101', 'BSA 101', 'MATH 101', 'IT 101']) {
    expect(within(remainingSection).getAllByText(code)).toHaveLength(1);
  }
  expect(screen.queryByTestId('completed-curriculum-subjects')).not.toBeInTheDocument();
  expect(within(remainingSection).getByText('Shifter Credit · From BSIT')).toBeInTheDocument();
  expect(within(remainingSection).getByText('Historical · From BSIT')).toBeInTheDocument();
  expect(screen.getByText('Total Units: 11')).toBeInTheDocument();
  expect(screen.getByText('Overall Curriculum Units: 11')).toBeInTheDocument();
  expect(screen.getByText(/Historical subjects remain part of the academic record but do not add to current curriculum units/i)).toBeInTheDocument();
});

test('renders an exact-code failed prior attempt as Needs Retake', () => {
  const failedCurriculum = {
    ...curriculum,
    subjects: [{ ...curriculum.subjects[0], needsRetake: true, completionStatus: 'NEEDS_RETAKE', displayStatus: 'Needs Retake', finalGrade: 5 }],
  };
  render(<CurriculumViewer curricula={[failedCurriculum]} progressBySubject={{ IT101: { status: 'Needs Retake', grade: '5' } }} />);
  expect(screen.getByRole('row', { name: /IT101.*Needs Retake.*5/i })).toBeInTheDocument();
});
