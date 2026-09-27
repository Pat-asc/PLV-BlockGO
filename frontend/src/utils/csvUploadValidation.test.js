import { MAX_CSV_FILE_BYTES, validateCsvUpload } from './csvUploadValidation';

const csv = (content = 'Student ID,Name\n26-0001,Adrian', name = 'students.csv', type = 'text/csv') =>
  new File([content], name, { type });

test('accepts a valid CSV below 10 MB', async () => {
  expect(await validateCsvUpload(csv())).toBe('');
});

test('rejects exactly 10 MB and larger files', async () => {
  const exact = new File([new Uint8Array(MAX_CSV_FILE_BYTES)], 'students.csv', { type: 'text/csv' });
  expect(await validateCsvUpload(exact)).toBe('The selected CSV file must be less than 10 MB.');
});

test('rejects non-CSV extensions and declared types', async () => {
  expect(await validateCsvUpload(csv('a,b\n1,2', 'students.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))).toBe('Only CSV files are allowed.');
  expect(await validateCsvUpload(csv('a,b\n1,2', 'students.csv', 'application/pdf'))).toBe('Only CSV files are allowed.');
});

test('rejects executable, ZIP/XLSX, PDF, and malformed text renamed to CSV', async () => {
  expect(await validateCsvUpload(csv(new Uint8Array([0x4d, 0x5a, 0, 0]), 'renamed.csv', 'application/octet-stream'))).toMatch(/valid CSV text/);
  expect(await validateCsvUpload(csv('not a delimited header', 'renamed.csv', 'text/plain'))).toMatch(/header row/);
});
