import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CouchDbBrowser, { databaseDisplayName, parseGrade } from './CouchDbBrowser';
import { fetchCouchDbDatabases, fetchCouchDbDocuments } from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchCouchDbDatabases: jest.fn(),
  fetchCouchDbDocuments: jest.fn(),
}));

const gradeRecord = {
  id: '22146ad0-bd15-414a-a78d-28d369fbb92e',
  document: {
    _id: '22146ad0-bd15-414a-a78d-28d369fbb92e',
    _rev: '3-revision',
    student_name: 'Adrian Mendoza Tan',
    student_no: '26-0035',
    program: 'Bachelor of Science in Information Technology',
    section: 'BSIT 1-1',
    subject_code: 'IT 101',
    subject_title: 'Introduction to Computing',
    professor_name: 'Faculty Testing One',
    semester: 'First Semester',
    school_year: '2026-2027',
    term: 'Midterm',
    grade: '{"midterm":90,"finals":"","finalAverage":"","standing":"active","flagged":false}',
    status: 'finalized',
    transaction_id: 'a34736ff2537efde9d38fe2b255fc0a868908d8f442864db4c25eea8a4f360c7',
    transaction_hash: 'hash-reference',
    version: 3,
    timestamp: '2026-09-16T03:20:00Z',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  fetchCouchDbDatabases.mockResolvedValue({ data: ['registrar-channel_registrar'] });
  fetchCouchDbDocuments.mockResolvedValue({
    data: [gradeRecord], page: 1, pageSize: 10, totalRows: 148, hasNextPage: true,
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: jest.fn().mockResolvedValue(undefined) },
  });
});

test('grade parser safely handles object, JSON string, and malformed values', () => {
  expect(parseGrade('{"midterm":90}')).toEqual({ midterm: 90 });
  expect(parseGrade({ finals: 91 })).toEqual({ finals: 91 });
  expect(parseGrade('not-json')).toBeNull();
});

test('database names retain their technical value and gain a readable label', () => {
  expect(databaseDisplayName('registrar-channel_registrar')).toBe('Registrar Channel — Registrar World State');
});

test('renders a readable, searchable, read-only Fabric world state record', async () => {
  render(<CouchDbBrowser />);

  const database = await screen.findByRole('combobox', { name: /couchdb database/i });
  fireEvent.change(database, { target: { value: 'registrar-channel_registrar' } });
  fireEvent.click(screen.getByRole('button', { name: /load records/i }));

  expect(await screen.findByText('Adrian Mendoza Tan')).toBeInTheDocument();
  expect(screen.getByText('IT 101 — Introduction to Computing')).toBeInTheDocument();
  expect(screen.getByText('Records: 148')).toBeInTheDocument();
  expect(screen.getByText('Showing 1–1 of 148')).toBeInTheDocument();
  expect(screen.getByText('90')).toBeInTheDocument();
  expect(screen.getByText('Not yet encoded')).toBeInTheDocument();
  expect(screen.getByText('Advanced Details')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Readable View' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByText(/\\"midterm\\"/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /edit|delete|create/i })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /copy transaction id/i }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(gradeRecord.document.transaction_id));

  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing student' } });
  expect(screen.getByText('No records match your search.')).toBeInTheDocument();
});

test('switches to original read-only JSON without another request and copies it', async () => {
  render(<CouchDbBrowser />);
  const database = await screen.findByRole('combobox', { name: /couchdb database/i });
  fireEvent.change(database, { target: { value: 'registrar-channel_registrar' } });
  fireEvent.click(screen.getByRole('button', { name: /load records/i }));
  expect(await screen.findByText('Adrian Mendoza Tan')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'JSON View' }));

  expect(screen.getByRole('button', { name: 'JSON View' })).toHaveAttribute('aria-pressed', 'true');
  expect(fetchCouchDbDocuments).toHaveBeenCalledTimes(1);
  const json = screen.getByLabelText('JSON document');
  expect(json).toHaveTextContent('"student_name": "Adrian Mendoza Tan"');
  expect(json.textContent).toContain('"grade": "{\\"midterm\\":90');
  expect(window.localStorage.getItem('blockgo-couchdb-view-mode')).toBe('json');

  fireEvent.click(screen.getByRole('button', { name: /copy json/i }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify(gradeRecord.document, null, 2)));
});

test('shows a safe fallback for malformed grade JSON and request failures', async () => {
  fetchCouchDbDocuments
    .mockResolvedValueOnce({ data: [{ ...gradeRecord, document: { ...gradeRecord.document, grade: '{broken' } }], pageSize: 10, totalRows: 11, hasNextPage: true })
    .mockRejectedValueOnce(new Error('internal host detail'));

  render(<CouchDbBrowser />);
  const database = await screen.findByRole('combobox', { name: /couchdb database/i });
  fireEvent.change(database, { target: { value: 'registrar-channel_registrar' } });
  fireEvent.click(screen.getByRole('button', { name: /load records/i }));
  expect(await screen.findByText('Grade information unavailable')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The selected state database is temporarily unavailable.');
  expect(screen.queryByText('internal host detail')).not.toBeInTheDocument();
});
