import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CurriculumBuilder from './CurriculumBuilder';
import {
  addCurriculumSubject,
  bulkImportCurriculumSubjects,
  createCurriculum,
  fetchAcademicPrograms,
  fetchAssignedCurriculum,
  fetchCurriculums,
  submitCurriculum,
  removeCurriculumSubjects,
  updateCurriculumSubject,
} from '../../services/api';
import { requestSystemConfirmation } from '../../services/SystemDialogContext';

jest.mock('../../services/SystemDialogContext', () => ({
  requestSystemConfirmation: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../services/api', () => ({
  addCurriculumSubject: jest.fn(),
  bulkImportCurriculumSubjects: jest.fn(),
  createCurriculum: jest.fn(),
  fetchAcademicPrograms: jest.fn(),
  fetchAssignedCurriculum: jest.fn(),
  fetchCurriculums: jest.fn(),
  removeCurriculumSubject: jest.fn(),
  removeCurriculumSubjects: jest.fn(),
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
const emptyUploadedSubject = { yearLevel: 1, semester: 'FIRST', units: 3, lectureHours: 3, laboratoryHours: 0, prerequisite: '' };
const yearsForTest = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' };

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  requestSystemConfirmation.mockResolvedValue(true);
  fetchAcademicPrograms.mockResolvedValue({
    data: [{ programId: 1, programCode: 'BSIT', programName: 'Bachelor of Science in Information Technology' }],
  });
  fetchCurriculums.mockResolvedValue({ data: [curriculum] });
  fetchAssignedCurriculum.mockResolvedValue({ data: null });
  addCurriculumSubject.mockResolvedValue({ status: 'Success' });
  bulkImportCurriculumSubjects.mockResolvedValue({ status: 'Success', importedCount: 1, skippedCount: 0 });
  removeCurriculumSubjects.mockResolvedValue({ status: 'Success' });
  updateCurriculumSubject.mockResolvedValue({ status: 'Success' });
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

const fillCurriculum = (code, version) => {
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
  bulkImportCurriculumSubjects.mockImplementation(async (id, file) => {
    const code = file.name === 'first.csv' ? 'IT 101' : 'IT 201';
    stored.find((item) => item.curriculumId === id).subjects.push({ ...emptyUploadedSubject, subjectCode: code, subjectTitle: `${code} Title`, subjectId: id });
    return { status: 'Success', importedCount: 1, skippedCount: 0 };
  });
  submitCurriculum.mockImplementation(async (id) => {
    stored.find((item) => item.curriculumId === id).status = 'PENDING_APPROVAL';
    return { status: 'Success' };
  });
  render(<CurriculumBuilder department="" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Bulk Upload' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create Curriculum' })).toBeEnabled());
  fillCurriculum('BSIT-2026', '1.0');
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
  fillCurriculum('BSIT-2027', '2.0');
  await waitFor(() => expect(screen.getByRole('button', { name: /Drag and drop your CSV file here/i })).toBeEnabled());
  fireEvent.drop(screen.getByRole('button', { name: /Drag and drop your CSV file here/i }), { dataTransfer: { files: [namedCsvFile('second.csv', 'IT 201')] } });
  await waitFor(() => expect(stored[0].subjects).toHaveLength(1));
  expect(bulkImportCurriculumSubjects).toHaveBeenLastCalledWith(101, expect.objectContaining({ name: 'second.csv' }));
  expect(stored.find((item) => item.curriculumId === 100)).toMatchObject({
    curriculumVersion: '1.0', status: 'PENDING_APPROVAL', subjects: [expect.objectContaining({ subjectCode: 'IT 101' })],
  });
  expect(stored.find((item) => item.curriculumId === 101)).toMatchObject({ curriculumVersion: '2.0', status: 'DRAFT' });
  fireEvent.click(screen.getByRole('button', { name: 'Create New Checklist' }));
  fillCurriculum('BSIT-2027-DUP', '2.0');
  expect(await screen.findByText('That curriculum code or program version already exists.')).toBeInTheDocument();
  expect(stored).toHaveLength(2);
});

