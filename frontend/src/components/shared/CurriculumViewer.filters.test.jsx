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
