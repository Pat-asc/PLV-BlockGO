import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchRegistrarFinalizationQueue, finalizeApprovedGrades } from '../../services/api';
import { sanitizeAcademicErrorMessage } from '../../utils/academicErrorSanitizer';
import { showSystemNotification } from '../../services/NotificationContext';
import { requestSystemConfirmation } from '../../services/SystemDialogContext';
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
    const program = recordValue(record, 'program', 'program', 'Program') || recordValue(record, 'course', 'course', 'Course');
    const key = [assignmentCycleId, subjectCode, section, schoolYear, semester, term, facultyId]
      .map((value) => String(value).trim().toLowerCase()).join('|');
    if (!groups.has(key)) {
      groups.set(key, { key, assignmentCycleId, subjectCode, section, schoolYear, semester, term, facultyId, program, records: [] });
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

export const buildFinalizationHierarchy = (groups = []) => {
  const departments = new Map();
  groups.forEach((group) => {
    const departmentName = String(group.program || 'Department unavailable').trim();
    const departmentKey = departmentName.toLowerCase();
    const facultyName = group.records[0]?.professorName || group.facultyId || 'Assigned Faculty';
    const facultyKey = String(group.facultyId || facultyName).trim().toLowerCase();
    if (!departments.has(departmentKey)) departments.set(departmentKey, { key: departmentKey, name: departmentName, facultyMap: new Map() });
    const department = departments.get(departmentKey);
    if (!department.facultyMap.has(facultyKey)) department.facultyMap.set(facultyKey, { key: facultyKey, name: facultyName, groups: [] });
    department.facultyMap.get(facultyKey).groups.push(group);
  });
  return [...departments.values()].map((department) => ({
    key: department.key,
    name: department.name,
    faculties: [...department.facultyMap.values()].map((faculty) => ({
      ...faculty,
      groups: [...faculty.groups].sort((left, right) =>
        [left.section, left.subjectCode, left.term].join('|').localeCompare([right.section, right.subjectCode, right.term].join('|'), undefined, { numeric: true })),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  })).sort((left, right) => left.name.localeCompare(right.name));
};

function RegistrarGradeFinalization() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
      setError(sanitizeAcademicErrorMessage(loadError, 'The approved grade queue could not be loaded. Please refresh and try again.'));
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
  const hierarchy = useMemo(() => buildFinalizationHierarchy(groups), [groups]);

  const finalizeAllDepartments = async () => {
    if (groups.length === 0 || finalizationInFlight.current) return;
    finalizationInFlight.current = true;
    const totalRecords = groups.reduce((count, group) => count + group.records.length, 0);
    const confirmed = await requestSystemConfirmation({
      title: 'Finalize all ready grades?',
      message: `${hierarchy.length} department(s) · ${groups.length} encoded section(s) · ${totalRecords} grade record(s)\n\nEach exact section will be verified and finalized through the existing protected workflow.`,
      confirmLabel: 'Finalize All Departments',
      tone: 'primary',
    });
    if (!confirmed) {
      finalizationInFlight.current = false;
      return;
    }
    setFinalizingKey('all');
    setError('');
    let completedGroups = 0;
    let archivePending = false;
    try {
      for (const group of groups) {
        const result = await finalizeApprovedGrades(group.records.map((record) => record.id));
        completedGroups += 1;
        archivePending = archivePending || Boolean(result?.ipfsArchiveStatus && result.ipfsArchiveStatus !== 'AVAILABLE');
      }
      showSystemNotification(archivePending
        ? 'All ready grades were finalized, but one or more grading sheets are still being prepared. They can be retried without finalizing the grades again.'
        : 'All ready grades were finalized successfully. The Grades Ledger has been updated.', archivePending ? 'warning' : 'success', {
        title: archivePending ? 'Grades finalized — grading sheets pending' : 'All grades finalized',
      });
      setSelectedGroup(null);
      await loadQueue();
    } catch (finalizeError) {
      const safeMsg = sanitizeAcademicErrorMessage(finalizeError, 'The grades could not be finalized right now. Your approved grades were preserved. Please try again.');
      const progress = completedGroups > 0 ? ` ${completedGroups} of ${groups.length} section batches were completed before the interruption.` : '';
      showSystemNotification(`${safeMsg}${progress}`, 'error', { title: 'Finalization could not be completed' });
      await loadQueue();
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
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Review the exact Faculty-submitted PostgreSQL snapshot before committing it through the verified Fabric pipeline.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={loadQueue} disabled={loading || Boolean(finalizingKey)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Refresh</button>
            <button type="button" onClick={finalizeAllDepartments} disabled={loading || groups.length === 0 || Boolean(finalizingKey)} className="rounded-xl bg-[#003366] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">{finalizingKey === 'all' ? 'Finalizing All…' : 'Finalize All Departments'}</button>
          </div>
        </div>
      </div>

      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading approved grades…</div> : null}
      {!loading && !error && groups.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">No Faculty submissions are waiting for Registrar review.</div> : null}

      {!loading && hierarchy.map((department) => (
        <article key={department.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <header className="border-b border-slate-200 bg-[#003366] px-5 py-4 text-white dark:border-slate-700 dark:bg-slate-800">
            <h3 className="text-lg font-bold">{department.name}</h3>
            <p className="text-sm text-blue-100">{department.faculties.length} faculty · {department.faculties.reduce((count, faculty) => count + faculty.groups.length, 0)} encoded section(s)</p>
          </header>
          <div className="divide-y divide-slate-200 dark:divide-slate-700">{department.faculties.map((faculty) => (
            <section key={faculty.key} className="p-4">
              <div className="mb-3"><h4 className="font-bold text-slate-900 dark:text-slate-100">{faculty.name}</h4><p className="text-xs text-slate-500 dark:text-slate-400">{faculty.groups.length} encoded section(s)</p></div>
              <div className="grid gap-3">{faculty.groups.map((group) => (
                <div key={group.key} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-800">
                  <div><p className="font-bold text-[#003366] dark:text-sky-300">{group.section || 'Section'} · {group.subjectCode || 'Subject'}</p><p className="text-sm text-slate-600 dark:text-slate-300">{group.schoolYear} · {group.semester} · {group.term} · {group.records.length} student(s)</p></div>
                  <button type="button" onClick={() => setSelectedGroup(group)} disabled={Boolean(finalizingKey)} className="rounded-xl border border-[#003366] px-4 py-2 text-sm font-bold text-[#003366] disabled:opacity-50 dark:border-sky-500 dark:text-sky-300">Review Students</button>
                </div>
              ))}</div>
            </section>
          ))}</div>
        </article>
      ))}

      <Modal isOpen={Boolean(selectedGroup)} onClose={() => { if (!finalizingKey) setSelectedGroup(null); }} title="Review Faculty Grade Submission" description="Compare the exact submitted section. Finalization is performed for all ready departments from the main action." closeOnBackdrop={!finalizingKey} closeOnEscape={!finalizingKey} panelClassName="flex max-h-[92vh] max-w-6xl flex-col overflow-hidden p-4 sm:p-6" bodyClassName="min-h-0 flex-1 overflow-y-auto">
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
            <div className="box-border min-w-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="w-full min-w-0 overflow-x-auto overflow-y-hidden" data-testid="registrar-reference-comparison-scroll">
                <div className="box-border w-full min-w-[520px]" data-testid="registrar-reference-comparison-canvas">
                  <h4 className="box-border w-full bg-slate-700 px-4 py-3 font-bold text-white dark:bg-slate-800">Reference / Previous Grade Data</h4>
                  <table className="box-border w-full border-collapse text-sm"><thead className="bg-slate-100 text-left dark:bg-slate-800"><tr><th className="px-3 py-2">Student ID</th><th className="px-3 py-2">Student</th><th className="px-3 py-2">Reference</th></tr></thead><tbody>{selectedGroup.records.map((record) => <tr key={`reference-${record.id}`} className="border-t border-slate-200 dark:border-slate-700"><td className="px-3 py-2 font-mono text-xs">{valueOrDash(record.studentNo)}</td><td className="px-3 py-2">{record.studentName || 'Student'}</td><td className="px-3 py-2 font-bold" title={record.referenceSource || 'No authoritative reference available'}>{valueOrDash(record.referenceGrade)}</td></tr>)}</tbody></table>
                </div>
              </div>
            </div>
            <div className="box-border min-w-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="w-full min-w-0 overflow-x-auto overflow-y-hidden" data-testid="registrar-submitted-comparison-scroll">
                <div className="box-border w-full min-w-[520px]" data-testid="registrar-submitted-comparison-canvas">
                  <h4 className="box-border w-full bg-[#003366] px-4 py-3 font-bold text-white dark:bg-sky-900">Currently Submitted Grade Data</h4>
                  <table className="box-border w-full border-collapse text-sm"><thead className="bg-slate-100 text-left dark:bg-slate-800"><tr><th className="px-3 py-2">Student ID</th><th className="px-3 py-2">Student</th><th className="px-3 py-2">Submitted</th></tr></thead><tbody>{selectedGroup.records.map((record) => { const grade = parseApprovedGradePayload(record.gradePayload, selectedGroup.term); const submitted = record.currentGrade || (String(selectedGroup.term).toLowerCase() === 'finals' ? grade.finals : grade.midterm); const changed = String(record.integrityStatus).toUpperCase() === 'MISMATCH'; return <tr key={`submitted-${record.id}`} data-changed={changed ? 'true' : 'false'} className={`border-t border-slate-200 dark:border-slate-700 ${changed ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}><td className="px-3 py-2 font-mono text-xs">{valueOrDash(record.studentNo)}</td><td className="px-3 py-2">{record.studentName || 'Student'}</td><td className={`px-3 py-2 font-bold ${changed ? 'text-amber-800 dark:text-amber-300' : ''}`}>{valueOrDash(submitted)}</td></tr>; })}</tbody></table>
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end dark:border-slate-700">
            <button type="button" onClick={() => setSelectedGroup(null)} disabled={Boolean(finalizingKey)} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">Close</button>
          </div>
        </div> : null}
      </Modal>
    </section>
  );
}

export default RegistrarGradeFinalization;