test('automatically creates curricula under the department-owned non-IT program', async () => {
  fetchAcademicPrograms.mockResolvedValue({ data: [
    { programId: 2, programCode: 'BSEE', programName: 'Bachelor of Science in Electrical Engineering' },
  ] });
  const stored = [];
  fetchCurriculums.mockImplementation(async () => ({ data: [...stored] }));
  createCurriculum.mockImplementation(async (form) => {
    const item = { ...form, curriculumId: stored.length + 1, status: 'DRAFT', subjects: [] };
    stored.push(item);
    return { data: item };
  });
  render(<CurriculumBuilder department="Bachelor of Science in Electrical Engineering" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create Curriculum' })).toBeEnabled());
  fillCurriculum('BSEE-2026', '1.0');
  await waitFor(() => expect(stored).toHaveLength(1));
  expect(stored[0]).toMatchObject({ programCode: 'BSEE', curriculumId: 1 });
  expect(screen.queryByRole('combobox', { name: 'Program for new curriculum' })).not.toBeInTheDocument();
});

test('automatically shows the assigned published version without a version dropdown', async () => {
  const historical = { ...curriculum, curriculumId: 10, curriculumVersion: 'v2025.1', status: 'ARCHIVED' };
  const draft = { ...curriculum, curriculumId: 13, curriculumVersion: 'v2027.1', status: 'DRAFT' };
  const published = { ...curriculum, curriculumId: 12, curriculumVersion: 'v2026.2', status: 'PUBLISHED', curriculumName: 'BSIT Curriculum 2026' };
  fetchCurriculums.mockResolvedValue({ data: [draft, historical, published] });
  fetchAssignedCurriculum.mockResolvedValue({ data: { curriculum: published, batchYear: 2026 } });

  render(<CurriculumBuilder department="Bachelor of Science in Information Technology" />);

  expect(await screen.findByText('Latest Approved')).toBeInTheDocument();
  expect(screen.getAllByText('v2026.2').length).toBeGreaterThan(0);
  expect(screen.queryByRole('combobox', { name: /curriculum version/i })).not.toBeInTheDocument();
  expect(fetchCurriculums).toHaveBeenCalledTimes(1);
  expect(fetchAssignedCurriculum).toHaveBeenCalledWith('BSIT');
});

test('IT Department automatically uses BSIT and does not display a program selector', async () => {
  fetchCurriculums.mockResolvedValue({ data: [] });

  render(<CurriculumBuilder department="IT Department" />);

  expect(await screen.findByRole('button', { name: 'Create Curriculum' })).toBeInTheDocument();
  expect(fetchAssignedCurriculum).toHaveBeenCalledWith('BSIT');
  expect(screen.queryByRole('combobox', { name: 'Program for new curriculum' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Select program/i)).not.toBeInTheDocument();
});

test('IT Department curriculum creation keeps BSIT after the selector is removed', async () => {
  fetchCurriculums.mockResolvedValue({ data: [] });
  createCurriculum.mockResolvedValue({ data: { ...curriculum, curriculumId: 44 } });
  render(<CurriculumBuilder department="Bachelor of Science in Information Technology" />);

  await screen.findByRole('button', { name: 'Create Curriculum' });
  fireEvent.change(screen.getByPlaceholderText('Curriculum Code'), { target: { value: 'BSIT-2028' } });
  fireEvent.change(screen.getByPlaceholderText('Curriculum Name'), { target: { value: 'BSIT Curriculum 2028' } });
  fireEvent.change(screen.getByPlaceholderText('Version'), { target: { value: '3.0' } });
  fireEvent.change(screen.getByPlaceholderText('School Year'), { target: { value: '2028-2029' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Curriculum' }));

  await waitFor(() => expect(createCurriculum).toHaveBeenCalledWith(expect.objectContaining({
    programCode: 'BSIT',
    curriculumCode: 'BSIT-2028',
  })));
});

test('non-IT departments automatically use their owned program without a selector', async () => {
  fetchAcademicPrograms.mockResolvedValue({ data: [
    { programId: 2, programCode: 'BSEE', programName: 'Bachelor of Science in Electrical Engineering' },
  ] });
  fetchCurriculums.mockResolvedValue({ data: [] });

  render(<CurriculumBuilder department="Bachelor of Science in Electrical Engineering" />);

  expect(await screen.findByRole('button', { name: 'Create Curriculum' })).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Program for new curriculum' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Select program/i)).not.toBeInTheDocument();
  expect(fetchAssignedCurriculum).toHaveBeenCalledWith('BSEE');
});

test('shows a clear state when no approved curriculum is assigned', async () => {
  fetchCurriculums.mockResolvedValue({ data: [{ ...curriculum, status: 'DRAFT' }] });
  fetchAssignedCurriculum.mockResolvedValue({ data: null });

  render(<CurriculumBuilder department="Bachelor of Science in Information Technology" />);

  expect(await screen.findByText('No approved curriculum is assigned to this program.')).toBeInTheDocument();
  expect(screen.queryByText('Latest Approved')).not.toBeInTheDocument();
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

  await waitFor(() => expect(bulkImportCurriculumSubjects).toHaveBeenCalledWith(12, expect.objectContaining({ name: 'curriculum.csv' })));
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
  bulkImportCurriculumSubjects.mockResolvedValue({ status: 'Success', importedCount: 1, skippedCount: 1 });
  const dropZone = await openBulkUpload();

  fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

  await waitFor(() => expect(bulkImportCurriculumSubjects).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('1 subjects imported successfully. 1 subject already existed and was skipped.')).toBeInTheDocument();
});

test('persists and reloads all four year levels through one transactional import request', async () => {
  const stored = { ...curriculum, subjects: [] };
  const imported = [1, 2, 3, 4].map((yearLevel) => ({
    subjectId: 100 + yearLevel,
    yearLevel,
    semester: yearLevel % 2 ? 'FIRST' : 'SECOND',
    subjectCode: `IT ${yearLevel}01`,
    subjectTitle: `Year ${yearLevel} Subject`,
    units: yearLevel === 1 ? 2 : 3,
    prerequisite: yearLevel === 1 ? '' : `IT ${yearLevel - 1}01`,
  }));
  fetchCurriculums.mockImplementation(async () => ({ data: [{ ...stored, subjects: [...stored.subjects] }] }));
  bulkImportCurriculumSubjects.mockImplementation(async () => {
    stored.subjects = imported;
    return { status: 'Success', importedCount: 4, skippedCount: 0 };
  });
  const dropZone = await openBulkUpload();
  const file = new File(['multi-year'], 'multi-year.csv', { type: 'text/csv' });

  fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

  await waitFor(() => expect(bulkImportCurriculumSubjects).toHaveBeenCalledTimes(1));
  for (const subject of imported) {
    const row = (await screen.findByRole('checkbox', { name: `Select ${subject.subjectCode}` })).closest('tr');
    expect(row).toHaveTextContent(yearsForTest[subject.yearLevel]);
    expect(row).toHaveTextContent(subject.semester === 'FIRST' ? '1st Semester' : '2nd Semester');
    expect(row).toHaveTextContent(String(subject.units));
    if (subject.prerequisite) expect(row).toHaveTextContent(subject.prerequisite);
  }
});

const curriculumWithSubjects = () => ({
  ...curriculum,
  subjects: [
    { subjectId: 11, yearLevel: 1, semester: 'FIRST', subjectCode: 'IT 101', subjectTitle: 'Introduction', units: 2, prerequisite: '' },
    { subjectId: 12, yearLevel: 1, semester: 'SECOND', subjectCode: 'IT 102', subjectTitle: 'Programming', units: 3, prerequisite: 'IT 101' },
    { subjectId: 21, yearLevel: 2, semester: 'FIRST', subjectCode: 'IT 201', subjectTitle: 'Data Structures', units: 3, prerequisite: 'IT 102' },
  ],
});

test('selects multiple subjects, confirms once, and bulk deletes only authoritative IDs', async () => {
  fetchCurriculums.mockResolvedValue({ data: [curriculumWithSubjects()] });
  render(<CurriculumBuilder department="Bachelor of Science in Information Technology" />);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select IT 101' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select IT 201' }));
  expect(screen.getByRole('button', { name: 'Delete Selected (2)' })).toBeInTheDocument();

  requestSystemConfirmation.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: 'Delete Selected (2)' }));
  await waitFor(() => expect(requestSystemConfirmation).toHaveBeenCalled());
  expect(removeCurriculumSubjects).not.toHaveBeenCalled();

  requestSystemConfirmation.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: 'Delete Selected (2)' }));
  await waitFor(() => expect(removeCurriculumSubjects).toHaveBeenCalledWith(12, [11, 21]));
  expect(screen.getByRole('checkbox', { name: 'Select IT 102' })).toBeInTheDocument();
});

