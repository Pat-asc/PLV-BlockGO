import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

test('renders one initial row per faculty and opens that faculty sections in a modal', () => {
  const rows = [
    section(),
    section({ reviewKey: 'faculty|section|other-subject', subjectCode: 'IT 102' }),
  ];
  render(<FacultyStatusTable rows={rows} allRows={rows} viewMode="forReview" />);
  expect(screen.getByRole('button', { name: 'View Sections' })).toBeInTheDocument();
  expect(screen.getByText('2 sections')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Review Grades' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'View Sections' }));
  const dialog = screen.getByRole('dialog', { name: 'Faculty One — Encoded Sections' });
  expect(within(dialog).getByText('IT 101')).toBeInTheDocument();
  expect(within(dialog).getByText('IT 102')).toBeInTheDocument();
  expect(within(dialog).getAllByRole('button', { name: 'Review Grades' })).toHaveLength(2);
  expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
});

test('groups by stable faculty identity and does not merge different faculty with the same name', () => {
  const onSelectSection = jest.fn();
  const rows = [
    section({ reviewKey: 'faculty-1|section-1', facultyId: 'faculty-1', sectionName: 'BSIT 1-1' }),
    section({ reviewKey: 'faculty-1|section-2', facultyId: 'faculty-1', sectionName: 'BSIT 1-2' }),
    section({ reviewKey: 'faculty-2|section-3', facultyId: 'faculty-2', sectionName: 'BSIT 2-1' }),
  ];
  render(<FacultyStatusTable rows={rows} viewMode="forReview" onSelectSection={onSelectSection} />);
  expect(screen.getAllByText('Faculty One')).toHaveLength(2);
  expect(screen.getByText('2 sections')).toBeInTheDocument();
  expect(screen.getByText('1 section')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'View Sections' })[1]);
  const dialog = screen.getByRole('dialog', { name: 'Faculty One — Encoded Sections' });
  expect(within(dialog).getByText('BSIT 2-1')).toBeInTheDocument();
  expect(within(dialog).queryByText('BSIT 1-1')).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Review Grades' }));
  expect(onSelectSection).toHaveBeenCalledWith(rows[2]);
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
  fireEvent.click(screen.getByRole('button', { name: 'View Sections' }));
  expect(screen.getByText(/chair@plv\.edu\.ph/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View Details' }));
  expect(onSelectSection).toHaveBeenCalledWith(finalized);
});

test('labels approved sections as ready for Registrar without implying Chairperson finalization', () => {
  const approved = section({ reviewStatus: 'approved' });
  render(<FacultyStatusTable rows={[approved]} allRows={[approved]} viewMode="approved" />);
  expect(screen.getByText('Approved Grades')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View Sections' }));
  expect(screen.getByText('Ready for Registrar')).toBeInTheDocument();
  expect(screen.queryByText('Finalized Grades')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'View Review' })).toBeInTheDocument();
});

test.each([
  ['forReview', 'Review Grades'],
  ['returned', 'View Review'],
  ['approved', 'View Review'],
  ['forwarded', 'View Details'],
])('%s keeps its workflow-specific section action', (viewMode, action) => {
  render(<FacultyStatusTable rows={[section({ reviewStatus: viewMode === 'forReview' ? 'submitted' : viewMode })]} viewMode={viewMode} />);
  fireEvent.click(screen.getByRole('button', { name: 'View Sections' }));
  expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
});

test('shows an empty current-season finalized state after reset filtering', () => {
  render(<FacultyStatusTable rows={[]} allRows={[]} viewMode="forwarded" />);
  expect(screen.getByText(/No finalized submissions exist in the current encoding season/i)).toBeInTheDocument();
});
