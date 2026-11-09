import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FacultyCurriculumPanel, { filterFacultyCurricula } from './FacultyCurriculumPanel';
import { fetchFacultyCurriculums } from '../../services/api';

jest.mock('../../services/api', () => ({ fetchFacultyCurriculums: jest.fn() }));
jest.mock('../shared/CurriculumViewer', () => ({ curricula, loading, emptyMessage }) => (
  <div data-testid="curriculum-viewer" data-loading={String(loading)} data-count={curricula.length}>
    {curricula.map((curriculum) => (
      <div key={curriculum.curriculumId}>
        <span>{curriculum.programCode}:{curriculum.curriculumName}</span>
        {(curriculum.subjects || []).map((subject) => (
          <span key={subject.subjectId}>{subject.subjectCode} — {subject.subjectTitle}</span>
        ))}
      </div>
    ))}
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
  fireEvent.click(screen.getByRole('tab', { name: /Home Department Curriculum/ }));
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
  expect(await screen.findByText('No assigned curriculum subjects are available.')).toBeInTheDocument();
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

const searchableResponse = () => ({
  homeProgram: { id: 1, code: 'BSIT', name: 'Information Technology' },
  homeCurricula: [{
    curriculumId: 1,
    programCode: 'BSIT',
    programName: 'Information Technology',
    curriculumName: 'BSIT 2026',
    subjects: [
      { subjectId: 1, subjectCode: 'IT 102', subjectTitle: 'Computer Programming 1', yearLevel: 1, semester: 'FIRST' },
      { subjectId: 2, subjectCode: 'IT 104', subjectTitle: 'Computer Programming 2', yearLevel: 1, semester: 'SECOND' },
      { subjectId: 3, subjectCode: 'IT 201', subjectTitle: 'Data Structures and Algorithms', yearLevel: 2, semester: 'FIRST' },
    ],
  }],
  crossDepartmentCurricula: [{
    curriculumId: 2,
    programCode: 'BSCS',
    programName: 'Computer Science',
    curriculumName: 'BSCS 2026',
    subjects: [
      { subjectId: 4, subjectCode: 'CS 201', subjectTitle: 'Data Structures', yearLevel: 2, semester: 'FIRST', isCrossDepartmentAssigned: true },
      { subjectId: 5, subjectCode: 'CS 205', subjectTitle: 'Advanced Programming', yearLevel: 2, semester: 'SECOND', isCrossDepartmentAssigned: true },
    ],
  }],
});

test.each([
  ['exact subject code', 'IT 102', ['IT 102 — Computer Programming 1']],
  ['partial subject code', 'IT 10', ['IT 102 — Computer Programming 1', 'IT 104 — Computer Programming 2']],
  ['subject name', 'Programming', ['CS 205 — Advanced Programming', 'IT 102 — Computer Programming 1', 'IT 104 — Computer Programming 2']],
  ['case-insensitive input', 'data', ['CS 201 — Data Structures', 'IT 201 — Data Structures and Algorithms']],
])('filters assigned curricula by %s while typing', async (_label, query, expected) => {
  fetchFacultyCurriculums.mockResolvedValue(searchableResponse());
  render(<FacultyCurriculumPanel />);
  await screen.findByText('CS 201 — Data Structures');

  fireEvent.change(screen.getByPlaceholderText('Search subject code or subject name...'), { target: { value: query } });

  expected.forEach((text) => expect(screen.getByText(text)).toBeInTheDocument());
  expect(screen.getAllByText(/ — /)).toHaveLength(expected.length);
});

test('empty search restores every assigned subject', async () => {
  fetchFacultyCurriculums.mockResolvedValue(searchableResponse());
  render(<FacultyCurriculumPanel />);
  const search = screen.getByPlaceholderText('Search subject code or subject name...');
  await screen.findByText('CS 201 — Data Structures');
  fireEvent.change(search, { target: { value: 'IT 102' } });
  expect(screen.getAllByText(/ — /)).toHaveLength(1);
  fireEvent.change(search, { target: { value: '   ' } });
  expect(screen.getAllByText(/ — /)).toHaveLength(5);
});

test('keeps the search visible and displays a no-match state', async () => {
  fetchFacultyCurriculums.mockResolvedValue(searchableResponse());
  render(<FacultyCurriculumPanel />);
  const search = screen.getByPlaceholderText('Search subject code or subject name...');
  await screen.findByText('CS 201 — Data Structures');
  fireEvent.change(search, { target: { value: 'no such subject' } });
  expect(screen.getByText('No subjects found.')).toBeInTheDocument();
  expect(search).toBeInTheDocument();
});

test('preserves cross-subject priority before regular matches after filtering', async () => {
  fetchFacultyCurriculums.mockResolvedValue(searchableResponse());
  render(<FacultyCurriculumPanel />);
  await screen.findByText('CS 201 — Data Structures');
  fireEvent.change(screen.getByPlaceholderText('Search subject code or subject name...'), { target: { value: 'Data' } });

  const results = screen.getAllByText(/Data Structures/);
  expect(results[0]).toHaveTextContent('CS 201');
  expect(results[1]).toHaveTextContent('IT 201');
  expect(screen.getByText('Cross-Department Assigned Subjects')).toBeInTheDocument();
  expect(screen.getByText('Regular Curriculum')).toBeInTheDocument();
});

test('filtering does not mutate the original curriculum dataset', () => {
  const original = searchableResponse().homeCurricula;
  const snapshot = JSON.parse(JSON.stringify(original));
  const filtered = filterFacultyCurricula(original, 'IT 102');

  expect(filtered[0].subjects).toHaveLength(1);
  expect(original).toEqual(snapshot);
  expect(filtered).not.toBe(original);
  expect(filtered[0]).not.toBe(original[0]);
});
