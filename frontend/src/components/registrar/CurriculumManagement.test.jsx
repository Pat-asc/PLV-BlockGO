import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CurriculumManagement from './CurriculumManagement';
import {
  archiveCurriculum,
  assignProgramCurriculum,
  fetchCurriculums,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  approveCurriculum: jest.fn(),
  archiveCurriculum: jest.fn(),
  assignProgramCurriculum: jest.fn(),
  fetchCurriculums: jest.fn(),
  publishCurriculum: jest.fn(),
  returnCurriculum: jest.fn(),
}));

const publishedCurriculum = {
  curriculumId: 21,
  programCode: 'BSIT',
  programName: 'Bachelor of Science in Information Technology',
  curriculumName: 'BSIT Curriculum 2026',
  curriculumVersion: '2026.1',
  schoolYear: '2026-2027',
  status: 'PUBLISHED',
  createdByName: 'Department Head',
  totalUnits: 3,
  subjects: [{
    subjectId: 101,
    subjectCode: 'IT 101',
    subjectTitle: 'Introduction to Computing',
    units: 3,
    lectureHours: 3,
    laboratoryHours: 0,
    prerequisite: '',
    yearLevel: 1,
    semester: 'FIRST',
    subjectType: 'Core',
  }],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  fetchCurriculums.mockResolvedValue({ data: [publishedCurriculum] });
  assignProgramCurriculum.mockResolvedValue({ affectedStudents: 4 });
  archiveCurriculum.mockResolvedValue({ status: 'Success' });
});

afterEach(() => {
  window.confirm.mockRestore();
});

test('shows program assignment and archive controls beneath the curriculum table', async () => {
  render(<CurriculumManagement />);

  fireEvent.click(await screen.findByRole('button', { name: /Published \(1\)/i }));
  const tables = await screen.findAllByRole('table');
  const finalTable = tables[tables.length - 1];
  const actions = screen.getByRole('region', { name: 'Curriculum actions' });

  expect(within(actions).getByRole('button', { name: 'Assign to Batch' })).toBeInTheDocument();
  expect(within(actions).getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  expect(finalTable.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('assigns the selected curriculum to its student batch', async () => {
  render(<CurriculumManagement />);

  fireEvent.click(await screen.findByRole('button', { name: /Published \(1\)/i }));
  fireEvent.change(screen.getByLabelText('Student batch year'), { target: { value: '2026' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Assign to Batch' }));

  await waitFor(() => expect(assignProgramCurriculum).toHaveBeenCalledWith(21, '2026'));
  expect(await screen.findByText('Curriculum assigned to BSIT batch 2026. 4 students synchronized.')).toBeInTheDocument();
});

test('archives the selected published curriculum', async () => {
  render(<CurriculumManagement />);

  fireEvent.click(await screen.findByRole('button', { name: /Published \(1\)/i }));
  fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));

  await waitFor(() => expect(archiveCurriculum).toHaveBeenCalledWith(21));
});

test('keeps pending review controls above the curriculum tables', async () => {
  fetchCurriculums.mockResolvedValue({
    data: [{ ...publishedCurriculum, curriculumId: 23, status: 'PENDING_APPROVAL' }],
  });
  render(<CurriculumManagement />);

  const approveButton = await screen.findByRole('button', { name: 'Approve' });
  const tables = await screen.findAllByRole('table');

  expect(approveButton.compareDocumentPosition(tables[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Curriculum actions' })).not.toBeInTheDocument();
});

test('does not expose assignment or archive actions for an archived version', async () => {
  fetchCurriculums.mockResolvedValue({
    data: [{ ...publishedCurriculum, curriculumId: 22, status: 'ARCHIVED' }],
  });
  render(<CurriculumManagement />);

  fireEvent.click(await screen.findByRole('button', { name: /Archived \(1\)/i }));
  await screen.findByText(/BSIT Curriculum 2026/i);
  expect(screen.queryByRole('region', { name: 'Curriculum actions' })).not.toBeInTheDocument();
});
