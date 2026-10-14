import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FacultyStatusTable from '../faculty/FacultyStatusTable';
import SectionReviewPanel from './SectionReviewPanel';

const submittedSection = {
  reviewKey: 'faculty|bsit-1-1|it-101|midterm',
  facultyId: 'faculty@plv.edu.ph',
  facultyName: 'Dennis Andes',
  sectionName: 'BSIT 1-1',
  subjectCode: 'IT 101',
  subjectTitle: 'Introduction to Computing',
  schoolYear: '2026-2027',
  semester: 'First Semester',
  term: 'midterm',
  reviewStatus: 'submitted',
  totalStudents: 2,
  encodedCount: 2,
  progress: 100,
  students: [
    { studentId: '26-0002', fullName: 'Second Student' },
    { studentId: '26-0001', fullName: 'First Student' },
  ],
  grades: {
    '26-0001': { recordId: 'grade-1', midterm: '91.50', standing: 'active', integrityStatus: 'MATCH' },
    '26-0002': { recordId: 'grade-2', midterm: '84', standing: 'active', integrityStatus: 'MISMATCH' },
  },
  referenceGrades: {
    '26-0001': { grade: '91.50' },
    '26-0002': { grade: '82' },
  },
};

function ReviewHarness() {
  const [selected, setSelected] = useState(null);
  return <>
    <FacultyStatusTable rows={[submittedSection]} viewMode="forReview" selectedReviewKey={selected?.reviewKey} onSelectSection={setSelected} />
    <SectionReviewPanel selectedSection={selected} sourceView="forReview" activeTerm="midterm" onClose={() => setSelected(null)} onSendBack={jest.fn()} onApprove={jest.fn()} onSendToRegistrar={jest.fn()} />
  </>;
}

test('a workload action opens one centered modal instead of an inline collapsible review', () => {
  render(<ReviewHarness />);
  expect(screen.queryByRole('dialog', { name: 'Review Encoded Grades' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Review Encoded' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Review Section' })).not.toBeInTheDocument();

  const trigger = screen.getByRole('button', { name: 'Review Grades' });
  trigger.focus();
  fireEvent.click(trigger);

  expect(screen.getByRole('dialog', { name: 'Review Encoded Grades' })).toHaveClass('max-w-6xl', 'max-h-[92vh]', 'dark:bg-slate-900');
  fireEvent.click(screen.getByRole('button', { name: 'Close Review Encoded Grades' }));
  expect(screen.queryByRole('dialog', { name: 'Review Encoded Grades' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test('the modal shows metadata, Student-ID-aligned tables, mismatch count, and internal scrolling', () => {
  render(<SectionReviewPanel selectedSection={submittedSection} sourceView="forReview" activeTerm="midterm" onClose={jest.fn()} onSendBack={jest.fn()} onApprove={jest.fn()} />);

  expect(screen.getByTitle('Dennis Andes')).toBeInTheDocument();
  expect(screen.getByTitle('BSIT 1-1')).toBeInTheDocument();
  expect(screen.getByTitle('IT 101 — Introduction to Computing')).toBeInTheDocument();
  expect(screen.getByTitle('Midterm')).toBeInTheDocument();
  expect(screen.getByText('1 Difference Detected')).toBeInTheDocument();
  const tables = screen.getAllByRole('table');
  expect(within(tables[0]).getAllByRole('row')[1]).toHaveTextContent('26-0001');
  expect(within(tables[1]).getAllByRole('row')[1]).toHaveTextContent('26-0001');
  expect(within(tables[0]).getAllByRole('row')[2]).toHaveAttribute('data-mismatch', 'true');
  expect(within(tables[1]).getAllByRole('row')[2]).toHaveAttribute('data-mismatch', 'true');
  expect(screen.getByTestId('grade-comparison-grid')).toHaveClass('lg:grid-cols-2');
  expect(screen.getByTestId('review-scroll-region')).toHaveClass('overflow-y-auto');
  expect(screen.getByTestId('review-modal-footer')).not.toBe(screen.getByTestId('review-scroll-region'));
});

test('return remarks and confirmation stay inside the modal and duplicate submission is prevented', async () => {
  let resolveReturn;
  const onSendBack = jest.fn(() => new Promise((resolve) => { resolveReturn = resolve; }));
  render(<SectionReviewPanel selectedSection={submittedSection} activeTerm="midterm" onClose={jest.fn()} onSendBack={onSendBack} onApprove={jest.fn()} />);

  const returnButton = screen.getByRole('button', { name: 'Return for Correction' });
  expect(returnButton).toBeDisabled();
  const remarks = screen.getByRole('textbox', { name: 'Correction remarks' });
  remarks.focus();
  fireEvent.change(remarks, { target: { value: 'Please correct the encoded midterm grade before resubmitting.' } });
  expect(remarks).toHaveFocus();
  expect(screen.getByRole('dialog', { name: 'Review Encoded Grades' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  fireEvent.click(returnButton);
  const confirmation = screen.getByRole('dialog', { name: 'Return Grades to Faculty' });
  const confirm = within(confirmation).getByRole('button', { name: 'Confirm Return' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(onSendBack).toHaveBeenCalledTimes(1);
  expect(onSendBack).toHaveBeenCalledWith('Please correct the encoded midterm grade before resubmitting.');
  expect(within(confirmation).getByRole('button', { name: 'Returning...' })).toBeDisabled();
  resolveReturn();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Return Grades to Faculty' })).not.toBeInTheDocument());
});

test('returned and finalized reviews are view-only and do not expose invalid workflow actions', () => {
  const { rerender } = render(<SectionReviewPanel selectedSection={{ ...submittedSection, reviewStatus: 'returned', reviewNote: 'Correct the student grade' }} activeTerm="midterm" onClose={jest.fn()} onSendBack={jest.fn()} onApprove={jest.fn()} onSendToRegistrar={jest.fn()} />);
  expect(screen.getByText(/Correct the student grade/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Return for Correction' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve Section' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send to Registrar' })).not.toBeInTheDocument();

  rerender(<SectionReviewPanel selectedSection={{ ...submittedSection, reviewKey: 'finalized', reviewStatus: 'forwarded' }} activeTerm="midterm" onClose={jest.fn()} onSendBack={jest.fn()} onApprove={jest.fn()} onSendToRegistrar={jest.fn()} />);
  expect(screen.queryByRole('button', { name: 'Return for Correction' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve Section' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send to Registrar' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close Review Encoded Grades' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
});

test('successful Registrar handoff updates the modal state and prevents another send', async () => {
  const onSend = jest.fn();
  function ApprovedHarness() {
    const [section, setSection] = useState({ ...submittedSection, reviewStatus: 'approved', canSendToRegistrar: true });
    return <SectionReviewPanel selectedSection={section} activeTerm="midterm" onClose={jest.fn()} onSendBack={jest.fn()} onApprove={jest.fn()} onSendToRegistrar={async () => {
      onSend();
      setSection((current) => ({ ...current, canSendToRegistrar: false, sentToRegistrar: true }));
    }} />;
  }
  render(<ApprovedHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Send to Registrar' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Send to Registrar' })).getByRole('button', { name: 'Send to Registrar' }));
  await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send to Registrar' })).toBeDisabled());
  expect(screen.getByText('Sent to Registrar')).toBeInTheDocument();
});
