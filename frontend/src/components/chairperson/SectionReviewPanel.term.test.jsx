import React from 'react';
import { render, screen } from '@testing-library/react';
import SectionReviewPanel from './SectionReviewPanel';

const section = {
  reviewKey: 'cycle-10',
  reviewStatus: 'submitted',
  reviewNote: '',
  facultyName: 'Professor A',
  sectionName: 'BSIT 1-1',
  semester: 'FIRST',
  department: 'BSIT',
  totalStudents: 1,
  encodedCount: 1,
  progress: 100,
  students: [{ studentId: '26-0001', studentNo: '26-0001', fullName: 'Student A' }],
  grades: {
    '26-0001': { midterm: '85', finals: '90', standing: 'active' },
  },
  reviewLogs: [],
};

const renderPanel = (activeTerm) => render(
  <SectionReviewPanel
    selectedSection={section}
    activeTerm={activeTerm}
    onSendBack={jest.fn()}
    onApprove={jest.fn()}
    onSubmitToRegistrar={jest.fn()}
    onViewIpfs={jest.fn()}
  />
);

test('midterm review does not render closed Finals workflow columns or values', () => {
  renderPanel('midterm');

  expect(screen.getByRole('columnheader', { name: 'Midterm' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Finals' })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Final Grade' })).not.toBeInTheDocument();
  expect(screen.queryByText('90')).not.toBeInTheDocument();
});

test('finals review renders preserved Midterm and active Finals values', () => {
  renderPanel('finals');

  expect(screen.getByRole('columnheader', { name: 'Finals' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Final Grade' })).toBeInTheDocument();
  expect(screen.getByText('85')).toBeInTheDocument();
  expect(screen.getByText('90')).toBeInTheDocument();
});
