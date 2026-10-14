import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CurriculumManagement from './CurriculumManagement';
import { createAcademicProgram } from '../../services/api';

jest.mock('../../services/api', () => ({
  approveCurriculum: jest.fn(), archiveCurriculum: jest.fn(), assignProgramCurriculum: jest.fn(),
  createAcademicProgram: jest.fn(), fetchCurriculums: jest.fn().mockResolvedValue({ data: [] }),
  publishCurriculum: jest.fn(), returnCurriculum: jest.fn(),
}));

test('Registrar can create a normalized program without fabricating a curriculum', async () => {
  const academicDataChanged = jest.fn();
  window.addEventListener('blockgo:academic-data-changed', academicDataChanged);
  createAcademicProgram.mockResolvedValue({ message: 'Academic program BSIS created.' });
  render(<CurriculumManagement />);
  fireEvent.change(screen.getByLabelText('Program Code'), { target: { value: ' bsis ' } });
  fireEvent.change(screen.getByLabelText('Program Name'), { target: { value: '  Bachelor of Science in Information Systems  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Program' }));
  await waitFor(() => expect(createAcademicProgram).toHaveBeenCalledWith('BSIS', 'Bachelor of Science in Information Systems'));
  expect(screen.getByText('Academic program BSIS created.')).toBeInTheDocument();
  expect(academicDataChanged).toHaveBeenCalledTimes(1);
  expect(academicDataChanged.mock.calls[0][0].detail).toEqual({ reason: 'academic_program_created', programCode: 'BSIS' });
  window.removeEventListener('blockgo:academic-data-changed', academicDataChanged);
});

test('invalid Program Code is rejected before the API request', () => {
  render(<CurriculumManagement />);
  fireEvent.change(screen.getByLabelText('Program Code'), { target: { value: 'B' } });
  fireEvent.change(screen.getByLabelText('Program Name'), { target: { value: 'Program Name' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Create academic program' }));
  expect(createAcademicProgram).not.toHaveBeenCalled();
  expect(screen.getByText(/2-20 character Program Code/i)).toBeInTheDocument();
});
