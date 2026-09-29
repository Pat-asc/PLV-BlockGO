import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CurriculumBuilder from './CurriculumBuilder';
import {
  addCurriculumSubject,
  createCurriculum,
  fetchAcademicPrograms,
  fetchCurriculums,
  submitCurriculum,
} from '../../services/api';
import { requestSystemConfirmation } from '../../services/SystemDialogContext';

jest.mock('../../services/SystemDialogContext', () => ({
  requestSystemConfirmation: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../services/api', () => ({
  addCurriculumSubject: jest.fn(),
  createCurriculum: jest.fn(),
  fetchAcademicPrograms: jest.fn(),
  fetchCurriculums: jest.fn(),
  removeCurriculumSubject: jest.fn(),
  submitCurriculum: jest.fn(),
  updateCurriculum: jest.fn(),
  updateCurriculumSubject: jest.fn(),
}));

const curriculum = {
  curriculumId: 12,
  programCode: 'BSIT',
  curriculumCode: 'BSIT-2026',
  curriculumName: 'BSIT Curriculum 2026',
  curriculumVersion: '1.0',
  schoolYear: '2026-2027',
  status: 'DRAFT',
  subjects: [],
};

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  requestSystemConfirmation.mockResolvedValue(true);
  fetchAcademicPrograms.mockResolvedValue({
    data: [{ programId: 1, programCode: 'BSIT', programName: 'Bachelor of Science in Information Technology' }],
  });
  fetchCurriculums.mockResolvedValue({ data: [curriculum] });
  addCurriculumSubject.mockResolvedValue({ status: 'Success' });
});

const openBulkUpload = async () => {
  render(<CurriculumBuilder department="Bachelor of Science in Information Technology" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Bulk Upload' }));
  const dropZone = screen.getByRole('button', { name: /Drag and drop your CSV file here/i });
  await waitFor(() => expect(dropZone).toBeEnabled());
  return dropZone;
};

const csvFile = () => {
  const contents = 'Year Level,Semester,Course Code,Course Title,Units,Prerequisite(s)\n1,FIRST,IT 101,Introduction to Computing,3,\n';
  const file = new File([contents], 'curriculum.csv', { type: 'text/csv' });
  file.text = jest.fn().mockResolvedValue(contents);
  return file;
};

const namedCsvFile = (name, code) => {
  const contents = `Year Level,Semester,Course Code,Course Title,Units,Prerequisite(s)\n1,FIRST,${code},${code} Title,3,\n`;
  const file = new File([contents], name, { type: 'text/csv' });
  file.text = jest.fn().mockResolvedValue(contents);
  return file;
};

const fillCurriculum = (program, code, version) => {
  const programSelect = screen.queryByRole('combobox', { name: 'Program for new curriculum' }) ||
    screen.getByText('Select program').closest('select');
  fireEvent.change(programSelect, { target: { value: program } });
  fireEvent.change(screen.getByPlaceholderText('Curriculum Code'), { target: { value: code } });
  fireEvent.change(screen.getByPlaceholderText('Curriculum Name'), { target: { value: code + ' Name' } });
  fireEvent.change(screen.getByPlaceholderText('Version'), { target: { value: version } });
  fireEvent.change(screen.getByPlaceholderText('School Year'), { target: { value: '2026-2027' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Curriculum' }));
};

test('creates separate same-program versions and accepts a second drop after submit without refresh', async () => {
  const stored = [];
  let nextId = 100;
  fetchCurriculums.mockImplementation(async () => ({ data: stored.map((item) => ({ ...item, subjects: [...item.subjects] })) }));
  createCurriculum.mockImplementation(async (form) => {
    if (stored.some((item) => item.curriculumCode === form.curriculumCode ||
      (item.programCode === form.programCode && item.curriculumVersion === form.curriculumVersion))) {
      throw new Error('That curriculum code or program version already exists.');
    }
    const item = { ...form, curriculumId: nextId++, status: 'DRAFT', subjects: [] };
    stored.unshift(item);
    return { data: item };
  });
  addCurriculumSubject.mockImplementation(async (id, subject) => {
    stored.find((item) => item.curriculumId === id).subjects.push({ ...subject, subjectId: id });
    return { status: 'Success' };
  });
  submitCurriculum.mockImplementation(async (id) => {
    stored.find((item) => item.curriculumId === id).status = 'PENDING_APPROVAL';
    return { status: 'Success' };
  });
  render(<CurriculumBuilder department="" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Bulk Upload' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create Curriculum' })).toBeEnabled());
  fillCurriculum('BSIT', 'BSIT-2026', '1.0');
  await waitFor(() => expect(screen.getByRole('button', { name: /Drag and drop your CSV file here/i })).toBeEnabled());
  fireEvent.drop(screen.getByRole('button', { name: /Drag and drop your CSV file here/i }), { dataTransfer: { files: [namedCsvFile('first.csv', 'IT 101')] } });
  await waitFor(() => expect(stored[0].subjects).toHaveLength(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit for Review' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Submit for Review' }));
  await waitFor(() => expect(submitCurriculum).toHaveBeenCalledWith(100));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create Curriculum' })).toBeEnabled());
  expect(screen.getByRole('button', { name: /Drag and drop your CSV file here/i })).toBeDisabled();
  expect(screen.queryByText('IT 101')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Curriculum CSV file')).toHaveValue('');
  fillCurriculum('BSIT', 'BSIT-2027', '2.0');
  await waitFor(() => expect(screen.getByRole('button', { name: /Drag and drop your CSV file here/i })).toBeEnabled());
  fireEvent.drop(screen.getByRole('button', { name: /Drag and drop your CSV file here/i }), { dataTransfer: { files: [namedCsvFile('second.csv', 'IT 201')] } });
  await waitFor(() => expect(stored[0].subjects).toHaveLength(1));
  expect(addCurriculumSubject).toHaveBeenLastCalledWith(101, expect.objectContaining({ subjectCode: 'IT 201' }));
  expect(stored.find((item) => item.curriculumId === 100)).toMatchObject({
    curriculumVersion: '1.0', status: 'PENDING_APPROVAL', subjects: [expect.objectContaining({ subjectCode: 'IT 101' })],
  });
  expect(stored.find((item) => item.curriculumId === 101)).toMatchObject({ curriculumVersion: '2.0', status: 'DRAFT' });
  fireEvent.click(screen.getByRole('button', { name: 'Create New Checklist' }));
  fillCurriculum('BSIT', 'BSIT-2027-DUP', '2.0');
  expect(await screen.findByText('That curriculum code or program version already exists.')).toBeInTheDocument();
  expect(stored).toHaveLength(2);
});

test('keeps curricula for different programs independent', async () => {
  fetchAcademicPrograms.mockResolvedValue({ data: [
    { programId: 1, programCode: 'BSIT', programName: 'Bachelor of Science in Information Technology' },
    { programId: 2, programCode: 'BSEE', programName: 'Bachelor of Science in Electrical Engineering' },
  ] });
  const stored = [];
  fetchCurriculums.mockImplementation(async () => ({ data: [...stored] }));
  createCurriculum.mockImplementation(async (form) => {
    const item = { ...form, curriculumId: stored.length + 1, status: 'DRAFT', subjects: [] };
    stored.push(item);
    return { data: item };
  });
  render(<CurriculumBuilder department="" />);
  await screen.findByRole('option', { name: /BSIT/ });
  fillCurriculum('BSIT', 'BSIT-2026', '1.0');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create New Checklist' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Create New Checklist' }));
  fillCurriculum('BSEE', 'BSEE-2026', '1.0');
  await waitFor(() => expect(stored).toHaveLength(2));
  expect(stored.map((item) => [item.programCode, item.curriculumId])).toEqual([['BSIT', 1], ['BSEE', 2]]);
});

