import React from 'react';
import { render, screen } from '@testing-library/react';
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
