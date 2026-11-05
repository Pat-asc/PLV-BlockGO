import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SearchField from '../shared/SearchField';
import BoundedSelect from '../shared/BoundedSelect';
import CurriculumViewer from '../shared/CurriculumViewer';
import Modal from '../../services/Modal';
import {
  fetchApprovedStudents,
  fetchAcademicPeriodOptions,
  fetchCurriculum,
  fetchCurriculums,
  fetchNstpOptions,
  enrollExistingStudent,
  registrarBulkEnrollStudents,
  registrarBulkUpdateStudents,
  searchExistingStudentsForEnrollment,
  fetchCrossCurriculumOptions,
  assignCrossCurriculumSubjects,
  removeNonRegularSubject,
} from '../../services/api';
import { buildCsvContent, downloadCsvFile } from '../../utils/studentSectioningHelpers';
import { downloadTemplateButtonClass } from '../shared/downloadButtonStyles';
import { normalizeStudentNameFields } from '../../utils/studentName';
import { showSystemNotification } from '../../services/NotificationContext';

const normalizeProgramIdentity = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const hasPrerequisiteRequirement = (prerequisite) => {
  const normalized = String(prerequisite || '').trim().toLowerCase();
  return Boolean(normalized) && !['none', 'n/a', 'na', '-'].includes(normalized);
};

const enrollmentDisplayStatus = (student) => {
  if (!String(student?.section || '').trim()) return 'Not Sectioned';
  return student?.isIrregular || student?.is_irregular ? 'Irregular' : 'Regular';
};

const formatYearLevel = (value) => {
  const year = Number.parseInt(value, 10);
  if (!Number.isInteger(year)) return 'Year not set';
  if (year === 1) return '1st Year';
  if (year === 2) return '2nd Year';
  if (year === 3) return '3rd Year';
  return `${year}th Year`;
};

const crossCurriculumSubjectCount = (student) => {
  const directCount = [student?.crossCurriculumSubjectCount, student?.nonRegularSubjectCount]
    .map((value) => Number(value))
    .find((value) => Number.isInteger(value) && value > 0);
  if (directCount) return directCount;
  const collection = student?.crossCurriculumSubjects || student?.nonRegularSubjects;
  return Array.isArray(collection) && collection.length > 0 ? collection.length : 0;
};

