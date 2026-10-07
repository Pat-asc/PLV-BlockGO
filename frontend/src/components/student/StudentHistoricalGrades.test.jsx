import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import StudentHistoricalGrades from './StudentHistoricalGrades';

test('groups finalized grades by school year and then semester', () => {
  render(<StudentHistoricalGrades grades={[
    { recordId: '1', schoolYear: '2025-2026', semester: '2nd Semester', yearLevel: 1, subjectCode: 'IT102', subjectTitle: 'Programming', grade: '88', status: 'FINALIZED' },
    { recordId: '2', schoolYear: '2026-2027', semester: '1st Semester', yearLevel: 2, subjectCode: 'IT201', subjectTitle: 'Data Structures', grade: '90', status: 'FINALIZED' },
  ]} />);

  const schoolYears = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
  expect(schoolYears).toEqual(['School Year 2026-2027', 'School Year 2025-2026']);
  expect(screen.getByText('1st Year')).toBeInTheDocument();
  expect(screen.getByText('2nd Year')).toBeInTheDocument();
});

test('switches between card and table views and remembers the choice for the session', () => {
  sessionStorage.clear();
  render(<StudentHistoricalGrades grades={[
    { recordId: 'record-1', schoolYear: '2026-2027', semester: 'FIRST', yearLevel: 1,
      subjectCode: 'IT101', subjectTitle: 'Introduction to Computing', units: 3,
      term: 'finals', grade: '90', finalAverage: '90', professor: 'Faculty One', status: 'Finalized' },
  ]} />);

  expect(screen.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  expect(screen.getByRole('columnheader', { name: 'Subject Code' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Final Grade' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Equivalent' })).toBeInTheDocument();
  expect(sessionStorage.getItem('blockgo.student.grades.view')).toBe('table');
});

test('merges Midterm and Finals for one assignment without duplicating the subject', () => {
  sessionStorage.clear();
  render(<StudentHistoricalGrades grades={[
    { recordId: 'mid-1', studentId: '26-0001', assignmentCycleId: '77', schoolYear: '2026-2027', semester: 'FIRST',
      subjectCode: 'IT101', subjectTitle: 'Introduction to Computing', term: 'midterm', grade: '85', status: 'Finalized' },
    { recordId: 'final-1', studentId: '26-0001', assignmentCycleId: '77', schoolYear: '2026-2027', semester: 'FIRST',
      subjectCode: 'IT101', subjectTitle: 'Introduction to Computing', term: 'finals', grade: '92', finalAverage: '89', status: 'Finalized' },
  ]} />);

  expect(screen.getAllByText('IT101')).toHaveLength(1);
  expect(screen.getByText('85')).toBeInTheDocument();
  expect(screen.getByText('1.75')).toBeInTheDocument();
});
