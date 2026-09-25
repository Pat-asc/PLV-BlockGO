import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAcademicPrograms, fetchAllGrades } from '../../services/api';
import { buildLedgerHierarchy, canonicalizeLedgerPrograms, filterLedgerRecords, getLedgerFilterOptions } from '../../utils/registrarGradesLedger';
import { selectLedgerExportRecords } from '../../utils/registrarGradesLedgerPdf';

const PAGE_SIZE = 25;
const displayValue = (value) => (value === null || value === undefined || String(value).trim() === '' ? '--' : String(value));
const displayDate = (record) => {
  const value = record.timestamp || record.recorded_at || record.date;
  if (!value) return '--';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
};

const ChevronIcon = ({ expanded, className = '' }) => (
  <svg
    data-testid="chevron-icon"
    aria-hidden="true"
    viewBox="0 0 20 20"
    fill="none"
    className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-0' : '-rotate-90'} ${className}`}
  >
    <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DownloadIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0">
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 16v3h14v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ExportButton = ({ label, onClick, inverse = false }) => (
  <button
    type="button"
    aria-label={label}
    onClick={onClick}
    className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition ${inverse ? 'border-white/40 bg-white/10 text-white hover:bg-white/20' : 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50'}`}
  >
    <DownloadIcon />
    Export PDF
  </button>
);

const SubjectCard = ({ subject, onViewIpfs }) => {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(subject.students.length / PAGE_SIZE));
  const students = subject.students.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="p-4 hover:bg-slate-50">
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left">
          <div>
            <p className="font-bold text-slate-900">{subject.subjectCode} — {subject.subjectName || 'Subject title unavailable'}</p>
            <p className="mt-1 text-xs capitalize text-slate-500">{subject.term || 'Term unavailable'}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {subject.students.length} student{subject.students.length === 1 ? '' : 's'}
            </span>
            {subject.statuses.map((status) => (
              <span key={status} className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold uppercase text-emerald-800">{status}</span>
            ))}
            <ChevronIcon expanded={open} className="text-slate-500" />
          </div>
        </button>
      </header>

      {open ? (
        <div className="border-t border-slate-200">
          {subject.students.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">No student grade records found for this subject and term.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-[#003366] text-white">
                    <tr>
                      <th className="p-3">Student No.</th>
                      <th className="p-3">Student Name</th>
                      <th className="p-3">Midterm</th>
                      <th className="p-3">Final</th>
                      <th className="p-3">Final Rating</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Submitted / Finalized</th>
                      <th className="p-3">File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((student) => (
                      <tr key={student.key} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="p-3 font-semibold text-slate-700">{student.studentNumber}</td>
                        <td className="p-3">{student.studentName}</td>
                        <td className="p-3">{displayValue(student.gradePayload?.midterm)}</td>
                        <td className="p-3">{displayValue(student.gradePayload?.finals ?? student.gradePayload?.final)}</td>
                        <td className="p-3 font-bold text-[#003366]">{displayValue(student.gradePayload?.finalAverage ?? student.gradePayload?.grade)}</td>
                        <td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-700">{student.status || 'N/A'}</span></td>
                        <td className="p-3 text-xs text-slate-600">{displayDate(student)}</td>
                        <td className="p-3">
                          {(student.ipfs_cid || student.IpfsCID) && onViewIpfs ? (
                            <button type="button" onClick={() => onViewIpfs(student.ipfs_cid || student.IpfsCID)} className="font-bold text-blue-700 hover:underline">View File</button>
                          ) : <span className="text-xs text-slate-400">No File</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pageCount > 1 ? (
                <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
                  <span>Page {page} of {pageCount}</span>
                  <div className="flex gap-2">
                    <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-3 py-1 disabled:opacity-40">Previous</button>
                    <button type="button" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-3 py-1 disabled:opacity-40">Next</button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </article>
  );
};

const SectionCard = ({ section, programId, facultyUserId, onViewIpfs, onExport }) => {
  const [open, setOpen] = useState(false);
  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left">
          <div>
            <p className="font-bold text-slate-900">{section.section}</p>
            <p className="mt-1 text-xs text-slate-500">{section.schoolYear || 'School year unavailable'} · {section.semester || 'Semester unavailable'}</p>
          </div>
          <div className="flex items-center gap-3 text-right text-xs font-semibold text-slate-600">
            <span>{section.subjectCount} Subject{section.subjectCount === 1 ? '' : 's'} · {section.gradeRecordCount} Grade Records</span>
            <ChevronIcon expanded={open} className="text-slate-500" />
          </div>
        </button>
        {onExport ? (
          <ExportButton
            label={`Export ${section.section} section PDF`}
            onClick={() => onExport({
              type: 'section',
              programId,
              facultyUserId,
              academicSectionId: section.academicSectionId,
              schoolYear: section.schoolYear,
              semester: section.semester,
            })}
          />
        ) : null}
      </header>
      {open ? (
        <div className="space-y-3 border-t border-slate-200 bg-slate-50 p-3">
          {section.subjects.map((subject) => <SubjectCard key={subject.key} subject={subject} onViewIpfs={onViewIpfs} />)}
        </div>
      ) : null}
    </article>
  );
};

const RegistrarGradesLedger = ({ loggedInEmail, onViewIpfs, onExport }) => {
  const [records, setRecords] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ programId: 'all', schoolYear: 'all', semester: 'all', term: 'all', status: 'all', search: '' });
  const [openPrograms, setOpenPrograms] = useState({});
  const [openFaculties, setOpenFaculties] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [gradeResponse, programResponse] = await Promise.all([
        fetchAllGrades(loggedInEmail),
        fetchAcademicPrograms(),
      ]);
      setRecords(Array.isArray(gradeResponse) ? gradeResponse : (gradeResponse.data || []));
      setPrograms(Array.isArray(programResponse) ? programResponse : (programResponse.data || []));
    } catch (requestError) {
      setError(requestError.message || 'Unable to load the Grades Ledger.');
    } finally {
      setLoading(false);
    }
  }, [loggedInEmail]);

  useEffect(() => { load(); }, [load]);

  const canonicalPrograms = useMemo(() => Array.from(new Map(programs.map((program) => [String(program.programId), program])).values()), [programs]);
  const canonicalRecords = useMemo(() => canonicalizeLedgerPrograms(records, canonicalPrograms), [records, canonicalPrograms]);
  const options = useMemo(() => getLedgerFilterOptions(canonicalRecords), [canonicalRecords]);
  const filteredRecords = useMemo(() => filterLedgerRecords(canonicalRecords, filters), [canonicalRecords, filters]);
  const hierarchy = useMemo(() => buildLedgerHierarchy(filteredRecords), [filteredRecords]);
  const updateFilter = (name, value) => setFilters((current) => ({ ...current, [name]: value }));
  const toggle = (setter, key) => setter((current) => ({ ...current, [key]: !current[key] }));
  const requestExport = (scope = { type: 'all' }) => {
    const scopedRecords = selectLedgerExportRecords(filteredRecords, scope);
    if (scopedRecords.length === 0) {
      window.alert('No grade records available for this export.');
      return;
    }
    onExport?.(scopedRecords, filters, scope);
  };

  return (
    <section aria-label="Grades Ledger" className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-[#003366]">Grades Ledger</h2>
            <p className="mt-1 text-sm text-slate-500">Browse submitted, approved, and finalized records by exact academic section and subject.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onExport ? <ExportButton label="Export all filtered grade records PDF" onClick={() => requestExport({ type: 'all' })} /> : null}
            <button type="button" onClick={load} className="rounded-lg bg-[#003366] px-4 py-2 text-sm font-bold text-white">Refresh</button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="text-xs font-semibold text-slate-600">Program
            <select aria-label="Program" value={filters.programId} onChange={(event) => updateFilter('programId', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
              <option value="all">All Programs</option>
              {canonicalPrograms.map((program) => <option key={program.programId} value={String(program.programId)}>{program.programCode} — {program.programName}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">School Year
            <select aria-label="School Year" value={filters.schoolYear} onChange={(event) => updateFilter('schoolYear', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
              <option value="all">All School Years</option>{options.schoolYears.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Semester
            <select aria-label="Semester" value={filters.semester} onChange={(event) => updateFilter('semester', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
              <option value="all">All Semesters</option>{options.semesters.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Term
            <select aria-label="Term" value={filters.term} onChange={(event) => updateFilter('term', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
              <option value="all">All Terms</option><option value="midterm">Midterm</option><option value="finals">Finals</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Status
            <select aria-label="Status" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
              <option value="all">All Statuses</option>{options.statuses.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Search
            <input aria-label="Search" value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Faculty, section, student" className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm" />
          </label>
        </div>
      </div>

      {loading ? <div className="rounded-2xl border bg-white p-10 text-center text-slate-500">Loading grade records...</div> : null}
      {!loading && error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">{error}</div> : null}
      {!loading && !error && hierarchy.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">No grade records found for this program.</div>
      ) : null}

      {!loading && !error ? hierarchy.map((program) => {
        const programOpen = !!openPrograms[program.key];
        return (
          <article key={program.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <header className="flex items-center gap-3 bg-[#003366] p-5 text-white">
              <button type="button" aria-expanded={programOpen} onClick={() => toggle(setOpenPrograms, program.key)} className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left">
                <div><h3 className="text-lg font-bold">{program.code}</h3><p className="text-sm text-blue-100">{program.name}</p></div>
                <div className="flex items-center gap-3 text-right text-xs"><p>{program.facultyCount} Faculty · {program.sectionCount} Sections · {program.recordCount} Grade Records</p><ChevronIcon expanded={programOpen} /></div>
              </button>
              {onExport ? <ExportButton label={`Export ${program.code} program PDF`} onClick={() => requestExport({ type: 'program', programId: program.id })} inverse /> : null}
            </header>
            {programOpen ? <div className="space-y-3 p-4">{program.faculties.map((faculty) => {
              const facultyOpen = !!openFaculties[faculty.key];
              return (
                <section key={faculty.key} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  <header className="flex items-center gap-3 p-4">
                    <button type="button" aria-expanded={facultyOpen} onClick={() => toggle(setOpenFaculties, faculty.key)} className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left">
                      <div><h4 className="font-bold text-slate-900">{faculty.name}</h4><p className="text-xs text-slate-500">{[faculty.facultyNumber, faculty.email].filter(Boolean).join(' · ') || 'Faculty identifier unavailable'}</p></div>
                      <div className="flex items-center gap-3 text-right text-xs font-semibold text-slate-600"><span>{faculty.sectionCount} Sections · {faculty.subjectCount} Subjects · {faculty.studentCount} Students</span><ChevronIcon expanded={facultyOpen} /></div>
                    </button>
                    {onExport ? <ExportButton label={`Export ${faculty.name} faculty PDF`} onClick={() => requestExport({ type: 'faculty', programId: program.id, facultyUserId: faculty.userId })} /> : null}
                  </header>
                  {facultyOpen ? <div className="space-y-3 border-t border-slate-200 p-3">{faculty.sections.map((section) => <SectionCard key={section.key} section={section} programId={program.id} facultyUserId={faculty.userId} onViewIpfs={onViewIpfs} onExport={requestExport} />)}</div> : null}
                </section>
              );
            })}</div> : null}
          </article>
        );
      }) : null}
    </section>
  );
};

export default RegistrarGradesLedger;