const EnrollmentUsersIcon = ({ className = 'h-5 w-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const StudentEnrollmentManagement = ({ programs = [] }) => {
  const [form, setForm] = useState({
    department: programs[0] || '',
    schoolYear: '',
    semester: '',
    yearLevel: '1',
    curriculumId: '',
    nstpOption: '',
  });
  const [file, setFile] = useState(null);
  const fileInputRef = useRef(null);
  const [students, setStudents] = useState([]);
  const [curricula, setCurricula] = useState([]);
  const [nstpOptions, setNstpOptions] = useState([]);
  const emptyManualForm = { firstName: '', lastName: '', middleName: '', sex: '', birthdate: '', email: '', contactNumber: '', homeAddress: '' };
  const [manualForm, setManualForm] = useState(emptyManualForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [enrollmentSearch, setEnrollmentSearch] = useState('');
  const [enrollmentMethod, setEnrollmentMethod] = useState('bulk');
  const [sectionFilter, setSectionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [existingCandidates, setExistingCandidates] = useState([]);
  const [selectedExistingId, setSelectedExistingId] = useState('');
  const [curriculumView, setCurriculumView] = useState(null);
  const [curriculumLoading, setCurriculumLoading] = useState(false);

  // Cross-curriculum subject assignment state (single & bulk students)
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [crossModalOpen, setCrossModalOpen] = useState(false);
  const [crossOptionsLoading, setCrossOptionsLoading] = useState(false);
  const [crossOptionsError, setCrossOptionsError] = useState('');
  const [crossOptions, setCrossOptions] = useState([]);
  const [crossStudentContexts, setCrossStudentContexts] = useState([]);
  const [sourceProgramCode, setSourceProgramCode] = useState('');
  const [sourceCurriculumId, setSourceCurriculumId] = useState('');
  const [subjectSelections, setSubjectSelections] = useState({});
  const [crossAssigning, setCrossAssigning] = useState(false);
  const [crossResult, setCrossResult] = useState(null);

  const loadCandidates = useCallback(async (search = '') => {
    try {
      const response = await searchExistingStudentsForEnrollment(search);
      setExistingCandidates(response?.data || []);
    } catch (error) {
      setResult({ status: 'Error', message: error.message || 'Existing students could not be searched.' });
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [periodResult, curriculumResult, nstpResult] = await Promise.allSettled([
        fetchAcademicPeriodOptions(),
        fetchCurriculums('PUBLISHED'),
        typeof fetchNstpOptions === 'function' ? fetchNstpOptions() : Promise.resolve({ data: [] }),
      ]);
      setCurricula(curriculumResult.status === 'fulfilled' ? curriculumResult.value?.data || [] : []);
      setNstpOptions(nstpResult.status === 'fulfilled' ? nstpResult.value?.data || [] : []);
      if (periodResult.status === 'rejected') throw periodResult.reason;
      if (curriculumResult.status === 'rejected') throw curriculumResult.reason;

      const periodResponse = periodResult.value;
      const activePeriod = periodResponse?.activeAcademicPeriod;
      if (!activePeriod?.schoolYear || !activePeriod?.semester) {
        throw new Error('No active academic period is configured. Open an academic period before enrolling students.');
      }
      const studentsResponse = await fetchApprovedStudents(activePeriod);
      setStudents(studentsResponse?.students || studentsResponse?.data || []);
      setForm((current) => ({
        ...current,
        schoolYear: activePeriod.schoolYear,
        semester: activePeriod.semester,
      }));
      await loadCandidates();
    } catch (error) {
      setResult({ status: 'Error', message: error.message || 'Enrollment data could not be loaded.' });
    } finally {
      setLoading(false);
    }
  }, [loadCandidates]);

  useEffect(() => { load(); }, [load]);

  const matchingCurricula = useMemo(
    () => {
      const selectedProgram = normalizeProgramIdentity(form.department);
      return curricula.filter((curriculum) =>
        [curriculum.programName, curriculum.programCode]
          .some((value) => normalizeProgramIdentity(value) === selectedProgram)
      );
    },
    [curricula, form.department]
  );
  const visibleStudents = useMemo(() => {
    const query = enrollmentSearch.trim().toLowerCase();
    return students.filter((student) => {
      if (sectionFilter && String(student.section || '') !== sectionFilter) return false;
      if (statusFilter && enrollmentDisplayStatus(student) !== statusFilter) return false;
      if (!query) return true;
      return [student.fullname, student.firstName, student.middleName, student.lastName, student.studentno, student.email, student.studentEmail, student.department, student.programCode, student.section, student.yearLevel]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [students, enrollmentSearch, sectionFilter, statusFilter]);
  const availableSections = useMemo(
    () => [...new Set(students.map((student) => String(student.section || '').trim()).filter(Boolean))].sort(),
    [students]
  );

  useEffect(() => {
    if (matchingCurricula.some((item) => String(item.curriculumId) === String(form.curriculumId))) return;
    setForm((current) => ({
      ...current,
      curriculumId: matchingCurricula[0]?.curriculumId ? String(matchingCurricula[0].curriculumId) : '',
    }));
  }, [matchingCurricula, form.curriculumId]);

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const validateContext = () => {
    if (!form.department) return 'Select an academic program.';
    if (!form.schoolYear || !form.semester) return 'No active academic period is configured. Open an academic period before enrolling students.';
    if (!/^\d{4}-\d{4}$/.test(form.schoolYear)) return 'School year must use YYYY-YYYY.';
    const [start, end] = form.schoolYear.split('-').map(Number);
    if (end !== start + 1) return 'School year must contain consecutive years.';
    if (!/^[1-4]$/.test(form.yearLevel)) return 'Year level must be from 1 to 4.';
    return '';
  };

  const enrollmentPayload = () => ({
    curriculumId: form.curriculumId || undefined,
    schoolYear: form.schoolYear,
    semester: form.semester,
    yearLevel: form.yearLevel,
    nstpOption: form.nstpOption || undefined,
  });

  const publishResult = useCallback((nextResult) => {
    setResult(nextResult);
    const isError = nextResult?.status === 'Error';
    const type = isError ? 'error' : Number(nextResult?.failed || 0) > 0 ? 'warning' : 'success';
    showSystemNotification(nextResult?.message || (isError ? 'The enrollment action failed.' : 'The enrollment action completed.'), type);
  }, []);

  const upload = async (mode) => {
    const validationError = validateContext();
    if (validationError) return publishResult({ status: 'Error', message: validationError });
    if (!file) return publishResult({ status: 'Error', message: 'Choose a CSV file first.' });

    setSaving(true); setResult(null);
    try {
      const response = mode === 'update'
        ? await registrarBulkUpdateStudents(file, form.department, enrollmentPayload())
        : await registrarBulkEnrollStudents(file, form.department, enrollmentPayload());
      publishResult(response);
      await load();
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      publishResult({ status: 'Error', message: error.message || 'Enrollment upload failed.' });
    } finally {
      setSaving(false);
    }
  };

  const enrollManualStudent = async (event) => {
    event.preventDefault();
    const validationError = validateContext();
    if (validationError) return publishResult({ status: 'Error', message: validationError });
    setSaving(true); setResult(null);
    try {
      const normalizedName = normalizeStudentNameFields(manualForm);
      const csv = buildCsvContent([
        ['First Name', 'Last Name', 'Middle Name', 'Sex', 'Birthdate', 'Email Address', 'Contact Number', 'Home Address'],
        [normalizedName.firstName, normalizedName.lastName, normalizedName.middleName, manualForm.sex, manualForm.birthdate, manualForm.email.trim(), manualForm.contactNumber.trim(), manualForm.homeAddress.trim()],
      ]);
      const manualFile = new File([csv], 'manual-student-enrollment.csv', { type: 'text/csv' });
      const response = await registrarBulkEnrollStudents(manualFile, form.department, enrollmentPayload());
      publishResult(response);
      setManualForm(emptyManualForm);
      await load();
    } catch (error) {
      publishResult({ status: 'Error', message: error.message || 'Student enrollment failed.' });
    } finally {
      setSaving(false);
    }
  };

  const enrollSelectedExistingStudent = async (event) => {
    event.preventDefault();
    const validationError = validateContext();
    if (validationError) return publishResult({ status: 'Error', message: validationError });
    if (!selectedExistingId) return publishResult({ status: 'Error', message: 'Select an existing Student account.' });
    setSaving(true); setResult(null);
    try {
      const response = await enrollExistingStudent(selectedExistingId, {
        program: form.department,
        yearLevel: form.yearLevel,
        curriculumId: form.curriculumId ? Number(form.curriculumId) : undefined,
        nstpOption: form.nstpOption || undefined,
      });
      publishResult(response);
      setSelectedExistingId('');
      await load();
    } catch (error) {
      publishResult({ status: 'Error', message: error.message || 'Existing Student enrollment failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleViewCurriculum = async (student) => {
    if (!student.curriculumId) return;
    setCurriculumView({ student, curriculum: null, error: '' });
    setCurriculumLoading(true);
    try {
      const response = await fetchCurriculum(student.curriculumId);
      setCurriculumView({ student, curriculum: response?.data || null, error: '' });
    } catch (error) {
      setCurriculumView({ student, curriculum: null, error: error.message || 'Unable to load the assigned curriculum.' });
    } finally {
      setCurriculumLoading(false);
    }
  };

  const loadCrossCurriculumData = useCallback(async (targetIds) => {
    if (typeof fetchCrossCurriculumOptions !== 'function') return;
    setCrossOptionsLoading(true);
    setCrossOptionsError('');
    try {
      const response = await fetchCrossCurriculumOptions(targetIds);
      const rows = Array.isArray(response?.data) ? response.data : [];
      setCrossOptions(rows);
      setCrossStudentContexts(Array.isArray(response?.students) ? response.students : []);
    } catch (error) {
      setCrossOptionsError(error.message || 'Unable to load cross-curriculum subject options.');
    } finally {
      setCrossOptionsLoading(false);
    }
  }, []);

  const openCrossCurriculumModal = useCallback(async (initialStudentIds = []) => {
    const normalizedIds = initialStudentIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
    setSelectedStudentIds(normalizedIds);
    setSourceProgramCode('');
    setSourceCurriculumId('');
    setSubjectSelections({});
    setCrossResult(null);
    setCrossModalOpen(true);
    await loadCrossCurriculumData(normalizedIds);
  }, [loadCrossCurriculumData]);

  const toggleStudentSelection = (studentId) => {
    const numericId = Number(studentId);
    setSelectedStudentIds((current) =>
      current.includes(numericId)
        ? current.filter((item) => item !== numericId)
        : [...current, numericId]
    );
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = visibleStudents.map((student) => Number(student.id)).filter((id) => id > 0);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedStudentIds.includes(id));
    if (allSelected) {
      setSelectedStudentIds((current) => current.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedStudentIds((current) => [...new Set([...current, ...visibleIds])]);
    }
  };

  const selectedStudentObjects = useMemo(
    () => students.filter((student) => selectedStudentIds.includes(Number(student.id))),
    [students, selectedStudentIds]
  );

  const crossSourcePrograms = useMemo(() => {
    const map = new Map();
    crossOptions.forEach((row) => {
      const key = row.programCode || row.programName;
      if (key && !map.has(key)) {
        map.set(key, {
          programId: row.programId,
          programCode: row.programCode || key,
          programName: row.programName || key,
        });
      }
    });
    return Array.from(map.values());
  }, [crossOptions]);

  useEffect(() => {
    if (!crossSourcePrograms.length) return;
    if (crossSourcePrograms.some((program) => program.programCode === sourceProgramCode)) return;
    const selectedHomePrograms = new Set(
      selectedStudentObjects.map((student) => normalizeProgramIdentity(student.programCode || student.department))
    );
    const differentProgram = crossSourcePrograms.find(
      (program) => !selectedHomePrograms.has(normalizeProgramIdentity(program.programCode)) &&
        !selectedHomePrograms.has(normalizeProgramIdentity(program.programName))
    );
    setSourceProgramCode((differentProgram || crossSourcePrograms[0]).programCode);
  }, [crossSourcePrograms, sourceProgramCode, selectedStudentObjects]);

  const crossCurriculumsForProgram = useMemo(() => {
    const map = new Map();
    crossOptions
      .filter((row) => !sourceProgramCode || row.programCode === sourceProgramCode || row.programName === sourceProgramCode)
      .forEach((row) => {
        const key = String(row.curriculumId);
        if (!map.has(key)) {
          map.set(key, {
            curriculumId: String(row.curriculumId),
            curriculumName: row.curriculumName,
            curriculumVersion: row.curriculumVersion,
            programCode: row.programCode,
            programName: row.programName,
          });
        }
      });
    return Array.from(map.values());
  }, [crossOptions, sourceProgramCode]);

  useEffect(() => {
    if (crossCurriculumsForProgram.some((item) => item.curriculumId === String(sourceCurriculumId))) return;
    setSourceCurriculumId(crossCurriculumsForProgram[0]?.curriculumId || '');
  }, [crossCurriculumsForProgram, sourceCurriculumId]);

  const crossSubjectsForCurriculum = useMemo(() => {
    const map = new Map();
    crossOptions
      .filter((row) => String(row.curriculumId) === String(sourceCurriculumId))
      .forEach((row) => {
        const key = String(row.subjectId);
        if (!map.has(key)) {
          map.set(key, {
            subjectId: Number(row.subjectId),
            subjectCode: row.subjectCode,
            subjectTitle: row.subjectTitle,
            units: row.units,
            prerequisite: row.prerequisite || '',
            yearLevel: row.yearLevel,
            semester: row.semester,
            programCode: row.programCode,
            programName: row.programName,
            curriculumId: row.curriculumId,
            curriculumName: row.curriculumName,
            curriculumVersion: row.curriculumVersion,
            teachingSections: [],
          });
        }
        if (row.facultySectionId) {
          const entry = map.get(key);
          if (!entry.teachingSections.some((sec) => sec.facultySectionId === Number(row.facultySectionId))) {
            entry.teachingSections.push({
              facultySectionId: Number(row.facultySectionId),
              section: row.section || 'Section',
              schedule: row.schedule || '',
              facultyName: row.facultyName || 'Assigned Faculty',
            });
          }
        }
      });
    return Array.from(map.values());
  }, [crossOptions, sourceCurriculumId]);

  const toggleCrossSubject = (subject) => {
    const key = String(subject.subjectId);
    setSubjectSelections((current) => {
      if (current[key]) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return {
        ...current,
        [key]: {
          subjectId: subject.subjectId,
          subjectCode: subject.subjectCode,
          subjectTitle: subject.subjectTitle,
          prerequisite: subject.prerequisite || '',
          sourceProgramCode: subject.programCode,
          sourceProgramName: subject.programName,
          sourceCurriculumName: subject.curriculumName,
          sourceCurriculumVersion: subject.curriculumVersion,
          facultySectionId: subject.teachingSections[0]?.facultySectionId || '',
          overrideReason: '',
        },
      };
    });
  };

  const updateCrossSubjectField = (subjectId, field, value) => {
    const key = String(subjectId);
    setSubjectSelections((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [field]: value,
      },
    }));
  };

  const selectedCrossSubjectList = useMemo(
    () => Object.values(subjectSelections),
    [subjectSelections]
  );

  const handleAssignCrossCurriculumSubjects = async () => {
    if (selectedStudentIds.length === 0) {
      setCrossOptionsError('Select at least one student.');
      return;
    }
    if (selectedCrossSubjectList.length === 0) {
      setCrossOptionsError('Select at least one cross-curriculum subject.');
      return;
    }
    for (const item of selectedCrossSubjectList) {
      if (!item.facultySectionId) {
        setCrossOptionsError(`Select a valid current-period Faculty teaching section for ${item.subjectCode}.`);
        return;
      }
      if (hasPrerequisiteRequirement(item.prerequisite) && !String(item.overrideReason || '').trim()) {
        setCrossOptionsError(`${item.subjectCode} requires prerequisite '${item.prerequisite}'. Enter a Prerequisite Override Reason.`);
        return;
      }
    }

    setCrossAssigning(true);
    setCrossOptionsError('');
    setCrossResult(null);
    try {
      const payload = selectedCrossSubjectList.map((item) => ({
        subjectId: Number(item.subjectId),
        facultySectionId: Number(item.facultySectionId),
        overrideReason: String(item.overrideReason || '').trim() || undefined,
      }));
      const response = await assignCrossCurriculumSubjects(selectedStudentIds, payload);
      setCrossResult(response);
      if (response?.assignedCount > 0 || response?.status === 'Success') {
        setSubjectSelections({});
        await load();
        await loadCrossCurriculumData(selectedStudentIds);
      }
    } catch (error) {
      setCrossOptionsError(error.message || 'Cross-curriculum subject assignment failed.');
    } finally {
      setCrossAssigning(false);
    }
  };

  const handleRemoveCrossSubject = async (studentId, subjectId) => {
    if (typeof removeNonRegularSubject !== 'function') return;
    setCrossAssigning(true);
    setCrossOptionsError('');
    try {
      await removeNonRegularSubject(studentId, subjectId);
      await load();
      await loadCrossCurriculumData(selectedStudentIds);
    } catch (error) {
      setCrossOptionsError(error.message || 'Unable to remove cross-curriculum subject.');
    } finally {
      setCrossAssigning(false);
    }
  };

  const downloadTemplate = () => {
    downloadCsvFile(buildCsvContent([
      ['First Name', 'Last Name', 'Middle Name', 'Sex', 'Birthdate', 'Email Address', 'Contact Number', 'Home Address'],
      ['Juan', 'Dela Cruz', 'Andres', 'Male', '05/15/2005', 'juan.delacruz@plv.edu.ph', '09123456789', 'Valenzuela City'],
    ]), `student-enrollment-${form.schoolYear}.csv`);
  };

  return (
    <div className="w-full min-w-0 space-y-4">
      <div>
        <div><h3 className="text-xl font-bold text-[#003366]">Student Enrollment</h3></div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-bold text-[#003366]">Enrollment Setup</h3>

        <div data-testid="enrollment-setup-controls" className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-semibold text-slate-700">Academic Program
            <select value={form.department} onChange={(event) => updateField('department', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-normal">
              {programs.map((program) => <option key={program} value={program}>{program}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">Active Academic Period
            <input aria-label="Active Academic Period" value={form.schoolYear && form.semester ? `${form.schoolYear} · ${form.semester}` : 'Not configured'} readOnly className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 text-xs font-normal text-slate-600" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Year Level
            <select value={form.yearLevel} onChange={(event) => updateField('yearLevel', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-normal">
              {[1, 2, 3, 4].map((year) => <option key={year} value={year}>{year}{year === 1 ? 'st' : year === 2 ? 'nd' : year === 3 ? 'rd' : 'th'} Year</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">Curriculum Version
            <select value={form.curriculumId} onChange={(event) => updateField('curriculumId', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-normal">
              <option value="">Latest published version (automatic)</option>
              {matchingCurricula.map((curriculum) => <option key={curriculum.curriculumId} value={curriculum.curriculumId}>{curriculum.curriculumVersion} · {curriculum.curriculumName}</option>)}
            </select>
          </label>
          {nstpOptions.length ? <label className="text-xs font-semibold text-slate-700">NSTP Program
            <select value={form.nstpOption} onChange={(event) => updateField('nstpOption', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-normal">
              <option value="">Select later</option>
              {nstpOptions.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
            </select>
          </label> : null}
        </div>

        {matchingCurricula.length === 0 ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">No published curriculum exists for this program yet. Enrollment can continue, but the Registrar must assign a published version later.</p> : null}
      </section>

      {result ? <section className={`rounded-xl border p-4 text-sm ${result.status === 'Error' || result.failed > 0 ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}><p className="font-bold">{result.status || 'Result'}</p><p>{result.message}</p>{typeof result.successful !== 'undefined' ? <p className="mt-1">Successful: {result.successful} · Failed: {result.failed || 0}</p> : null}{result.errors?.length ? <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5">{result.errors.slice(0, 20).map((item, index) => <li key={`${item.row || index}-${item.identifier || ''}`}>Row {item.row || '?'} ({item.identifier || 'Unknown'}): {item.reason}</li>)}</ul> : null}</section> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h4 className="text-sm font-bold text-[#003366]">Enrollment Method</h4>
        <div className="mt-3 flex flex-wrap border-b border-slate-200">
          <button type="button" onClick={() => setEnrollmentMethod('bulk')} className={`border-b-2 px-5 py-2 text-xs font-bold transition ${enrollmentMethod === 'bulk' ? 'border-blue-700 bg-blue-50 text-blue-700' : 'border-transparent text-slate-500 hover:text-[#003366]'}`}>⇧ &nbsp; Bulk Upload</button>
          <button type="button" onClick={() => setEnrollmentMethod('manual')} className={`border-b-2 px-5 py-2 text-xs font-bold transition ${enrollmentMethod === 'manual' ? 'border-blue-700 bg-blue-50 text-blue-700' : 'border-transparent text-slate-500 hover:text-[#003366]'}`}>♙ &nbsp; New Student</button>
          <button type="button" onClick={() => setEnrollmentMethod('existing')} className={`border-b-2 px-5 py-2 text-xs font-bold transition ${enrollmentMethod === 'existing' ? 'border-blue-700 bg-blue-50 text-blue-700' : 'border-transparent text-slate-500 hover:text-[#003366]'}`}>Existing Student</button>
        </div>

        {enrollmentMethod === 'bulk' ? <div>
          <label className="mt-4 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-blue-300 bg-blue-50/30 p-4 text-center text-xs font-semibold text-blue-700">
            <span>Drag and drop your file here, or click to browse</span>
            <span className="mt-1 text-[10px] font-normal text-slate-500">Accepted file type: CSV (less than 10 MB)</span>
            <input ref={fileInputRef} aria-label="Enrollment CSV file" type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)} className="sr-only" />
            {file ? <span className="mt-2 text-emerald-700">{file.name}</span> : null}
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={downloadTemplate} className={downloadTemplateButtonClass}>Download Template</button>
            <button type="button" disabled={saving} onClick={() => upload('enroll')} className="h-10 rounded-xl bg-[#003366] px-5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Upload & Prepare'}</button>
          </div>
        </div> : enrollmentMethod === 'manual' ? <form onSubmit={enrollManualStudent} className="pt-4">
          <div className="mb-4 flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-lg text-blue-700">♙</span><div><h5 className="text-sm font-bold text-[#003366]">Manual Student Enrollment</h5></div></div>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <h6 className="bg-slate-50 px-4 py-3 text-xs font-bold text-[#003366]">Student Information</h6>
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {[
                ['firstName', 'First Name', 'Enter first name', true, 'text'],
                ['lastName', 'Last Name', 'Enter last name', true, 'text'],
                ['middleName', 'Middle Name', 'Enter middle name (optional)', false, 'text'],
                ['birthdate', 'Birthdate', 'Select birthdate', true, 'date'],
                ['email', 'Email Address', 'e.g. student@plv.edu.ph', true, 'email'],
                ['contactNumber', 'Contact Number', 'Enter contact number', true, 'tel'],
              ].map(([field, label, placeholder, required, type]) => <label key={field} className="text-[10px] font-semibold text-slate-700">{label}{required && <span className="text-red-500"> *</span>}<input required={required} type={type} value={manualForm[field]} onChange={(event) => setManualForm((current) => ({ ...current, [field]: event.target.value }))} placeholder={placeholder} className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-3 text-xs font-normal outline-none focus:border-blue-600" /></label>)}
              <label className="text-[10px] font-semibold text-slate-700">Sex <span className="text-red-500"> *</span><select required value={manualForm.sex} onChange={(event) => setManualForm((current) => ({ ...current, sex: event.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-3 text-xs font-normal"><option value="">Select sex</option><option value="Male">Male</option><option value="Female">Female</option></select></label>
              <label className="text-[10px] font-semibold text-slate-700 md:col-span-2 xl:col-span-3">Home Address <span className="text-red-500">*</span><textarea required value={manualForm.homeAddress} onChange={(event) => setManualForm((current) => ({ ...current, homeAddress: event.target.value }))} placeholder="Enter complete home address" rows="2" className="mt-1 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-xs font-normal outline-none focus:border-blue-600" /></label>
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 p-4"><button type="button" onClick={() => setManualForm(emptyManualForm)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600">Cancel</button><button disabled={saving || loading} className="rounded-lg bg-[#003366] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : '♙  Save Student'}</button></div>
          </div>
        </form> : <form onSubmit={enrollSelectedExistingStudent} className="space-y-4 pt-4">
          <div><h5 className="text-sm font-bold text-[#003366]">Enroll an Existing Student</h5><p className="mt-1 text-xs text-slate-500">Reuse the Student ID and account. A new enrollment will be created for the active period without copying a previous section.</p></div>
          <BoundedSelect
            label="Existing Student"
            value={selectedExistingId}
            onChange={setSelectedExistingId}
            onSearch={loadCandidates}
            searchable
            options={existingCandidates.map((student) => ({
              value: student.id,
              label: `${student.studentNo} · ${student.fullName}${student.email ? ` · ${student.email}` : ''}${student.alreadyEnrolled ? ' · Already enrolled' : ''}`,
              disabled: student.alreadyEnrolled,
            }))}
            className="max-w-2xl"
          />
          <button type="submit" disabled={saving || loading || !selectedExistingId} className="rounded-lg bg-[#003366] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{saving ? 'Enrolling…' : 'Enroll Existing Student'}</button>
        </form>}
      </section>

      <section data-testid="student-enrollment-list" className="w-full min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 [&_table]:w-full">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-700 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700 dark:bg-sky-950/60 dark:text-sky-300"><EnrollmentUsersIcon /></span>
              <div>
                <h4 className="text-sm font-bold text-[#003366] dark:text-sky-300">Current Student Enrollments</h4>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">View and manage students enrolled for {form.schoolYear && form.semester ? `${form.schoolYear} · ${form.semester}` : 'the active academic period'}</p>
              </div>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{students.length} {students.length === 1 ? 'Student' : 'Students'}</span>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <SearchField value={enrollmentSearch} onChange={setEnrollmentSearch} label="Search student enrollments" placeholder="Search by name or student number..." className="w-full min-w-0 flex-1 sm:min-w-[15rem] sm:max-w-md" inputClassName="h-10 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            <label className="w-full text-xs font-semibold text-slate-600 dark:text-slate-300 sm:w-auto sm:min-w-[10rem]">Section
              <select aria-label="Filter enrollments by section" value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">All Sections</option>
                {availableSections.map((section) => <option key={section} value={section}>{section}</option>)}
              </select>
            </label>
            <label className="w-full text-xs font-semibold text-slate-600 dark:text-slate-300 sm:w-auto sm:min-w-[10rem]">Status
              <select aria-label="Filter enrollments by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">All Statuses</option><option value="Regular">Regular</option><option value="Irregular">Irregular</option><option value="Not Sectioned">Not Sectioned</option>
              </select>
            </label>
            <button type="button" onClick={load} className="h-10 w-full rounded-lg border border-blue-200 px-4 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/50 sm:w-auto">Refresh</button>
          </div>
          {selectedStudentIds.length > 0 ? <div data-testid="student-selection-action-bar" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
            <span className="font-bold">✓ {selectedStudentIds.length} {selectedStudentIds.length === 1 ? 'student' : 'students'} selected</span>
            <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setSelectedStudentIds([])} className="rounded-lg px-3 py-2 font-semibold text-blue-700 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-sky-300 dark:hover:bg-sky-900/50">Clear</button><button type="button" data-testid="open-cross-curriculum-modal" onClick={() => openCrossCurriculumModal(selectedStudentIds)} className="rounded-lg bg-[#003366] px-3 py-2 font-bold text-white transition hover:bg-[#00264d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">+ Add Cross-Curriculum Subjects</button></div>
          </div> : null}
        </div>
        {loading ? <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading student enrollments...</p> : students.length === 0 ? <div className="flex flex-col items-center px-4 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300"><EnrollmentUsersIcon className="h-6 w-6" /></span>
          <h5 className="mt-4 text-base font-bold text-[#003366] dark:text-sky-300">No students enrolled yet</h5>
          <p className="mt-1 max-w-lg text-sm text-slate-500 dark:text-slate-400">Students enrolled under {form.department || 'the selected program'} for {form.schoolYear && form.semester ? `${form.schoolYear} · ${form.semester}` : 'the active academic period'} will appear here.</p>
          <button type="button" onClick={() => setEnrollmentMethod('manual')} className="mt-5 rounded-lg bg-[#003366] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#00264d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Enroll New Student</button>
        </div> : visibleStudents.length === 0 ? <div className="px-4 py-12 text-center"><h5 className="text-sm font-bold text-slate-700 dark:text-slate-200">No matching students found.</h5><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Try changing the search, section, or status filters.</p></div> : <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[780px] table-fixed text-left text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all visible students"
                    checked={visibleStudents.length > 0 && visibleStudents.every((s) => selectedStudentIds.includes(Number(s.id)))}
                    onChange={toggleSelectAllVisible}
                  />
                </th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Program / Year Level</th>
                <th className="px-4 py-3">Section</th>
                <th className="px-4 py-3">Academic Period</th>
                <th className="px-4 py-3">Assigned Curriculum</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.map((student) => {
                const displayStatus = enrollmentDisplayStatus(student);
                const isSelected = selectedStudentIds.includes(Number(student.id));
                const crossSubjectCount = crossCurriculumSubjectCount(student);
                const statusClass = displayStatus === 'Irregular'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  : displayStatus === 'Not Sectioned'
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300';
                return (
                  <tr key={student.id} className="border-b border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${student.fullname}`}
                        checked={isSelected}
                        onChange={() => toggleStudentSelection(student.id)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className="block font-semibold text-slate-900 dark:text-slate-100">{student.fullname}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{student.studentno}</span>
                    </td>
                    <td className="break-words px-4 py-3">
                      <span className="font-medium">{student.programCode || student.department || 'Unassigned'}</span>
                      <span className="text-slate-400"> · </span>
                      <span>{formatYearLevel(student.yearLevel)}</span>
                    </td>
                    <td className="px-4 py-3">{student.section || 'Not sectioned'}</td>
                    <td className="px-4 py-3">
                      {student.schoolYear || '—'}
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{student.semester || '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {student.curriculumId ? (
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{student.curriculumName || 'Assigned curriculum'}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Version: {student.curriculumVersion || '—'}</p>
                          <button type="button" onClick={() => handleViewCurriculum(student)} className="mt-2 rounded-lg border border-[#003366] px-3 py-1.5 font-semibold text-[#003366] transition hover:bg-[#003366] hover:text-white dark:border-sky-300 dark:text-sky-300 dark:hover:bg-sky-300 dark:hover:text-slate-950">View Curriculum</button>
                        </div>
                      ) : (
                        <span className="font-medium text-slate-500 dark:text-slate-400">Not assigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        data-testid={`student-irregular-badge-${student.id}`}
                        className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass}`}
                      >
                        {displayStatus}
                      </span>
                      {displayStatus === 'Irregular' && crossSubjectCount > 0 ? <span className="mt-1 block text-[10px] font-semibold text-slate-500 dark:text-slate-400">+{crossSubjectCount} {crossSubjectCount === 1 ? 'Subject' : 'Subjects'}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>}
      </section>

      <Modal
        isOpen={Boolean(curriculumView)}
        onClose={() => setCurriculumView(null)}
        title="Assigned Curriculum"
        description={curriculumView ? `${curriculumView.student.studentno || 'Student'} · ${curriculumView.student.fullname || ''} · ${curriculumView.student.schoolYear || 'Current enrollment'} ${curriculumView.student.semester || ''}` : ''}
        panelClassName="flex max-h-[90vh] max-w-6xl flex-col overflow-hidden p-4 sm:p-6"
        bodyClassName="min-h-0 flex-1 overflow-y-auto pr-1"
      >
        {curriculumView?.error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">{curriculumView.error}</div> : <CurriculumViewer curricula={curriculumView?.curriculum ? [curriculumView.curriculum] : []} currentYear={Number.parseInt(curriculumView?.student?.yearLevel, 10) || 0} loading={curriculumLoading} emptyMessage="No curriculum assigned" showInternalMetadata />}
      </Modal>

      <Modal
        isOpen={crossModalOpen}
        onClose={() => { if (!crossAssigning) setCrossModalOpen(false); }}
        title="Add Cross-Curriculum Subjects"
        description="Assign subjects from another Chairperson's published curriculum to one or multiple enrolled students. Valid assignments automatically mark the student as Irregular while preserving their home program."
        panelClassName="flex max-h-[92vh] max-w-5xl flex-col overflow-hidden p-4 sm:p-6"
        bodyClassName="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1"
      >
        <div className="space-y-4" data-testid="cross-curriculum-modal-body">
          {/* Step 1: Selected Students & Active Period */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h5 className="text-xs font-bold uppercase tracking-wide text-[#003366] dark:text-sky-300">
                1. Selected Student(s) ({selectedStudentObjects.length})
              </h5>
              <span className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200">
                Active Period: {form.schoolYear && form.semester ? `${form.schoolYear} · ${form.semester}` : 'Current Period'}
              </span>
            </div>
            {selectedStudentObjects.length === 0 ? (
              <p className="mt-2 text-xs text-amber-800">Select at least one student below.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedStudentObjects.map((student) => (
                  <span key={student.id} className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                    <span>{student.studentno} · {student.fullname}</span>
                    <span className="text-[10px] text-slate-500">({student.department || 'Home Program'})</span>
                  </span>
                ))}
              </div>
            )}
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-semibold text-blue-700 dark:text-sky-300">
                Select / Deselect Multiple Students ({students.length} enrolled)
              </summary>
              <div className="mt-2 grid max-h-36 gap-1.5 overflow-y-auto rounded border border-slate-200 bg-white p-2 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-900">
                {students.map((student) => (
                  <label key={`modal-student-${student.id}`} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedStudentIds.includes(Number(student.id))}
                      onChange={async () => {
                        const id = Number(student.id);
                        const next = selectedStudentIds.includes(id)
                          ? selectedStudentIds.filter((item) => item !== id)
                          : [...selectedStudentIds, id];
                        setSelectedStudentIds(next);
                        await loadCrossCurriculumData(next);
                      }}
                    />
                    <span>{student.studentno} · {student.fullname} ({student.department})</span>
                  </label>
                ))}
              </div>
            </details>
          </div>

          {/* Step 2 & 3: Source Program / Department & Published Curriculum */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              2. Source Program / Department
              <select
                aria-label="Source Program / Department"
                value={sourceProgramCode}
                onChange={(event) => {
                  setSourceProgramCode(event.target.value);
                  setSourceCurriculumId('');
                }}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-normal dark:border-slate-600 dark:bg-slate-800"
              >
                {crossSourcePrograms.length === 0 ? <option value="">No published programs available</option> : null}
                {crossSourcePrograms.map((program) => (
                  <option key={program.programCode} value={program.programCode}>
                    {program.programCode} — {program.programName}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              3. Source Published Curriculum
              <select
                aria-label="Source Published Curriculum"
                value={sourceCurriculumId}
                onChange={(event) => setSourceCurriculumId(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-normal dark:border-slate-600 dark:bg-slate-800"
              >
                {crossCurriculumsForProgram.length === 0 ? <option value="">No published curriculum available</option> : null}
                {crossCurriculumsForProgram.map((curriculum) => (
                  <option key={curriculum.curriculumId} value={curriculum.curriculumId}>
                    {curriculum.curriculumVersion} · {curriculum.curriculumName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Step 4: Select One or Multiple Subjects */}
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <h5 className="text-xs font-bold uppercase tracking-wide text-[#003366] dark:text-sky-300">
              4. Select Cross-Curriculum Subject(s) & Teaching Assignment
            </h5>
            {crossOptionsLoading ? (
              <p className="mt-2 text-xs text-slate-500">Loading published cross-curriculum subjects...</p>
            ) : crossSubjectsForCurriculum.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">No subjects found in this curriculum for the active semester.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {crossSubjectsForCurriculum.map((subject) => {
                  const selected = Boolean(subjectSelections[String(subject.subjectId)]);
                  const currentSelection = subjectSelections[String(subject.subjectId)] || {};
                  const needsOverrideReason = hasPrerequisiteRequirement(subject.prerequisite);
                  return (
                    <div
                      key={subject.subjectId}
                      className={`rounded-lg border p-3 text-xs ${
                        selected
                          ? 'border-blue-400 bg-blue-50/40 dark:border-sky-500 dark:bg-sky-950/30'
                          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                          <input
                            type="checkbox"
                            aria-label={`Select subject ${subject.subjectCode}`}
                            checked={selected}
                            onChange={() => toggleCrossSubject(subject)}
                          />
                          <span>{subject.subjectCode} — {subject.subjectTitle}</span>
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {subject.units} units · Year {subject.yearLevel}
                          </span>
                        </label>
                        {needsOverrideReason ? (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            Prerequisite: {subject.prerequisite}
                          </span>
                        ) : (
                          <span className="text-[10px] text-emerald-700">No prerequisite</span>
                        )}
                      </div>

                      {selected ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                            Current-Period Faculty Teaching Section *
                            <select
                              aria-label={`Teaching section for ${subject.subjectCode}`}
                              value={currentSelection.facultySectionId || ''}
                              onChange={(event) => updateCrossSubjectField(subject.subjectId, 'facultySectionId', event.target.value)}
                              className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs font-normal dark:border-slate-600 dark:bg-slate-800"
                            >
                              <option value="">Select teaching section</option>
                              {subject.teachingSections.map((sec) => (
                                <option key={sec.facultySectionId} value={sec.facultySectionId}>
                                  {sec.section} · {sec.facultyName}{sec.schedule ? ` (${sec.schedule})` : ''}
                                </option>
                              ))}
                            </select>
                            {subject.teachingSections.length === 0 ? (
                              <span className="mt-1 block text-[11px] text-red-600">
                                No active Faculty teaching section exists for {subject.subjectCode} in the current period.
                              </span>
                            ) : null}
                          </label>

                          {needsOverrideReason ? (
                            <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                              Prerequisite Override Reason ({subject.prerequisite}) *
                              <input
                                type="text"
                                aria-label={`Override reason for ${subject.subjectCode}`}
                                value={currentSelection.overrideReason || ''}
                                onChange={(event) => updateCrossSubjectField(subject.subjectId, 'overrideReason', event.target.value)}
                                placeholder="Mandatory reason for prerequisite override"
                                className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs font-normal dark:border-slate-600 dark:bg-slate-800"
                              />
                            </label>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Step 5: Review Selection Summary */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800" data-testid="cross-curriculum-review-summary">
            <h5 className="font-bold uppercase tracking-wide text-[#003366] dark:text-sky-300">
              5. Review Selection Summary
            </h5>
            <p className="mt-1 text-slate-600 dark:text-slate-300">
              Students: <strong>{selectedStudentObjects.length}</strong> · Subjects Selected: <strong>{selectedCrossSubjectList.length}</strong> · Auto-Irregular: <strong>Enabled</strong>
            </p>
            {selectedCrossSubjectList.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-slate-700 dark:text-slate-200">
                {selectedCrossSubjectList.map((item) => (
                  <li key={`review-${item.subjectId}`}>
                    <strong>{item.subjectCode}</strong> ({item.subjectTitle}) — Source: {item.sourceProgramCode} ({item.sourceCurriculumVersion})
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {/* Existing Cross-Curriculum Subjects for Single Student */}
          {crossStudentContexts.some((ctx) => Array.isArray(ctx.existing) && ctx.existing.length > 0) ? (
            <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700">
              <h5 className="font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                Existing Active Cross-Curriculum Subjects
              </h5>
              <div className="mt-2 space-y-1.5">
                {crossStudentContexts.flatMap((ctx) =>
                  (ctx.existing || []).map((item) => (
                    <div key={`${ctx.id}-${item.subjectId}`} className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900">
                      <span>
                        <strong>{ctx.studentNo}</strong> · {item.subjectCode} ({item.subjectTitle}) — {item.programCode} · {item.section}
                      </span>
                      <button
                        type="button"
                        disabled={crossAssigning}
                        onClick={() => handleRemoveCrossSubject(ctx.id, item.subjectId)}
                        className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {crossOptionsError ? (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
              {crossOptionsError}
            </div>
          ) : null}

          {crossResult ? (
            <div
              data-testid="cross-curriculum-result"
              className={`rounded-lg border p-3 text-xs ${
                crossResult.status === 'Error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : crossResult.status === 'PartialSuccess'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900'
              }`}
            >
              <p className="font-bold">{crossResult.message || crossResult.status}</p>
              {Array.isArray(crossResult.results) && crossResult.results.length > 0 ? (
                <ul className="mt-2 list-disc pl-5">
                  {crossResult.results.map((item) => (
                    <li key={`res-${item.studentUserId}`}>
                      {item.studentNo || `Student #${item.studentUserId}`} ({item.studentName || item.homeProgram}):{' '}
                      {item.success
                        ? `Assigned ${item.assignedCount} subject(s) · Marked Irregular`
                        : item.error || 'Validation failed'}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
            <button
              type="button"
              disabled={crossAssigning}
              onClick={() => setCrossModalOpen(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 dark:border-slate-600 dark:text-slate-200"
            >
              Close
            </button>
            <button
              type="button"
              disabled={crossAssigning || selectedStudentIds.length === 0 || selectedCrossSubjectList.length === 0}
              onClick={handleAssignCrossCurriculumSubjects}
              className="rounded-lg bg-[#003366] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {crossAssigning ? 'Assigning…' : 'Assign Cross-Curriculum Subjects'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default StudentEnrollmentManagement;
