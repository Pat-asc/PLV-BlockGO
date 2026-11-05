import { showSystemNotification } from '../../services/NotificationContext';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAcademicPrograms, fetchAllGrades } from '../../services/api';
import { buildLedgerHierarchy, canonicalizeLedgerPrograms, filterLedgerRecords, getLedgerFilterOptions } from '../../utils/registrarGradesLedger';
import { selectLedgerExportRecords } from '../../utils/registrarGradesLedgerPdf';
import SearchField from '../shared/SearchField';
import StatusBadge from '../shared/StatusBadge';
import GradeVersionHistory from '../shared/GradeVersionHistory';

const STUDENT_PAGE_SIZE = 25;
const LEDGER_PAGE_SIZE = 12;
const displayValue = (value) => (value === null || value === undefined || String(value).trim() === '' ? '--' : String(value));
const displayDate = (record) => {
  const value = record.timestamp || record.recorded_at || record.date;
  if (!value) return '--';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
};

const DownloadIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0">
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 16v3h14v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ExportButton = ({ label, onClick }) => (
  <button type="button" aria-label={label} onClick={onClick} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-[#003366] transition hover:bg-amber-50">
    <DownloadIcon /> Export PDF
  </button>
);

export const flattenLedgerItems = (hierarchy = []) => hierarchy.flatMap((program) =>
  program.faculties.flatMap((faculty) => faculty.sections.flatMap((section) =>
    section.subjects.map((subject) => ({
      key: `${program.key}|${faculty.key}|${section.key}|${subject.key}`,
      program,
      faculty,
      section,
      subject,
    }))
  ))
);

const StudentLedgerTable = ({ subject, onViewIpfs }) => {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(subject.students.length / STUDENT_PAGE_SIZE));
  const students = subject.students.slice((page - 1) * STUDENT_PAGE_SIZE, page * STUDENT_PAGE_SIZE);

  useEffect(() => { setPage(1); }, [subject.key]);

  if (subject.students.length === 0) return <p className="p-8 text-center text-sm text-slate-500">No student grade records found for this ledger item.</p>;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-[#003366] text-white"><tr>
            <th className="p-3">Student No.</th><th className="p-3">Student Name</th>
            <th className="p-3">Midterm</th><th className="p-3">Final</th><th className="p-3">Final Rating</th>
            <th className="p-3">Status</th><th className="p-3">Submitted / Finalized</th>
            <th className="p-3">File</th><th className="p-3">History</th>
          </tr></thead>
          <tbody>{students.map((student) => (
            <tr key={student.key} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="p-3 font-semibold text-slate-700">{student.studentNumber}</td>
              <td className="p-3">{student.studentName}</td>
              <td className="p-3">{displayValue(student.gradePayload?.midterm)}</td>
              <td className="p-3">{displayValue(student.gradePayload?.finals ?? student.gradePayload?.final)}</td>
              <td className="p-3 font-bold text-[#003366]">{displayValue(student.gradePayload?.finalAverage ?? student.gradePayload?.grade)}</td>
              <td className="p-3"><StatusBadge status={student.status || 'Unavailable'} /></td>
              <td className="p-3 text-xs text-slate-600">{displayDate(student)}</td>
              <td className="p-3">{(student.ipfs_cid || student.IpfsCID) && onViewIpfs ? <button type="button" onClick={() => onViewIpfs(student.ipfs_cid || student.IpfsCID)} className="font-bold text-blue-700 hover:underline">View File</button> : <span className="text-xs text-slate-400">No File</span>}</td>
              <td className="p-3"><GradeVersionHistory recordId={student.id || student.recordId} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {pageCount > 1 ? <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
        <span>Page {page} of {pageCount}</span><div className="flex gap-2">
          <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-3 py-1 disabled:opacity-40">Previous</button>
          <button type="button" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      </div> : null}
    </>
  );
};

const LedgerDetailsDialog = ({ item, onClose, onViewIpfs, onExport }) => {
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  if (!item) return null;
  const { program, faculty, section, subject } = item;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="ledger-detail-title" className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 bg-[#003366] px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-300">{program.code} · {section.schoolYear || 'School year unavailable'} · {section.semester || 'Semester unavailable'}</p>
            <h3 id="ledger-detail-title" className="mt-1 break-words text-xl font-bold">{subject.subjectCode} — {subject.subjectName || 'Subject title unavailable'}</h3>
            <p className="mt-1 text-sm text-blue-100">{faculty.name} · {section.section} · {subject.term || 'Term unavailable'}</p>
          </div>
          <button type="button" aria-label="Close grade ledger details" onClick={onClose} className="rounded-lg border border-white/40 px-3 py-1.5 text-lg font-bold hover:bg-white/15">×</button>
        </header>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-amber-50 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700">{subject.students.length} student{subject.students.length === 1 ? '' : 's'}</span>
            {subject.statuses.map((status) => <StatusBadge key={status} status={status} />)}
          </div>
          {onExport ? <div className="flex flex-wrap gap-2">
            <ExportButton label={`Export ${program.code} program PDF`} onClick={() => onExport({ type: 'program', programId: program.id })} />
            <ExportButton label={`Export ${faculty.name} faculty PDF`} onClick={() => onExport({ type: 'faculty', programId: program.id, facultyUserId: faculty.userId })} />
            <ExportButton label={`Export ${section.section} section PDF`} onClick={() => onExport({ type: 'section', programId: program.id, facultyUserId: faculty.userId, academicSectionId: section.academicSectionId, schoolYear: section.schoolYear, semester: section.semester })} />
          </div> : null}
        </div>
        <div className="min-h-0 overflow-auto"><StudentLedgerTable subject={subject} onViewIpfs={onViewIpfs} /></div>
      </section>
    </div>
  );
};

const RegistrarGradesLedger = ({ loggedInEmail, onViewIpfs, onExport }) => {
  const [records, setRecords] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ programId: 'all', schoolYear: 'all', semester: 'all', term: 'all', status: 'all', search: '' });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [gradeResponse, programResponse] = await Promise.all([fetchAllGrades(loggedInEmail), fetchAcademicPrograms()]);
      setRecords(Array.isArray(gradeResponse) ? gradeResponse : (gradeResponse.data || []));
      setPrograms(Array.isArray(programResponse) ? programResponse : (programResponse.data || []));
    } catch (requestError) {
      setError(requestError.message || 'Unable to load the Grades Ledger.');
    } finally { setLoading(false); }
  }, [loggedInEmail]);

  useEffect(() => { load(); }, [load]);

  const canonicalPrograms = useMemo(() => Array.from(new Map(programs.map((program) => [String(program.programId), program])).values()), [programs]);
  const canonicalRecords = useMemo(() => canonicalizeLedgerPrograms(records, canonicalPrograms), [records, canonicalPrograms]);
  const options = useMemo(() => getLedgerFilterOptions(canonicalRecords), [canonicalRecords]);
  const filteredRecords = useMemo(() => filterLedgerRecords(canonicalRecords, filters), [canonicalRecords, filters]);
  const hierarchy = useMemo(() => buildLedgerHierarchy(filteredRecords), [filteredRecords]);
  const ledgerItems = useMemo(() => flattenLedgerItems(hierarchy), [hierarchy]);
  const pageCount = Math.max(1, Math.ceil(ledgerItems.length / LEDGER_PAGE_SIZE));
  const visibleItems = ledgerItems.slice((page - 1) * LEDGER_PAGE_SIZE, page * LEDGER_PAGE_SIZE);
  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);
  const updateFilter = (name, value) => { setFilters((current) => ({ ...current, [name]: value })); setPage(1); };
  const requestExport = (scope = { type: 'all' }) => {
    const scopedRecords = selectLedgerExportRecords(filteredRecords, scope);
    if (scopedRecords.length === 0) { showSystemNotification('No finalized grade records are available for this export.'); return; }
    onExport?.(scopedRecords, filters, scope);
  };

  return (
    <section aria-label="Grades Ledger" className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div><h2 className="text-2xl font-bold text-[#003366]">Grades Ledger</h2><p className="mt-1 text-sm text-slate-500">Select a ledger item to view its students and finalized grade details.</p></div>
          <div className="flex flex-wrap gap-2">
            {onExport ? <ExportButton label="Export all filtered grade records PDF" onClick={() => requestExport({ type: 'all' })} /> : null}
            <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#003366]">Filters</button>
            <button type="button" onClick={load} className="rounded-lg bg-[#003366] px-4 py-2 text-sm font-bold text-white">Refresh</button>
          </div>
        </div>
        <div className="mt-5"><SearchField value={filters.search} onChange={(value) => updateFilter('search', value)} label="Search grade ledgers" placeholder="Faculty, subject, section, student, or ID" /></div>
        {filtersOpen ? <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Grade ledger filters">
          <label className="text-xs font-semibold text-slate-600">Program<select aria-label="Program" value={filters.programId} onChange={(event) => updateFilter('programId', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"><option value="all">All Programs</option>{canonicalPrograms.map((program) => <option key={program.programId} value={String(program.programId)}>{program.programCode} — {program.programName}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">School Year<select aria-label="School Year" value={filters.schoolYear} onChange={(event) => updateFilter('schoolYear', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"><option value="all">All School Years</option>{options.schoolYears.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">Semester<select aria-label="Semester" value={filters.semester} onChange={(event) => updateFilter('semester', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"><option value="all">All Semesters</option>{options.semesters.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">Term<select aria-label="Term" value={filters.term} onChange={(event) => updateFilter('term', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"><option value="all">All Terms</option><option value="midterm">Midterm</option><option value="finals">Finals</option></select></label>
          <label className="text-xs font-semibold text-slate-600">Status<select aria-label="Status" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"><option value="all">All Statuses</option>{options.statuses.map((value) => <option key={value}>{value}</option>)}</select></label>
        </div> : null}
      </div>

      {loading ? <div className="rounded-2xl border bg-white p-10 text-center text-slate-500">Loading grade records...</div> : null}
      {!loading && error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">{error}</div> : null}
      {!loading && !error && ledgerItems.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">No grade ledger items match the current search and filters.</div> : null}

      {!loading && !error && ledgerItems.length > 0 ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-[#003366] px-5 py-3 text-sm font-bold text-white">Available grade ledgers <span className="ml-2 rounded-full bg-amber-300 px-2 py-0.5 text-xs text-slate-900">{ledgerItems.length}</span></div>
        <div className="divide-y divide-slate-100">{visibleItems.map(({ key, program, faculty, section, subject }) => (
          <button key={key} type="button" onClick={() => setSelectedItem({ key, program, faculty, section, subject })} className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-blue-50 md:grid-cols-[1.3fr_1fr_1fr_auto] md:items-center">
            <div className="min-w-0"><p className="truncate font-bold text-slate-900">{subject.subjectCode} — {subject.subjectName || 'Subject title unavailable'}</p><p className="mt-1 truncate text-xs text-slate-500">{faculty.name}{faculty.facultyNumber ? ` · ${faculty.facultyNumber}` : ''}</p></div>
            <div><p className="font-semibold text-[#003366]">{section.section}</p><p className="text-xs text-slate-500">{program.code} · {section.schoolYear || '--'} · {section.semester || '--'}</p></div>
            <div className="flex flex-wrap gap-1">{subject.statuses.map((status) => <StatusBadge key={status} status={status} />)}</div>
            <div className="text-right"><p className="text-sm font-bold text-[#003366]">View details</p><p className="text-xs capitalize text-slate-500">{subject.term || '--'} · {subject.students.length} student{subject.students.length === 1 ? '' : 's'}</p></div>
          </button>
        ))}</div>
        {pageCount > 1 ? <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm"><span>Page {page} of {pageCount}</span><div className="flex gap-2"><button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-3 py-1 disabled:opacity-40">Previous</button><button type="button" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-3 py-1 disabled:opacity-40">Next</button></div></div> : null}
      </div> : null}

      {selectedItem ? <LedgerDetailsDialog item={selectedItem} onClose={() => setSelectedItem(null)} onViewIpfs={onViewIpfs} onExport={requestExport} /> : null}
    </section>
  );
};

export default RegistrarGradesLedger;
