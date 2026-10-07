import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
  fetchFacultyCurriculums.mockResolvedValue({ data: [{ curriculumId: 1, programCode: 'BSIT', curriculumName: 'BSIT 2026' }] });
  render(<FacultyCurriculumPanel />);
  expect(await screen.findByText('BSIT:BSIT 2026')).toBeInTheDocument();
  expect(fetchFacultyCurriculums).toHaveBeenCalledTimes(1);
  expect(fetchFacultyCurriculums).toHaveBeenCalledWith();
  expect(screen.queryByLabelText(/program/i)).not.toBeInTheDocument();
});

test('supports multiple matching assigned programs returned by the authorized endpoint', async () => {
  fetchFacultyCurriculums.mockResolvedValue({ data: [
    { curriculumId: 1, programCode: 'BSIT', curriculumName: 'BSIT 2026' },
    { curriculumId: 2, programCode: 'BSCS', curriculumName: 'BSCS 2026' },
  ] });
  render(<FacultyCurriculumPanel />);
  await waitFor(() => expect(screen.getByTestId('curriculum-viewer')).toHaveAttribute('data-count', '2'));
});

test.each([
  ['empty array', { data: [] }],
  ['null data', { data: null }],
  ['empty response', null],
])('shows a clean empty state for %s', async (_label, response) => {
  fetchFacultyCurriculums.mockResolvedValue(response);
  render(<FacultyCurriculumPanel />);
  expect(await screen.findByText('No published curriculum matches your assigned programs.')).toBeInTheDocument();
  expect(screen.getByTestId('curriculum-viewer')).toHaveAttribute('data-count', '0');
});

test('surfaces an unauthorized API response without crashing or exposing curriculum data', async () => {
  fetchFacultyCurriculums.mockRejectedValue(new Error('Forbidden'));
  render(<FacultyCurriculumPanel />);
  expect(await screen.findByText('Forbidden')).toBeInTheDocument();
  expect(screen.queryByTestId('curriculum-viewer')).not.toBeInTheDocument();
  expect(screen.queryByText('No published curriculum matches your assigned programs.')).not.toBeInTheDocument();
});
