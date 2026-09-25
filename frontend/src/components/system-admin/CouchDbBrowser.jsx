import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchCouchDbDatabases, fetchCouchDbDocuments } from '../../services/api';

const targets = [
  { id: 'registrar', label: 'Registrar State' },
  { id: 'faculty', label: 'Faculty State' },
  { id: 'department', label: 'Department State' },
];

const preferredDatabaseLabels = {
  'registrar-channel_registrar': 'Registrar Channel — Registrar World State',
  'registrar-channel_faculty': 'Registrar Channel — Faculty World State',
  'registrar-channel_department': 'Registrar Channel — Department World State',
};

const viewModeStorageKey = 'blockgo-couchdb-view-mode';

const initialViewMode = () => {
  try {
    return window.localStorage.getItem(viewModeStorageKey) === 'json' ? 'json' : 'readable';
  } catch {
    return 'readable';
  }
};

const humanize = (value) => String(value || '')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

export const databaseDisplayName = (name) => preferredDatabaseLabels[name]
  || `${humanize(String(name).split('_')[0])} — ${humanize(String(name).split('_').slice(1).join(' ') || 'Application')} World State`;

const field = (record, ...names) => {
  const entries = Object.entries(record || {});
  for (const name of names) {
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (match && match[1] !== null && match[1] !== undefined && String(match[1]).trim() !== '') return match[1];
  }
  return '';
};

export const parseGrade = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return null;
  }
};

const displayValue = (value, fallback = 'Not available') => (
  value === null || value === undefined || String(value).trim() === '' ? fallback : String(value)
);

const gradeValue = (value, fallback) => (
  value === null || value === undefined || String(value).trim() === '' ? fallback : String(value)
);

const formatDate = (value) => {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Manila',
  }).format(parsed);
};

const Detail = ({ label, children, mono = false }) => (
  <div>
    <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className={`mt-1 break-words text-sm font-semibold text-slate-900 ${mono ? 'font-mono' : ''}`}>{children}</dd>
  </div>
);

const CopyValue = ({ label, value, copied, onCopy }) => {
  if (!value) return null;
  return <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 break-all font-mono text-xs text-slate-800">{value}</p>
    <button type="button" onClick={() => onCopy(label, String(value))} className="mt-2 min-h-10 rounded-md border border-[#003366] px-3 text-xs font-bold text-[#003366] hover:bg-blue-50">
      {copied === label ? 'Copied' : `Copy ${label}`}
    </button>
  </div>;
};

