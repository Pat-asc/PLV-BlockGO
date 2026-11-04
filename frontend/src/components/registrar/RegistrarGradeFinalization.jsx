import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchRegistrarFinalizationQueue, finalizeApprovedGrades, returnGradeSubmission } from '../../services/api';
import Modal from '../../services/Modal';

const valueOrDash = (value) => value === null || value === undefined || String(value) === ''
  ? '—'
  : String(value);

export const parseApprovedGradePayload = (rawGrade, term = '') => {
  if (rawGrade === null || rawGrade === undefined || String(rawGrade).trim() === '') {
    return { midterm: '—', finals: '—', finalAverage: '—' };
  }

  if (typeof rawGrade === 'object') {
    return {
      midterm: valueOrDash(rawGrade.midterm ?? rawGrade.midterms ?? rawGrade.midtermGrade),
      finals: valueOrDash(rawGrade.finals ?? rawGrade.final ?? rawGrade.finalGrade),
      finalAverage: valueOrDash(rawGrade.finalAverage ?? rawGrade.final_average),
    };
  }

  const source = String(rawGrade);
  if (source.trimStart().startsWith('{')) {
    try {
      return parseApprovedGradePayload(JSON.parse(source), term);
    } catch {
      return { midterm: '—', finals: '—', finalAverage: '—' };
    }
  }

  return String(term).trim().toLowerCase() === 'finals'
    ? { midterm: '—', finals: source, finalAverage: '—' }
    : { midterm: source, finals: '—', finalAverage: '—' };
};

const recordValue = (record, camel, snake, pascal) => record?.[camel] ?? record?.[snake] ?? record?.[pascal] ?? '';

export const groupApprovedGradeRecords = (records = []) => {
  const groups = new Map();
  records.forEach((record) => {
    const id = String(recordValue(record, 'id', 'id', 'Id')).trim();
    if (!id) return;
    const assignmentCycleId = recordValue(record, 'assignmentCycleId', 'assignment_cycle_id', 'AssignmentCycleId');
    const subjectCode = recordValue(record, 'subjectCode', 'subject_code', 'SubjectCode');
    const section = recordValue(record, 'section', 'section', 'Section');
    const schoolYear = recordValue(record, 'schoolYear', 'school_year', 'SchoolYear');
    const semester = recordValue(record, 'semester', 'semester', 'Semester');
    const term = recordValue(record, 'term', 'term', 'Term');
    const facultyId = recordValue(record, 'facultyId', 'faculty_id', 'FacultyId');
    const key = [assignmentCycleId, subjectCode, section, schoolYear, semester, term, facultyId]
      .map((value) => String(value).trim().toLowerCase()).join('|');
    if (!groups.has(key)) {
      groups.set(key, { key, assignmentCycleId, subjectCode, section, schoolYear, semester, term, facultyId, records: [] });
    }
    groups.get(key).records.push({
      ...record,
      id,
      studentNo: recordValue(record, 'studentNo', 'student_no', 'StudentNo'),
      studentName: recordValue(record, 'studentName', 'student_name', 'StudentName'),
      gradePayload: recordValue(record, 'grade', 'grade', 'Grade'),
      professorName: recordValue(record, 'professorName', 'professor_name', 'ProfessorName'),
      timestamp: recordValue(record, 'timestamp', 'recorded_at', 'Timestamp'),
      date: recordValue(record, 'date', 'date', 'Date'),
      currentGrade: recordValue(record, 'currentGrade', 'current_grade', 'CurrentGrade'),
      referenceGrade: recordValue(record, 'referenceGrade', 'reference_grade', 'ReferenceGrade'),
      integrityStatus: recordValue(record, 'integrityStatus', 'integrity_status', 'IntegrityStatus'),
      referenceSource: recordValue(record, 'referenceSource', 'reference_source', 'ReferenceSource'),
    });
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      records: [...group.records].sort((left, right) =>
        String(left.studentNo).localeCompare(String(right.studentNo), undefined, { numeric: true }) ||
        left.id.localeCompare(right.id)),
    }))
    .sort((left, right) => [left.schoolYear, left.semester, left.section, left.subjectCode, left.term]
      .join('|').localeCompare([right.schoolYear, right.semester, right.section, right.subjectCode, right.term].join('|'), undefined, { numeric: true }));
};

