import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import GraduatingSectionModal from './GraduatingSectionModal';

const section = {
  sectionName: 'BSIT 4-1',
  students: [{
    studentId: '23-0001',
    firstName: 'Ada',
    lastName: 'Lovelace',
    originBatchYear: '2023',
    originYearLevel: '4th Year',
    targetSchoolYear: '2027-2028',
    status: 'Incomplete',
    remarks: '',
  }],
};

test('shows graduating student details in the shared modal and preserves editing callbacks', () => {
  const onUpdateStudent = jest.fn();
  const onClose = jest.fn();
  render(
    <GraduatingSectionModal
      section={section}
      statuses={['Incomplete', 'Graduated']}
      buildStudentName={(student) => `${student.lastName}, ${student.firstName}`}
      onUpdateStudent={onUpdateStudent}
      onClose={onClose}
    />
  );

  expect(screen.getByRole('dialog', { name: 'BSIT 4-1 Students' })).toBeInTheDocument();
  expect(screen.getByTestId('graduating-section-modal-roster')).toHaveTextContent('23-0001');
  expect(screen.getByText('Lovelace, Ada')).toBeInTheDocument();

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Graduated' } });
  expect(onUpdateStudent).toHaveBeenCalledWith('23-0001', expect.objectContaining({ status: 'Graduated' }));
  fireEvent.change(screen.getByPlaceholderText('Review note'), { target: { value: 'Verified' } });
  expect(onUpdateStudent).toHaveBeenCalledWith('23-0001', { remarks: 'Verified' });

  fireEvent.click(screen.getByRole('button', { name: 'Close BSIT 4-1 Students' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('does not render an inline roster when no section is selected', () => {
  render(
    <GraduatingSectionModal
      section={null}
      statuses={[]}
      buildStudentName={() => ''}
      onUpdateStudent={() => {}}
      onClose={() => {}}
    />
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByTestId('graduating-section-modal-roster')).not.toBeInTheDocument();
});
