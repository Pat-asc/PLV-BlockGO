import { render, screen, within } from '@testing-library/react';
import SectionReviewPanel from './SectionReviewPanel';

test('renders responsive side-by-side comparison tables aligned by Student ID', () => {
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