const RecordCard = ({ item }) => {
  const [copied, setCopied] = useState('');
  const record = item.document || {};
  const grade = parseGrade(field(record, 'grade', 'grades'));
  const transactionId = field(record, 'transaction_id', 'transactionId', 'tx_id', 'txId');
  const transactionHash = field(record, 'transaction_hash', 'transactionHash', 'hash');
  const status = field(record, 'status', 'record_status') || 'Not available';
  const subjectCode = field(record, 'subject_code', 'subjectCode', 'course_code');
  const subjectTitle = field(record, 'subject_title', 'subjectTitle', 'subject');
  const subject = [subjectCode, subjectTitle].filter(Boolean).join(' — ') || 'Not available';
  const recordedAt = field(record, 'timestamp', 'date', 'recorded_at', 'created_at');

  const copy = async (label, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setCopied('');
    }
  };

  return <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <header className="border-b-4 border-yellow-400 bg-[#003366] px-5 py-4 text-white">
      <p className="text-xs font-bold uppercase tracking-widest text-blue-100">Fabric World State Record</p>
      <h3 className="mt-1 text-xl font-bold">{displayValue(field(record, 'student_name', 'studentName', 'name'), 'Student Grade Record')}</h3>
      <p className="mt-1 text-sm text-blue-100">Student No.: {displayValue(field(record, 'student_no', 'student_id', 'studentNo', 'studentId'))}</p>
    </header>

    <div className="space-y-6 p-5">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Program">{displayValue(field(record, 'program', 'course'))}</Detail>
        <Detail label="Section">{displayValue(field(record, 'section'))}</Detail>
        <Detail label="Subject">{subject}</Detail>
        <Detail label="Units">{displayValue(field(record, 'units'))}</Detail>
        <Detail label="Faculty">{displayValue(field(record, 'professor_name', 'faculty_name', 'facultyName'))}</Detail>
        <Detail label="Faculty ID">{displayValue(field(record, 'faculty_id', 'facultyId'))}</Detail>
        <Detail label="Semester">{displayValue(field(record, 'semester'))}</Detail>
        <Detail label="School Year">{displayValue(field(record, 'school_year', 'schoolYear'))}</Detail>
        <Detail label="Term">{displayValue(field(record, 'term', 'grading_period', 'gradingPeriod'))}</Detail>
      </dl>

      <section aria-label="Grade information" className="rounded-lg border border-blue-100 bg-blue-50 p-4">
        <h4 className="text-sm font-extrabold uppercase tracking-wide text-[#003366]">Grade</h4>
        {grade === null ? <p className="mt-3 text-sm text-slate-700">Grade information unavailable</p> : <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Detail label="Midterm">{gradeValue(field(grade, 'midterm'), 'Not yet encoded')}</Detail>
          <Detail label="Finals">{gradeValue(field(grade, 'finals', 'final'), 'Not yet encoded')}</Detail>
          <Detail label="Final Average">{gradeValue(field(grade, 'finalAverage', 'final_average'), 'Not yet available')}</Detail>
          <Detail label="Standing">{humanize(gradeValue(field(grade, 'standing'), 'Not available'))}</Detail>
          <Detail label="Flagged">{field(grade, 'flagged') === true || String(field(grade, 'flagged')).toLowerCase() === 'true' ? 'Yes' : 'No'}</Detail>
        </dl>}
      </section>

      <section aria-label="Record status">
        <h4 className="text-sm font-extrabold uppercase tracking-wide text-[#003366]">Status</h4>
        <span className="mt-2 inline-flex rounded-full bg-blue-100 px-3 py-1 text-sm font-bold text-[#003366]">{humanize(status)}</span>
      </section>

      <section aria-label="Blockchain verification" className="space-y-3">
        <div>
          <h4 className="text-sm font-extrabold uppercase tracking-wide text-[#003366]">Blockchain Verification</h4>
          <p className="mt-1 text-sm text-slate-600">These blockchain transaction references can be used to verify the corresponding transaction on the Hyperledger Fabric ledger.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <CopyValue label="Transaction ID" value={transactionId} copied={copied} onCopy={copy} />
          <CopyValue label="Transaction Hash" value={transactionHash} copied={copied} onCopy={copy} />
        </div>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Record Status">{humanize(status)}</Detail>
          <Detail label="Version">{displayValue(field(record, 'version', '_version'))}</Detail>
          <Detail label="Recorded">{formatDate(recordedAt)}</Detail>
        </dl>
      </section>

      <details className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <summary className="cursor-pointer text-sm font-bold text-[#003366]">Advanced Details</summary>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Detail label="CouchDB Document ID" mono>{displayValue(item.id || field(record, '_id'))}</Detail>
          <Detail label="CouchDB Revision" mono>{displayValue(field(record, '_rev'))}</Detail>
          <Detail label="World State Version" mono>{displayValue(field(record, '_version', 'version'))}</Detail>
          <Detail label="Raw Timestamp" mono>{displayValue(recordedAt)}</Detail>
          <Detail label="Submitted By">{displayValue(field(record, 'submitted_by', 'submittedBy'))}</Detail>
          <Detail label="University">{displayValue(field(record, 'university'))}</Detail>
        </dl>
      </details>
    </div>
  </article>;
};

