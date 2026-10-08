import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchRegistrarFinalizationQueue, finalizeApprovedGrades } from '../../services/api';
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
      if (reason === 'grade_approved' || reason === 'grade_finalized') loadQueue();
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

  return (
    <section aria-label="Finalize Grades" className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-[#003366]">Finalize Grades</h2>
            <p className="mt-1 text-sm text-slate-600">Review the exact Chairperson-approved PostgreSQL snapshot before committing it to the Fabric ledger.</p>
          </div>
          <button type="button" onClick={loadQueue} disabled={loading || Boolean(finalizingKey)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Refresh</button>
        </div>
      </div>

      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p> : null}
      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading approved grades…</div> : null}
      {!loading && !error && groups.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">No Chairperson-approved sections are waiting for Registrar finalization.</div> : null}

      {!loading && groups.map((group) => (
        <article key={group.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-bold text-[#003366]">{group.subjectCode || 'Subject'} · {group.section || 'Section'}</h3>
              <p className="text-sm text-slate-600">{group.schoolYear} · {group.semester} · {group.term} · {group.records.length} student(s)</p>
            </div>
            <button type="button" onClick={() => setSelectedGroup(group)} disabled={Boolean(finalizingKey)} className="rounded-xl bg-[#003366] px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300">
              {finalizingKey === group.key ? 'Finalizing…' : 'Finalize Section'}
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

      <Modal isOpen={Boolean(selectedGroup)} onClose={() => { if (!finalizingKey) setSelectedGroup(null); }} title="Finalize approved section" description="The exact approved grade payloads shown in this table will be committed atomically to Hyperledger Fabric." closeOnBackdrop={!finalizingKey} closeOnEscape={!finalizingKey}>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => setSelectedGroup(null)} disabled={Boolean(finalizingKey)} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={confirmFinalization} disabled={Boolean(finalizingKey)} className="rounded-xl bg-[#003366] px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-400">{finalizingKey ? 'Finalizing…' : 'Finalize Grades'}</button>
        </div>
      </Modal>
    </section>
  );
}

export default RegistrarGradeFinalization;