test('Select All affects only the current year and semester filter scope', async () => {
  fetchCurriculums.mockResolvedValue({ data: [curriculumWithSubjects()] });
  render(<CurriculumBuilder department="Bachelor of Science in Information Technology" />);
  await screen.findByRole('checkbox', { name: 'Select IT 101' });
  fireEvent.change(screen.getByLabelText('Filter by year level'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Filter by semester'), { target: { value: 'FIRST' } });
  fireEvent.click(screen.getByRole('button', { name: 'Select All' }));
  expect(screen.getByRole('checkbox', { name: 'Select IT 101' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Delete Selected (1)' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Select IT 102' })).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Select IT 201' })).not.toBeInTheDocument();
});

test('moves the single inline editor directly below the selected row and cancels without saving', async () => {
  fetchCurriculums.mockResolvedValue({ data: [curriculumWithSubjects()] });
  render(<CurriculumBuilder department="Bachelor of Science in Information Technology" />);
  const firstRow = (await screen.findByRole('checkbox', { name: 'Select IT 101' })).closest('tr');
  fireEvent.click(within(firstRow).getByRole('button', { name: 'Edit' }));
  const firstEditor = screen.getByRole('form', { name: 'Edit Subject IT 101' });
  expect(firstEditor.closest('tr').previousElementSibling).toBe(firstRow);
  expect(screen.queryByRole('form', { name: 'Add Subject' })).not.toBeInTheDocument();

  const secondRow = screen.getByRole('checkbox', { name: 'Select IT 201' }).closest('tr');
  fireEvent.click(within(secondRow).getByRole('button', { name: 'Edit' }));
  expect(screen.queryByRole('form', { name: 'Edit Subject IT 101' })).not.toBeInTheDocument();
  expect(screen.getByRole('form', { name: 'Edit Subject IT 201' }).closest('tr').previousElementSibling).toBe(secondRow);
  fireEvent.click(within(screen.getByRole('form', { name: 'Edit Subject IT 201' })).getByRole('button', { name: 'Cancel' }));
  expect(updateCurriculumSubject).not.toHaveBeenCalled();
  expect(screen.queryByRole('form', { name: /Edit Subject/ })).not.toBeInTheDocument();
});

test('keeps inline validation errors and active filters beside the edited subject', async () => {
  fetchCurriculums.mockResolvedValue({ data: [curriculumWithSubjects()] });
  updateCurriculumSubject.mockRejectedValue(new Error('Subject validation failed.'));
  render(<CurriculumBuilder department="Bachelor of Science in Information Technology" />);
  await screen.findByRole('checkbox', { name: 'Select IT 201' });
  fireEvent.change(screen.getByLabelText('Filter by year level'), { target: { value: '2' } });
  const row = screen.getByRole('checkbox', { name: 'Select IT 201' }).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
  const editor = screen.getByRole('form', { name: 'Edit Subject IT 201' });
  fireEvent.click(within(editor).getByRole('button', { name: 'Save Changes' }));
  expect(await within(editor).findByRole('alert')).toHaveTextContent('Subject validation failed.');
  expect(screen.getByLabelText('Filter by year level')).toHaveValue('2');
  expect(screen.getByRole('form', { name: 'Edit Subject IT 201' })).toBeInTheDocument();
});
