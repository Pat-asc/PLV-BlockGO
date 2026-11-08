import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FacultyCurriculumPanel from './FacultyCurriculumPanel';
import { fetchFacultyCurriculums } from '../../services/api';

jest.mock('../../services/api', () => ({ fetchFacultyCurriculums: jest.fn() }));
jest.mock('../shared/CurriculumViewer', () => ({ curricula, loading, emptyMessage }) => (
  <div data-testid="curriculum-viewer" data-loading={String(loading)} data-count={curricula.length}>
    {curricula.map((curriculum) => <span key={curriculum.curriculumId}>{curriculum.programCode}:{curriculum.curriculumName}</span>)}
    {!loading && curricula.length === 0 ? emptyMessage : null}
  </div>
));

beforeEach(() => jest.clearAllMocks());

test('automatically requests authenticated faculty curricula without a program selector', async () => {
  fetchFacultyCurriculums.mockResolvedValue({
    homeProgram: { id: 1, code: 'BSIT', name: 'Information Technology' },
    homeCurricula: [{ curriculumId: 1, programCode: 'BSIT', curriculumName: 'BSIT 2026' }],
    crossDepartmentCurricula: [],
    data: [{ curriculumId: 1, programCode: 'BSIT', curriculumName: 'BSIT 2026' }],
  });
  render(<FacultyCurriculumPanel />);
  expect(await screen.findByText('BSIT:BSIT 2026')).toBeInTheDocument();
  expect(fetchFacultyCurriculums).toHaveBeenCalledTimes(1);
  expect(fetchFacultyCurriculums).toHaveBeenCalledWith();
  expect(screen.queryByLabelText(/program/i)).not.toBeInTheDocument();
});

test('keeps the home curriculum separate from one cross-department assignment', async () => {
  fetchFacultyCurriculums.mockResolvedValue({
    homeProgram: { id: 1, code: 'BSIT', name: 'Information Technology' },
    homeCurricula: [{ curriculumId: 1, programCode: 'BSIT', curriculumName: 'BSIT 2026' }],
    crossDepartmentCurricula: [{ curriculumId: 2, programCode: 'BSCS', curriculumName: 'BSCS 2026' }],
    data: [
      { curriculumId: 1, programCode: 'BSIT', curriculumName: 'BSIT 2026' },
      { curriculumId: 2, programCode: 'BSCS', curriculumName: 'BSCS 2026' },
    ],
  });
  render(<FacultyCurriculumPanel />);
  expect(await screen.findByText('BSIT:BSIT 2026')).toBeInTheDocument();
  expect(screen.queryByText('BSCS:BSCS 2026')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Cross-Department Curricula' }));
  expect(await screen.findByText('BSCS:BSCS 2026')).toBeInTheDocument();
  expect(screen.queryByText('BSIT:BSIT 2026')).not.toBeInTheDocument();
});

test('shows multiple cross-department curricula only in the cross-department tab', async () => {
  fetchFacultyCurriculums.mockResolvedValue({
    homeProgram: { id: 1, code: 'BSIT', name: 'Information Technology' },
    homeCurricula: [{ curriculumId: 1, programCode: 'BSIT', curriculumName: 'BSIT 2026' }],
    crossDepartmentCurricula: [
      { curriculumId: 2, programCode: 'BSCS', curriculumName: 'BSCS 2026' },
      { curriculumId: 3, programCode: 'BSEMC', curriculumName: 'BSEMC 2026' },
    ],
    data: [],
  });
  render(<FacultyCurriculumPanel />);
  await screen.findByText('BSIT:BSIT 2026');
  fireEvent.click(screen.getByRole('tab', { name: 'Cross-Department Curricula' }));
  await waitFor(() => expect(screen.getByTestId('curriculum-viewer')).toHaveAttribute('data-count', '2'));
});

test('shows a concise curriculum summary from the published checklist', async () => {
  fetchFacultyCurriculums.mockResolvedValue({ data: [{
    curriculumId: 1,
    programCode: 'BSIT',
    curriculumName: 'BSIT 2026',
    totalUnits: 7,
    subjects: [
      { subjectId: 1, subjectCode: 'IT 101', units: 3 },
      { subjectId: 2, subjectCode: 'IT 102', units: 4 },
    ],
  }] });

  render(<FacultyCurriculumPanel />);

  expect(await screen.findByRole('region', { name: 'Curriculum summary' })).toBeInTheDocument();
  expect(screen.getByText('Academic Program')).toBeInTheDocument();
  expect(screen.getByText('Curriculum Subjects')).toBeInTheDocument();
  expect(screen.getByText('Total Curriculum Units')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Refresh curriculum' })).not.toBeInTheDocument();
});

test.each([
  ['empty array', { data: [] }],
  ['null data', { data: null }],
  ['empty response', null],
])('shows a clean empty state for %s', async (_label, response) => {
  fetchFacultyCurriculums.mockResolvedValue(response);
  render(<FacultyCurriculumPanel />);
  expect(await screen.findByText('No published home department curriculum is available.')).toBeInTheDocument();
  expect(screen.getByTestId('curriculum-viewer')).toHaveAttribute('data-count', '0');
});

test('shows the cross-department empty state when only the home program is authorized', async () => {
  fetchFacultyCurriculums.mockResolvedValue({
    homeProgram: { id: 1, code: 'BSIT', name: 'Information Technology' },
    homeCurricula: [{ curriculumId: 1, programCode: 'BSIT', curriculumName: 'BSIT 2026' }],
    crossDepartmentCurricula: [],
    data: [{ curriculumId: 1, programCode: 'BSIT', curriculumName: 'BSIT 2026' }],
  });
  render(<FacultyCurriculumPanel />);
  await screen.findByText('BSIT:BSIT 2026');
  fireEvent.click(screen.getByRole('tab', { name: 'Cross-Department Curricula' }));
  expect(await screen.findByText('No active cross-department curriculum assignments.')).toBeInTheDocument();
});

test('surfaces an unauthorized API response without crashing or exposing curriculum data', async () => {
  fetchFacultyCurriculums.mockRejectedValue(new Error('Forbidden'));
  render(<FacultyCurriculumPanel />);
  expect(await screen.findByText('Forbidden')).toBeInTheDocument();
  expect(screen.queryByTestId('curriculum-viewer')).not.toBeInTheDocument();
  expect(screen.queryByText('No published curriculum matches your assigned programs.')).not.toBeInTheDocument();
});
