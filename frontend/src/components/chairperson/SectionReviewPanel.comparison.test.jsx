import { render, screen, within } from '@testing-library/react';
import SectionReviewPanel from './SectionReviewPanel';

test('renders responsive side-by-side comparison tables ranked by submitted grade and aligned by Student ID', () => {
  render(<SectionReviewPanel activeTerm="finals" selectedSection={{
    reviewKey: 'section-1', sectionName: 'BSIT 1-1', reviewStatus: 'submitted', totalStudents: 2, encodedCount: 2, progress: 100,
    students: [
      { studentId: '26-0002', fullName: 'Dela Cruz' },
      { studentId: '26-0001', fullName: 'Delacruz' },
    ],
    grades: {
      '26-0001': { midterm: '85', finals: '90', standing: 'active' },
      '26-0002': { midterm: '75', finals: '80', standing: 'active' },
    }, reviewLogs: [],
  }} onSendBack={() => {}} onApprove={() => {}} onFinalize={() => {}} />);
  const grid = screen.getByTestId('grade-comparison-grid');
  expect(grid).toHaveClass('lg:grid-cols-2');
  const tables = within(grid).getAllByRole('table');
  expect(within(tables[0]).getAllByText('26-0001').length).toBe(1);
  expect(within(tables[1]).getAllByText('26-0001').length).toBe(1);
  expect(within(tables[0]).getAllByRole('row')[1]).toHaveTextContent('Delacruz');
  expect(within(tables[1]).getAllByRole('row')[1]).toHaveTextContent('85');
});

test('keeps missing grades last and uses Student ID as the deterministic tie breaker', () => {
  render(<SectionReviewPanel activeTerm="midterm" selectedSection={{
    reviewKey: 'section-2', sectionName: 'BSIT 1-2', reviewStatus: 'submitted', totalStudents: 4, encodedCount: 3, progress: 75,
    students: [
      { studentId: '26-0004', fullName: 'Missing Grade' },
      { studentId: '26-0003', fullName: 'Lower Grade' },
      { studentId: '26-0002', fullName: 'Same Grade B' },
      { studentId: '26-0001', fullName: 'Same Grade A' },
    ],
    grades: {
      '26-0001': { midterm: '95', standing: 'active' },
      '26-0002': { midterm: '95', standing: 'active' },
      '26-0003': { midterm: '80', standing: 'active' },
      '26-0004': { midterm: '-', standing: 'active' },
    }, reviewLogs: [],
  }} onSendBack={() => {}} onApprove={() => {}} onFinalize={() => {}} />);

  const tables = screen.getAllByRole('table');
  for (const table of tables) {
    expect(within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
      '26-0001', '26-0002', '26-0003', '26-0004',
    ]);
  }
});
