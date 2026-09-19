import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import StudentCurrentSubjects from './StudentCurrentSubjects';
import CurriculumViewer from '../shared/CurriculumViewer';
import { canonicalAcademicSchoolYear, canonicalAcademicSemester, curriculumProgress } from '../../utils/studentAcademicHelpers';
import { getSectionStudents } from '../../utils/chairpersonHelpers';

const subjects = [
  { subjectId: 1, subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing', units: 3,
    prerequisite: 'IT 102', yearLevel: 1, semester: 'FIRST' },
  { subjectId: 2, subjectCode: 'IT 201', subjectTitle: 'Data Structures', units: 3, yearLevel: 2, semester: 'FIRST' },
  { subjectId: 3, subjectCode: 'IT 301', subjectTitle: 'Networks', units: 3, yearLevel: 3, semester: 'FIRST' },
  { subjectId: 4, subjectCode: 'IT 401', subjectTitle: 'Capstone', units: 3, yearLevel: 4, semester: 'FIRST' },
];
const enrolled = [{ subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing', units: 3,
  facultyName: 'Faculty Testing one' }];

test('current subjects stay visible without finalized grades or a Faculty assignment', () => {
  render(<StudentCurrentSubjects subjects={[...enrolled, { subjectCode: 'IT 103', subjectTitle: 'Programming', units: 3 }]}
    grades={[]} schoolYear="2026-2027" semester="FIRST" gradeError="Blockchain unavailable" />);
  expect(screen.getByText('IT 101')).toBeInTheDocument();
  expect(screen.getByText('IT 103')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /IT 101/ }));
  expect(screen.getByText('Faculty Testing one')).toBeInTheDocument();
  expect(screen.getAllByText('Not Yet Available').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: /IT 103/ }));
  expect(screen.getByText('To be assigned')).toBeInTheDocument();
});

test('checklist covers all years, stored prerequisites, and enrollment progress without grades', () => {
  const progress = curriculumProgress(subjects, enrolled, []);
  render(<CurriculumViewer curricula={[{ curriculumId: 1, curriculumName: 'BSIT Curriculum',
    curriculumVersion: '2026', programCode: 'BSIT', programName: 'Bachelor of Science in Information Technology',
    status: 'PUBLISHED', subjects }]} currentYear={1} progressBySubject={progress} />);
  expect(screen.getByText('IT 101')).toBeInTheDocument();
  expect(screen.getByText('In Progress')).toBeInTheDocument();
  expect(screen.getByText('IT 102')).toBeInTheDocument();
  for (const [year, code] of [[2, 'IT 201'], [3, 'IT 301'], [4, 'IT 401']]) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${year}(?:nd|rd|th) Year`) }));
    expect(screen.getByText(code)).toBeInTheDocument();
    expect(screen.getByText(code).closest('tr')).toHaveAttribute('data-progress-status', 'Not Yet Taken');
  }
});

test('only finalized grades determine completed or failed status', () => {
  const draft = [{ subjectCode: 'IT 201', status: 'Draft', term: 'finals', grade: '90' }];
  const finalized = [{ subjectCode: 'IT 301', status: 'Finalized', term: 'finals', grade: '90', schoolYear: '2025-2026' },
    { subjectCode: 'IT 401', status: 'Finalized', term: 'finals', grade: '70', schoolYear: '2025-2026' }];
  const progress = curriculumProgress(subjects, enrolled, [...draft, ...finalized]);
  expect(progress['IT 101'].status).toBe('In Progress');
  expect(progress['IT 201'].status).toBe('Not Yet Taken');
  expect(progress['IT 301']).toEqual({ status: 'Completed', grade: '90' });
  expect(progress['IT 401']).toEqual({ status: 'Failed', grade: '70' });
});

test('Chairperson and Registrar period matching keeps a legacy roster aligned with canonical grades', () => {
  expect(canonicalAcademicSchoolYear('2026')).toBe('2026-2027');
  expect(canonicalAcademicSemester('2nd Semester')).toBe('SECOND');
  expect(canonicalAcademicSchoolYear('2027')).not.toBe('2026-2027');
  expect(canonicalAcademicSemester('FIRST')).not.toBe('SECOND');
  const roster = [{ studentId: '26-0035', program: 'BSIT', schoolYear: '2026',
    semester: '2nd Semester', section: 'BSIT 1-1' }];
  expect(getSectionStudents({ students: roster, assignment: { program: 'BSIT', schoolYear: '2026-2027',
    semester: 'SECOND', sectionName: 'BSIT 1-1' } })).toEqual(roster);
});