test('opens the curriculum CSV chooser when the drop zone is clicked', async () => {
  const dropZone = await openBulkUpload();
  const fileInput = screen.getByLabelText('Curriculum CSV file');
  fileInput.click = jest.fn();

  fireEvent.click(dropZone);

  expect(fileInput.click).toHaveBeenCalledTimes(1);
});

test('imports a CSV dropped onto the upload area', async () => {
  const dropZone = await openBulkUpload();

  fireEvent.drop(dropZone, { dataTransfer: { files: [csvFile()] } });

  await waitFor(() => expect(addCurriculumSubject).toHaveBeenCalledWith(12, expect.objectContaining({
    yearLevel: 1,
    semester: 'FIRST',
    subjectCode: 'IT 101',
    subjectTitle: 'Introduction to Computing',
    units: 3,
  })));
  expect(await screen.findByText('1 subjects imported successfully.')).toBeInTheDocument();
});

test('resumes a partial CSV import without reposting existing subjects', async () => {
  fetchCurriculums.mockResolvedValue({
    data: [{
      ...curriculum,
      subjects: [{
        subjectId: 44,
        yearLevel: 1,
        semester: 'FIRST',
        subjectCode: 'IT 101',
        subjectTitle: 'Introduction to Computing',
        units: 3,
      }],
    }],
  });
  const contents = [
    'Year Level,Semester,Course Code,Course Title,Units,Prerequisite(s)',
    '1,FIRST,IT 101,Introduction to Computing,3,',
    '2,FIRST,IT 201,Data Structures,3,IT 101',
  ].join('\n');
  const file = new File([contents], 'curriculum.csv', { type: 'text/csv' });
  file.text = jest.fn().mockResolvedValue(contents);
  const dropZone = await openBulkUpload();

  fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

  await waitFor(() => expect(addCurriculumSubject).toHaveBeenCalledTimes(1));
  expect(addCurriculumSubject).toHaveBeenCalledWith(12, expect.objectContaining({
    subjectCode: 'IT 201',
    prerequisite: 'IT 101',
  }));
  expect(await screen.findByText('1 subjects imported successfully. 1 subject already existed and was skipped.')).toBeInTheDocument();
});