function RegistrarGradeFinalization() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [finalizingKey, setFinalizingKey] = useState('');
  const [returningKey, setReturningKey] = useState('');
  const [returnNote, setReturnNote] = useState('');
  const requestGeneration = useRef(0);
  const requestController = useRef(null);
  const finalizationInFlight = useRef(false);

  const loadQueue = useCallback(async () => {
    const generation = ++requestGeneration.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await fetchRegistrarFinalizationQueue({ signal: controller.signal });
      if (generation !== requestGeneration.current) return;
      setRecords(Array.isArray(response) ? response : (response?.data || []));
    } catch (loadError) {
      if (generation !== requestGeneration.current || loadError?.name === 'AbortError') return;
      setError(loadError?.message || 'The approved grade queue could not be loaded.');
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
    const handleChange = (event) => {
      const reason = String(event.detail?.reason || event.detail?.Reason || '').toLowerCase();
      if (['section_submitted_to_registrar', 'section_submitted', 'grade_returned', 'grade_finalized'].includes(reason)) loadQueue();
    };
    window.addEventListener('blockgo:academic-data-changed', handleChange);
    return () => {
      requestGeneration.current += 1;
      requestController.current?.abort();
      window.removeEventListener('blockgo:academic-data-changed', handleChange);
    };
  }, [loadQueue]);

  const groups = useMemo(() => groupApprovedGradeRecords(records), [records]);

  const confirmFinalization = async () => {
    if (!selectedGroup || finalizationInFlight.current) return;
    finalizationInFlight.current = true;
    setFinalizingKey(selectedGroup.key);
    setError('');
    setNotice('');
    try {
      const result = await finalizeApprovedGrades(selectedGroup.records.map((record) => record.id));
      setNotice(result?.message || `${selectedGroup.records.length} approved grades were finalized.`);
      setSelectedGroup(null);
      await loadQueue();
    } catch (finalizeError) {
      setError(finalizeError?.message || 'The approved section could not be finalized. Its staging data was preserved.');
    } finally {
      finalizationInFlight.current = false;
      setFinalizingKey('');
    }
  };

  const confirmReturn = async () => {
    if (!selectedGroup || returnNote.trim().length < 3 || returningKey) return;
    setReturningKey(selectedGroup.key);
    setError('');
    setNotice('');
    try {
      const result = await returnGradeSubmission(selectedGroup.records.map((record) => record.id), returnNote.trim());
      setNotice(result?.message || 'The submission was returned to Faculty.');
      setSelectedGroup(null);
      setReturnNote('');
      await loadQueue();
    } catch (returnError) {
      setError(returnError?.message || 'The submission could not be returned.');
    } finally {
      setReturningKey('');
    }
  };

  return (
    <section aria-label="Finalize Grades" className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-[#003366]">Finalize Grades</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Review the exact Faculty-submitted PostgreSQL snapshot, then return it or commit it through the verified Fabric pipeline.</p>
          </div>
          <button type="button" onClick={loadQueue} disabled={loading || Boolean(finalizingKey)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Refresh</button>
        </div>
      </div>

      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p> : null}
      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading approved grades…</div> : null}
      {!loading && !error && groups.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">No Faculty submissions are waiting for Registrar review.</div> : null}

      {!loading && groups.map((group) => (
        <article key={group.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-bold text-[#003366]">{group.subjectCode || 'Subject'} · {group.section || 'Section'}</h3>
              <p className="text-sm text-slate-600">{group.schoolYear} · {group.semester} · {group.term} · {group.records.length} student(s)</p>
            </div>
            <button type="button" onClick={() => { setSelectedGroup(group); setReturnNote(''); }} disabled={Boolean(finalizingKey || returningKey)} className="rounded-xl bg-[#003366] px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300">
              {finalizingKey === group.key ? 'Finalizing…' : 'Review Grades'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Student ID</th><th className="px-4 py-3">Student</th><th className="px-4 py-3">Midterm</th><th className="px-4 py-3">Finals</th><th className="px-4 py-3">Final Average</th><th className="px-4 py-3">Record ID</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{group.records.map((record) => { const grade = parseApprovedGradePayload(record.gradePayload, group.term); return <tr key={record.id}><td className="px-4 py-3 font-mono text-xs">{record.studentNo || '—'}</td><td className="px-4 py-3 font-medium">{record.studentName || 'Student'}</td><td className="px-4 py-3">{grade.midterm}</td><td className="px-4 py-3">{grade.finals}</td><td className="px-4 py-3 font-semibold">{grade.finalAverage}</td><td className="px-4 py-3 font-mono text-xs text-slate-500">{record.id}</td></tr>; })}</tbody>
            </table>
          </div>
        </article>
      ))}

      <Modal isOpen={Boolean(selectedGroup)} onClose={() => { if (!finalizingKey && !returningKey) setSelectedGroup(null); }} title="Review Faculty Grade Submission" description="Compare the submitted snapshot before returning it or approving and finalizing it on Hyperledger Fabric." closeOnBackdrop={!finalizingKey && !returningKey} closeOnEscape={!finalizingKey && !returningKey} panelClassName="flex max-h-[92vh] max-w-6xl flex-col overflow-hidden p-4 sm:p-6" bodyClassName="min-h-0 flex-1 overflow-y-auto">
        {selectedGroup ? <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
            {[
              ['Faculty', selectedGroup.records[0]?.professorName || selectedGroup.facultyId || 'Faculty'],
              ['Subject', selectedGroup.subjectCode], ['Section', selectedGroup.section],
              ['Academic Year', selectedGroup.schoolYear], ['Semester', selectedGroup.semester],
              ['Term', selectedGroup.term],
              ['Submitted', selectedGroup.records[0]?.timestamp || selectedGroup.records[0]?.date || 'Not available'],
            ].map(([label, value]) => <div key={label} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p><p className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100" title={value}>{valueOrDash(value)}</p></div>)}
          </div>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2" data-testid="registrar-grade-comparison-grid">
            <div className="min-w-0 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <h4 className="bg-slate-700 px-4 py-3 font-bold text-white dark:bg-slate-800">Reference / Previous Grade Data</h4>
              <table className="min-w-[520px] text-sm"><thead className="bg-slate-100 text-left dark:bg-slate-800"><tr><th className="px-3 py-2">Student ID</th><th className="px-3 py-2">Student</th><th className="px-3 py-2">Reference</th></tr></thead><tbody>{selectedGroup.records.map((record) => <tr key={`reference-${record.id}`} className="border-t border-slate-200 dark:border-slate-700"><td className="px-3 py-2 font-mono text-xs">{valueOrDash(record.studentNo)}</td><td className="px-3 py-2">{record.studentName || 'Student'}</td><td className="px-3 py-2 font-bold" title={record.referenceSource || 'No authoritative reference available'}>{valueOrDash(record.referenceGrade)}</td></tr>)}</tbody></table>
            </div>
            <div className="min-w-0 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <h4 className="bg-[#003366] px-4 py-3 font-bold text-white dark:bg-sky-900">Currently Submitted Grade Data</h4>
              <table className="min-w-[520px] text-sm"><thead className="bg-slate-100 text-left dark:bg-slate-800"><tr><th className="px-3 py-2">Student ID</th><th className="px-3 py-2">Student</th><th className="px-3 py-2">Submitted</th></tr></thead><tbody>{selectedGroup.records.map((record) => { const grade = parseApprovedGradePayload(record.gradePayload, selectedGroup.term); const submitted = record.currentGrade || (String(selectedGroup.term).toLowerCase() === 'finals' ? grade.finals : grade.midterm); const changed = String(record.integrityStatus).toUpperCase() === 'MISMATCH'; return <tr key={`submitted-${record.id}`} data-changed={changed ? 'true' : 'false'} className={`border-t border-slate-200 dark:border-slate-700 ${changed ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}><td className="px-3 py-2 font-mono text-xs">{valueOrDash(record.studentNo)}</td><td className="px-3 py-2">{record.studentName || 'Student'}</td><td className={`px-3 py-2 font-bold ${changed ? 'text-amber-800 dark:text-amber-300' : ''}`}>{valueOrDash(submitted)}</td></tr>; })}</tbody></table>
            </div>
          </div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Return remarks
            <textarea value={returnNote} onChange={(event) => setReturnNote(event.target.value)} rows={3} placeholder="Required when returning grades to Faculty" className="mt-1 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#003366] focus:ring-2 focus:ring-[#003366]/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </label>
          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end dark:border-slate-700">
            <button type="button" onClick={() => setSelectedGroup(null)} disabled={Boolean(finalizingKey || returningKey)} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">Close</button>
            <button type="button" onClick={confirmReturn} disabled={returnNote.trim().length < 3 || Boolean(finalizingKey || returningKey)} className="rounded-xl bg-red-700 px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-400">{returningKey ? 'Returning…' : 'Return Grades'}</button>
            <button type="button" onClick={confirmFinalization} disabled={Boolean(finalizingKey || returningKey)} className="rounded-xl bg-[#003366] px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-400">{finalizingKey ? 'Finalizing…' : 'Approve and Finalize'}</button>
          </div>
        </div> : null}
      </Modal>
    </section>
  );
}

export default RegistrarGradeFinalization;
