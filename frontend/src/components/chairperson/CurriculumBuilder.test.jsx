import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CurriculumBuilder from './CurriculumBuilder';
import {
  addCurriculumSubject,
  fetchAcademicPrograms,
  fetchCurriculums,
} from '../../services/api';

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