const JsonRecordCard = ({ item }) => {
  const [copied, setCopied] = useState(false);
  const formattedDocument = JSON.stringify(item.document ?? null, null, 2);

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(formattedDocument);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return <article className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Fabric World State JSON</p>
        <h3 className="mt-1 break-all font-mono text-sm font-bold text-[#003366]">{item.id || 'CouchDB document'}</h3>
      </div>
      <button type="button" onClick={copyJson} className="min-h-10 shrink-0 rounded-md border border-[#003366] px-3 text-xs font-bold text-[#003366] hover:bg-blue-50">
        {copied ? 'JSON copied' : 'Copy JSON'}
      </button>
    </header>
    <div className="max-w-full overflow-x-auto bg-slate-950 p-4">
      <pre aria-label="JSON document" className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-100">{formattedDocument}</pre>
    </div>
  </article>;
};

function CouchDbBrowser() {
  const [target, setTarget] = useState('registrar');
  const [databases, setDatabases] = useState([]);
  const [database, setDatabase] = useState('');
  const [documents, setDocuments] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalRows, setTotalRows] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [viewMode, setViewMode] = useState(initialViewMode);

  const selectViewMode = (nextMode) => {
    setViewMode(nextMode);
    try {
      window.localStorage.setItem(viewModeStorageKey, nextMode);
    } catch {
      // Preference persistence is optional; the in-memory selection still works.
    }
  };

  const loadDatabases = useCallback((signal) => {
    setError('');
    return fetchCouchDbDatabases(target, { signal })
      .then((response) => setDatabases(Array.isArray(response?.data) ? response.data : []))
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError('The selected state target is temporarily unavailable.');
      });
  }, [target]);

  useEffect(() => {
    const controller = new AbortController();
    setDatabase(''); setDocuments([]); setPage(1); setTotalRows(0); setLoaded(false);
    setSearch(''); setStatusFilter(''); setSubjectFilter('');
    loadDatabases(controller.signal);
    return () => controller.abort();
  }, [loadDatabases]);

  const loadDocuments = useCallback(async (nextPage = page) => {
    if (!database) return;
    setError(''); setLoading(true);
    try {
      const response = await fetchCouchDbDocuments(target, database, nextPage);
      setDocuments(Array.isArray(response?.data) ? response.data : []);
      setHasNextPage(Boolean(response?.hasNextPage));
      setPageSize(Number(response?.pageSize) || 10);
      setTotalRows(Number(response?.totalRows) || 0);
      setPage(nextPage); setLoaded(true);
      setSearch(''); setStatusFilter(''); setSubjectFilter('');
    } catch {
      setError('The selected state database is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, [database, page, target]);

  const statusOptions = useMemo(() => [...new Set(documents.map(({ document }) => String(field(document, 'status', 'record_status') || '')).filter(Boolean))], [documents]);
  const subjectOptions = useMemo(() => [...new Set(documents.map(({ document }) => String(field(document, 'subject_code', 'subjectCode', 'subject_title', 'subject') || '')).filter(Boolean))], [documents]);
  const filteredDocuments = useMemo(() => documents.filter(({ id, document }) => {
    const status = String(field(document, 'status', 'record_status') || '');
    const subject = String(field(document, 'subject_code', 'subjectCode', 'subject_title', 'subject') || '');
    const searchable = [id, field(document, 'student_name', 'studentName'), field(document, 'student_id', 'student_no'), subject, field(document, 'transaction_id', 'transactionId'), field(document, 'transaction_hash', 'transactionHash')].join(' ').toLowerCase();
    return (!search || searchable.includes(search.toLowerCase()))
      && (!statusFilter || status === statusFilter)
      && (!subjectFilter || subject === subjectFilter);
  }), [documents, search, statusFilter, subjectFilter]);

  const firstRecord = totalRows ? ((page - 1) * pageSize) + 1 : 0;
  const lastRecord = Math.min(totalRows, (page - 1) * pageSize + documents.length);

  return <section className="space-y-5">
    <div className="border-b border-slate-300 pb-5">
      <p className="text-xs font-bold uppercase text-slate-500">Protected Data Inspection</p>
      <h2 className="mt-1 text-2xl font-bold text-[#003366]">Read-only Blockchain State Browser</h2>
      <p className="mt-2 text-sm text-slate-600">Browse sanitized Fabric world state records. Credentials, wallets, system databases, and sensitive fields are never returned.</p>
    </div>

    <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
      <label className="text-sm font-semibold">Campus state target
        <select aria-label="CouchDB target" value={target} onChange={(event) => setTarget(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3">{targets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      </label>
      <label className="text-sm font-semibold">Database
        <select aria-label="CouchDB database" value={database} onChange={(event) => { setDatabase(event.target.value); setDocuments([]); setPage(1); setTotalRows(0); setLoaded(false); }} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3">
          <option value="">Select a database</option>
          {databases.map((name) => <option key={name} value={name}>{databaseDisplayName(name)} ({name})</option>)}
        </select>
      </label>
      <button type="button" disabled={!database || loading} onClick={() => loadDocuments(1)} className="min-h-11 rounded-md bg-[#003366] px-5 text-sm font-bold text-white disabled:bg-slate-400">{loading ? 'Loading…' : 'Load records'}</button>
    </div>

    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 p-4 text-red-900"><div><p className="font-bold">Unable to load records</p><p className="text-sm">{error}</p></div><button type="button" onClick={() => (database ? loadDocuments(page) : loadDatabases())} className="min-h-10 rounded-md border border-red-700 px-4 text-sm font-bold">Retry</button></div> : null}

    {loaded && documents.length ? <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-lg font-bold text-[#003366]">Records: {totalRows}</p><p className="text-sm text-slate-600">Showing {firstRecord}–{lastRecord} of {totalRows}</p></div>
        <p className="text-xs text-slate-500">Search and filters apply to the current page.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-semibold">Search this page<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Student, subject, transaction ID…" className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3" /></label>
        <label className="text-sm font-semibold">Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3"><option value="">All statuses</option>{statusOptions.map((status) => <option key={status} value={status}>{humanize(status)}</option>)}</select></label>
        <label className="text-sm font-semibold">Subject<select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3"><option value="">All subjects</option>{subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <span className="text-sm font-bold text-slate-700">View:</span>
        <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-1" aria-label="Document view mode">
          <button type="button" aria-pressed={viewMode === 'readable'} onClick={() => selectViewMode('readable')} className={`min-h-10 rounded-md px-4 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-yellow-400 ${viewMode === 'readable' ? 'bg-[#003366] text-white shadow-sm' : 'bg-transparent text-slate-700 hover:bg-white'}`}>Readable View</button>
          <button type="button" aria-pressed={viewMode === 'json'} onClick={() => selectViewMode('json')} className={`min-h-10 rounded-md px-4 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-yellow-400 ${viewMode === 'json' ? 'bg-[#003366] text-white shadow-sm' : 'bg-transparent text-slate-700 hover:bg-white'}`}>JSON View</button>
        </div>
      </div>
    </div> : null}

    <div className="space-y-4">
      {filteredDocuments.map((item) => (viewMode === 'json'
        ? <JsonRecordCard key={item.id} item={item} />
        : <RecordCard key={item.id} item={item} />))}
      {loaded && !documents.length && !error ? <p className="rounded-md border border-dashed p-8 text-center text-slate-500">No records found in this database.</p> : null}
      {loaded && documents.length > 0 && !filteredDocuments.length ? <p className="rounded-md border border-dashed p-8 text-center text-slate-500">No records match your search.</p> : null}
      {!loaded && database && !error ? <p className="rounded-md border border-dashed p-8 text-center text-slate-500">Load the selected database to inspect its records.</p> : null}
    </div>

    {loaded && documents.length ? <div className="flex items-center justify-end gap-3 text-sm"><button type="button" disabled={page <= 1 || loading} onClick={() => loadDocuments(page - 1)} className="min-h-11 rounded-md border px-4 disabled:opacity-40">Previous</button><span>Page {page}</span><button type="button" disabled={!hasNextPage || loading} onClick={() => loadDocuments(page + 1)} className="min-h-11 rounded-md border px-4 disabled:opacity-40">Next</button></div> : null}
  </section>;
}

export default CouchDbBrowser;
