import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FacultyStatusTable from './FacultyStatusTable';

const section = (overrides = {}) => ({
  reviewKey: 'faculty|section|subject',
  facultyId: 'faculty@plv.edu.ph',
  facultyName: 'Faculty One',
  academicSectionId: 41,
  sectionName: 'BSIT 1-1',
  subjectCode: 'IT 101',
  schoolYear: '2026-2027',
  semester: 'FIRST',
  term: 'finals',
  reviewStatus: 'submitted',
  grades: {},
  ...overrides,
});

test('counts unique academic sections instead of duplicate subject rows', () => {
  const rows = [
    section(),
    section({ reviewKey: 'faculty|section|other-subject', subjectCode: 'IT 102' }),
  ];
  render(<FacultyStatusTable rows={rows} allRows={rows} viewMode="forReview" />);
  expect(screen.getByText('1/1 Section Encoded')).toBeInTheDocument();
  expect(screen.queryByText('2/2 Section Encoded')).not.toBeInTheDocument();
});

test('shows finalized tracking metadata and opens the selected record', () => {
  const onSelectSection = jest.fn();
  const finalized = section({
    reviewStatus: 'forwarded',
    finalizedAt: '2026-09-28T10:00:00Z',
    finalizedBy: 'chair@plv.edu.ph',
  });
  render(<FacultyStatusTable rows={[finalized]} allRows={[finalized]} viewMode="forwarded" onSelectSection={onSelectSection} />);
  expect(screen.getByText('Finalized Grades')).toBeInTheDocument();
  expect(screen.getByText('chair@plv.edu.ph')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View Details' }));
  expect(onSelectSection).toHaveBeenCalledWith(finalized);
});

test('labels approved sections as the Finalize Queue instead of finalized', () => {
  const approved = section({ reviewStatus: 'approved' });
  render(<FacultyStatusTable rows={[approved]} allRows={[approved]} viewMode="approved" />);
  expect(screen.getByText('Finalize Queue')).toBeInTheDocument();
  expect(screen.getByText('Ready to Finalize')).toBeInTheDocument();
  expect(screen.queryByText('Finalized Grades')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review Encoded' }));
  expect(screen.getByText('IT 101 / 2026-2027 / FIRST / FINALS')).toBeInTheDocument();
});

test('shows an empty current-season finalized state after reset filtering', () => {
  render(<FacultyStatusTable rows={[]} allRows={[]} viewMode="forwarded" />);
  expect(screen.getByText(/No finalized submissions exist in the current encoding season/i)).toBeInTheDocument();
});
