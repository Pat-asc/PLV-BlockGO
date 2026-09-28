export const MAX_CSV_FILE_BYTES = 10 * 1024 * 1024;

const allowedTypes = new Set([
  '',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

export const validateCsvUploadMetadata = (file) => {
  if (!file || file.size === 0) return 'A non-empty CSV file is required.';
  if (!String(file.name || '').toLowerCase().endsWith('.csv')) return 'Only CSV files are allowed.';
  if (file.size >= MAX_CSV_FILE_BYTES) return 'The selected CSV file must be less than 10 MB.';
  if (!allowedTypes.has(String(file.type || '').toLowerCase().split(';')[0])) return 'Only CSV files are allowed.';
  return '';
};

const hasNonCsvSignature = (bytes) => (
  (bytes[0] === 0x4d && bytes[1] === 0x5a) ||
  (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) ||
  (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) ||
  (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)
);

const readBlobBytes = async (blob) => {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The selected file could not be read.'));
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.readAsArrayBuffer(blob);
  });
};

const readBlobText = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('The selected file could not be read.'));
  reader.onload = () => resolve(String(reader.result || ''));
  reader.readAsText(blob, 'utf-8');
});

export const validateCsvUpload = async (file) => {
  const metadataError = validateCsvUploadMetadata(file);
  if (metadataError) return metadataError;

  const bytes = await readBlobBytes(file.slice(0, 16 * 1024));
  if (hasNonCsvSignature(bytes) || bytes.some((value) => value === 0 || value < 0x09 || (value > 0x0d && value < 0x20))) {
    return 'The selected file does not contain valid CSV text.';
  }

  let text;
  try {
    text = typeof TextDecoder === 'function'
      ? new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      : await readBlobText(file.slice(0, 16 * 1024));
  } catch {
    return 'The selected file does not contain valid UTF-8 CSV text.';
  }
  const header = text.split(/\r?\n|\r/).find((line) => line.trim());
  return header?.includes(',') ? '' : 'The selected file does not contain a valid CSV header row.';
};

export const assertValidCsvUpload = async (file) => {
  const message = await validateCsvUpload(file);
  if (message) throw new Error(message);
};

const allowedWorkbookTypes = new Set([
  '',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

export const validateGradeUpload = async (file) => {
  const extension = String(file?.name || '').toLowerCase().split('.').pop();
  if (extension === 'csv') return validateCsvUpload(file);
  if (!file || file.size === 0) return 'A non-empty CSV or XLSX grade file is required.';
  if (extension !== 'xlsx') return 'Unsupported file format. Please upload an XLSX or CSV grading template.';
  if (file.size >= MAX_CSV_FILE_BYTES) return 'The selected grade file must be less than 10 MB.';

  const contentType = String(file.type || '').toLowerCase().split(';')[0];
  if (!allowedWorkbookTypes.has(contentType)) return 'Unsupported file format. Please upload an XLSX or CSV grading template.';

  const bytes = await readBlobBytes(file.slice(0, 4));
  return bytes.length === 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    bytes[2] === 0x03 && bytes[3] === 0x04
    ? ''
    : 'The selected file does not contain a valid XLSX workbook.';
};

export const assertValidGradeUpload = async (file) => {
  const message = await validateGradeUpload(file);
  if (message) throw new Error(message);
};
