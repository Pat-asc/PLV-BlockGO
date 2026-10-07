import { requestSystemConfirmation } from '../../services/SystemDialogContext';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addCurriculumSubject, bulkImportCurriculumSubjects, createCurriculum, fetchAcademicPrograms, fetchAssignedCurriculum, fetchCurriculums, removeCurriculumSubject, removeCurriculumSubjects, submitCurriculum, updateCurriculum, updateCurriculumSubject } from '../../services/api';

const emptyCurriculum = { programCode: '', curriculumCode: '', curriculumName: '', curriculumVersion: '', schoolYear: '' };
const emptySubject = { subjectCode: '', subjectTitle: '', units: 3, lectureHours: 3, laboratoryHours: 0, prerequisite: '', yearLevel: 1, semester: 'FIRST', subjectType: '' };
const years = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' };
const semesters = { FIRST: '1st Semester', SECOND: '2nd Semester', MIDYEAR: 'Summer / Midyear' };
const inputClass = 'mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100';
const localCurriculumKey = 'blockgo-local-chairperson-curriculum';
const itProgramCode = 'BSIT';
const itDepartmentNames = new Set([
  'bsit',
  'bs information technology',
  'bachelor of science in information technology',
  'it department',
  'information technology department',
  'department of information technology',
]);

const CurriculumBuilder = ({ department = '' }) => {
  const normalizedDepartment = department.trim().toLowerCase();
  const isItDepartment = itDepartmentNames.has(normalizedDepartment);
  const [curricula, setCurricula] = useState([]);
  const [assignedCurriculum, setAssignedCurriculum] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [curriculumForm, setCurriculumForm] = useState(() => ({
    ...emptyCurriculum,
    programCode: isItDepartment ? itProgramCode : '',
  }));
  const [subjectForm, setSubjectForm] = useState(emptySubject);
  const [editingId, setEditingId] = useState(null);
  const [mode, setMode] = useState('manual');
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [semesterFilter, setSemesterFilter] = useState('all');
  const [selectedSubjectIds, setSelectedSubjectIds] = useState([]);
  const [subjectError, setSubjectError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [preview, setPreview] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [prerequisiteOpen, setPrerequisiteOpen] = useState(false);
  const [prerequisiteSearch, setPrerequisiteSearch] = useState('');
  const fileRef = useRef(null);
  const isLocalMode = localStorage.getItem('token')?.endsWith('.local-dev');

  const saveLocalCurriculum = (curriculum) => {
    localStorage.setItem(localCurriculumKey, JSON.stringify(curriculum));
    setCurricula([curriculum]);
    setSelectedId(String(curriculum.curriculumId));
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [programResult, curriculumResult] = await Promise.all([fetchAcademicPrograms(), fetchCurriculums()]);
      const allPrograms = Array.isArray(programResult?.data) ? programResult.data : [];
      const allCurricula = Array.isArray(curriculumResult?.data) ? curriculumResult.data : [];
      const owned = normalizedDepartment ? allPrograms.filter((item) => item.programName.toLowerCase() === normalizedDepartment || item.programCode.toLowerCase() === normalizedDepartment) : allPrograms;
      const assignedProgramCode = isItDepartment ? itProgramCode : owned[0]?.programCode;
      const assignedResult = assignedProgramCode ? await fetchAssignedCurriculum(assignedProgramCode) : { data: null };
      const assignment = assignedResult?.data || null;
      const assigned = assignment?.curriculum || null;
      const editableDraft = allCurricula.find((item) => ['DRAFT', 'RETURNED'].includes(item.status));
      setCurricula(allCurricula);
      setAssignedCurriculum(assignment);
      setSelectedId((current) => current === null ? null : String(assigned?.curriculumId || editableDraft?.curriculumId || ''));
      setCurriculumForm((current) => ({
        ...current,
        programCode: isItDepartment
          ? itProgramCode
          : owned.some((item) => item.programCode === current.programCode)
            ? current.programCode
            : owned[0]?.programCode || '',
      }));
    } catch (error) {
      if (isLocalMode) {
        const saved = JSON.parse(localStorage.getItem(localCurriculumKey) || 'null');
        const fallbackCurriculum = saved || { curriculumId: 'local-draft', programCode: 'BSIT', curriculumCode: 'BSIT-2026', curriculumName: 'BSIT Curriculum 2026', curriculumVersion: '1.0', schoolYear: '2025-2026', status: 'DRAFT', subjects: [], totalUnits: 0 };
        setCurricula([fallbackCurriculum]); setAssignedCurriculum(null); setSelectedId(String(fallbackCurriculum.curriculumId));
        setCurriculumForm((current) => ({ ...current, programCode: 'BSIT' }));
        setNotice({ type: 'success', message: 'Local curriculum workspace loaded.' });
      } else setNotice({ type: 'error', message: error.message });
    }
    finally { setLoading(false); }
  }, [isItDepartment, isLocalMode, normalizedDepartment]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setSelectedSubjectIds([]);
    setEditingId(null);
    setSubjectError('');
  }, [selectedId]);

  const selected = curricula.find((item) => String(item.curriculumId) === String(selectedId));
  const editable = selected && ['DRAFT', 'RETURNED'].includes(selected.status);
  const subjects = useMemo(() => selected?.subjects || [], [selected]);
  const visibleSubjects = subjects.filter((item) =>
    `${item.subjectCode} ${item.subjectTitle}`.toLowerCase().includes(search.toLowerCase()) &&
    (yearFilter === 'all' || String(item.yearLevel) === yearFilter) &&
    (semesterFilter === 'all' || item.semester === semesterFilter));
  const totalUnits = subjects.reduce((sum, item) => sum + Number(item.units || 0), 0);
  const prerequisiteOptions = subjects.filter((item) => item.subjectId !== editingId && (Number(item.yearLevel) < Number(subjectForm.yearLevel) || (Number(item.yearLevel) === Number(subjectForm.yearLevel) && item.semester === 'FIRST' && subjectForm.semester !== 'FIRST')));
  const selectedPrerequisites = subjectForm.prerequisite ? subjectForm.prerequisite.split(';').map((item) => item.trim()).filter(Boolean) : [];
  const filteredPrerequisites = prerequisiteOptions.filter((item) => `${item.subjectCode} ${item.subjectTitle}`.toLowerCase().includes(prerequisiteSearch.toLowerCase()));
  const togglePrerequisite = (code) => {
    const next = selectedPrerequisites.includes(code) ? selectedPrerequisites.filter((item) => item !== code) : [...selectedPrerequisites, code];
    setSubjectForm((current) => ({ ...current, prerequisite: next.join('; ') }));
  };
  const updateSelected = (field, value) => setCurricula((current) => current.map((item) => item.curriculumId === selected.curriculumId ? { ...item, [field]: value } : item));

  const startNewCurriculum = () => {
    setSelectedId(null);
    setCurriculumForm({
      ...emptyCurriculum,
      programCode: isItDepartment ? itProgramCode : curriculumForm.programCode,
    });
    setSubjectForm(emptySubject);
    setEditingId(null);
    setSelectedSubjectIds([]);
    setSubjectError('');
    setUploadName('');
    setIsDraggingFile(false);
    setPrerequisiteOpen(false);
    setPrerequisiteSearch('');
    setPreview(false);
    setNotice(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const create = async (event) => {
    event.preventDefault(); setSaving(true); setNotice(null);
    try { const result = await createCurriculum(curriculumForm); await load(); setSelectedId(String(result?.data?.curriculumId || '')); setNotice({ type: 'success', message: 'Curriculum created.' }); }
    catch (error) { setNotice({ type: 'error', message: error.message }); }
    finally { setSaving(false); }
  };

  const saveMetadata = async () => {
    if (!selected) return; setSaving(true); setNotice(null);
    if (isLocalMode) { saveLocalCurriculum(selected); setNotice({ type: 'success', message: 'Changes saved locally.' }); setSaving(false); return; }
    try { await updateCurriculum(selected.curriculumId, { curriculumCode: selected.curriculumCode, curriculumName: selected.curriculumName, curriculumVersion: selected.curriculumVersion, schoolYear: selected.schoolYear }); await load(); setNotice({ type: 'success', message: 'Changes saved.' }); }
    catch (error) { setNotice({ type: 'error', message: error.message }); }
    finally { setSaving(false); }
  };

  const saveSubject = async (event) => {
    event.preventDefault(); if (!selected) return; setSaving(true); setNotice(null); setSubjectError('');
    if (isLocalMode) {
      const nextSubject = { ...subjectForm, subjectId: editingId || `local-subject-${Date.now()}` };
      const nextSubjects = editingId ? subjects.map((item) => item.subjectId === editingId ? nextSubject : item) : [...subjects, nextSubject];
      saveLocalCurriculum({ ...selected, subjects: nextSubjects, totalUnits: nextSubjects.reduce((sum, item) => sum + Number(item.units || 0), 0) });
      setSubjectForm(emptySubject); setEditingId(null); setSaving(false); setNotice({ type: 'success', message: editingId ? 'Subject updated.' : 'Subject added.' }); return;
    }
    try { if (editingId) await updateCurriculumSubject(selected.curriculumId, editingId, subjectForm); else await addCurriculumSubject(selected.curriculumId, subjectForm); setSubjectForm(emptySubject); setEditingId(null); await load(); setNotice({ type: 'success', message: editingId ? 'Subject updated.' : 'Subject added.' }); }
    catch (error) {
      if (editingId) setSubjectError(error.message);
      else setNotice({ type: 'error', message: error.message });
    }
    finally { setSaving(false); }
  };

  const editSubject = (item) => {
    setMode('manual'); setEditingId(item.subjectId);
    setSubjectError('');
    setSubjectForm({ subjectCode: item.subjectCode, subjectTitle: item.subjectTitle, units: item.units, lectureHours: item.lectureHours, laboratoryHours: item.laboratoryHours, prerequisite: item.prerequisite || '', yearLevel: item.yearLevel, semester: item.semester, subjectType: item.subjectType || '' });
  };

  const deleteSubject = async (item) => {
    if (!await requestSystemConfirmation(`Remove ${item.subjectCode} from this curriculum?`)) return;
    if (isLocalMode) { const nextSubjects = subjects.filter((subject) => subject.subjectId !== item.subjectId); saveLocalCurriculum({ ...selected, subjects: nextSubjects, totalUnits: nextSubjects.reduce((sum, subject) => sum + Number(subject.units || 0), 0) }); setNotice({ type: 'success', message: 'Subject removed.' }); return; }
    try { await removeCurriculumSubject(selected.curriculumId, item.subjectId); await load(); setNotice({ type: 'success', message: 'Subject removed.' }); }
    catch (error) { setNotice({ type: 'error', message: error.message }); }
  };

  const toggleSubjectSelection = (subjectId) => setSelectedSubjectIds((current) =>
    current.includes(subjectId) ? current.filter((id) => id !== subjectId) : [...current, subjectId]);
  const allVisibleSelected = visibleSubjects.length > 0 && visibleSubjects.every((item) => selectedSubjectIds.includes(item.subjectId));
  const selectAllVisible = () => {
    const visibleIds = visibleSubjects.map((item) => item.subjectId);
    setSelectedSubjectIds((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])]);
  };
  const deleteSelectedSubjects = async () => {
    if (!selectedSubjectIds.length || !selected) return;
    if (!await requestSystemConfirmation(`Delete ${selectedSubjectIds.length} selected curriculum subjects? This affects the current editable curriculum.`)) return;
    setSaving(true); setNotice(null);
    try {
      if (isLocalMode) {
        const selectedIds = new Set(selectedSubjectIds);
        const nextSubjects = subjects.filter((subject) => !selectedIds.has(subject.subjectId));
        saveLocalCurriculum({ ...selected, subjects: nextSubjects, totalUnits: nextSubjects.reduce((sum, subject) => sum + Number(subject.units || 0), 0) });
      } else {
        await removeCurriculumSubjects(selected.curriculumId, selectedSubjectIds);
        await load();
      }
      setSelectedSubjectIds([]);
      setNotice({ type: 'success', message: 'Selected subjects removed.' });
    } catch (error) { setNotice({ type: 'error', message: error.message }); }
    finally { setSaving(false); }
  };

  const submit = async () => {
    if (!editable || selected.status !== 'DRAFT') return setNotice({ type: 'error', message: 'Save the curriculum before submitting it.' });
    if (!await requestSystemConfirmation('Submit this curriculum to the Registrar for review?')) return;
    if (isLocalMode) { saveLocalCurriculum({ ...selected, status: 'PENDING_APPROVAL' }); setNotice({ type: 'success', message: 'Curriculum submitted for review locally.' }); return; }
    setSaving(true); try { await submitCurriculum(selected.curriculumId); startNewCurriculum(); await load(); setNotice({ type: 'success', message: 'Curriculum submitted for Registrar review. You can create another checklist.' }); }
    catch (error) { setNotice({ type: 'error', message: error.message }); } finally { setSaving(false); }
  };

  const downloadTemplate = () => {
    const data = 'Year Level,Semester,Course Code,Course Title,Units,Prerequisite(s)\n1,FIRST,IT 101,Introduction to Computing,3,\n';
    const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' })); const link = document.createElement('a'); link.href = url; link.download = 'curriculum-template.csv'; link.click(); URL.revokeObjectURL(url);
  };

  const importCsv = async (file) => {
    setUploadName(file?.name || ''); if (!file || !selected || !editable) return;
    if (!file.name?.toLowerCase().endsWith('.csv')) {
      setNotice({ type: 'error', message: 'Please choose a CSV file.' });
      return;
    }
    setSaving(true); setNotice(null);
    try {
      if (isLocalMode) throw new Error('CSV import requires the BlockGo backend.');
      const result = await bulkImportCurriculumSubjects(selected.curriculumId, file);
      await load();
      const importedCount = Number(result?.importedCount || 0);
      const skippedCount = Number(result?.skippedCount || 0);
      const skippedMessage = skippedCount === 1
        ? '1 subject already existed and was skipped.'
        : `${skippedCount} subjects already existed and were skipped.`;
      setNotice({
        type: 'success',
        message: importedCount
          ? `${importedCount} subjects imported successfully.${skippedCount ? ` ${skippedMessage}` : ''}`
          : `All ${skippedCount} subjects already exist in this curriculum.`,
      });
    } catch (error) { setNotice({ type: 'error', message: error.message }); }
    finally { setSaving(false); }
  };

  const canImportCsv = Boolean(editable && !saving);
  const openFilePicker = () => {
    if (canImportCsv) fileRef.current?.click();
  };
  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    importCsv(file);
  };
  const handleDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = canImportCsv ? 'copy' : 'none';
    if (canImportCsv) setIsDraggingFile(true);
  };
  const handleDragLeave = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setIsDraggingFile(false);
  };
  const handleDrop = (event) => {
    event.preventDefault();
    setIsDraggingFile(false);
    if (canImportCsv) importCsv(event.dataTransfer.files?.[0]);
  };

  const closeSubjectEditor = () => {
    setSubjectForm(emptySubject);
    setEditingId(null);
    setSubjectError('');
    setPrerequisiteOpen(false);
  };
  const renderSubjectForm = (inline = false) => <form
    onSubmit={saveSubject}
    aria-label={editingId ? `Edit Subject ${subjectForm.subjectCode}` : 'Add Subject'}
    className={inline ? 'sticky left-0 w-[calc(100vw-3rem)] max-w-4xl rounded-lg border border-blue-200 bg-blue-50 p-4' : 'mt-5 border-t border-slate-200 pt-4'}
  >
    <h3 className="mb-3 font-bold">{editingId ? 'Edit Subject' : 'Add Subject'}</h3>
    {subjectError && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{subjectError}</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <label className="text-xs font-semibold text-slate-600">Year Level<select value={subjectForm.yearLevel} onChange={(e) => setSubjectForm({ ...subjectForm, yearLevel: Number(e.target.value), prerequisite: '' })} className={inputClass}>{Object.entries(years).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">Semester<select value={subjectForm.semester} onChange={(e) => setSubjectForm({ ...subjectForm, semester: e.target.value, prerequisite: '' })} className={inputClass}>{Object.entries(semesters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">Course Code<input required placeholder="e.g. IT 101" value={subjectForm.subjectCode} onChange={(e) => setSubjectForm({ ...subjectForm, subjectCode: e.target.value })} className={inputClass} /></label>
      <label className="text-xs font-semibold text-slate-600 sm:col-span-2 xl:col-span-2">Course Title<input required placeholder="e.g. Introduction to Computing" value={subjectForm.subjectTitle} onChange={(e) => setSubjectForm({ ...subjectForm, subjectTitle: e.target.value })} className={inputClass} /></label>
      <label className="text-xs font-semibold text-slate-600">Units<input required type="number" min="0.5" step="0.5" value={subjectForm.units} onChange={(e) => setSubjectForm({ ...subjectForm, units: Number(e.target.value) })} className={inputClass} /></label>
      <div className="relative sm:col-span-2 xl:col-span-4">
        <label className="text-xs font-semibold text-slate-600">Prerequisite (Choose one or more subjects)</label>
        <button type="button" onClick={() => setPrerequisiteOpen((open) => !open)} className={`${inputClass} flex items-center justify-between text-left`}><span className="truncate">{selectedPrerequisites.length ? selectedPrerequisites.join(', ') : 'None'}</span><span>⌄</span></button>
        {prerequisiteOpen && <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 shadow-xl">
          <input autoFocus value={prerequisiteSearch} onChange={(e) => setPrerequisiteSearch(e.target.value)} placeholder="Search subjects..." className={`${inputClass} mt-0`} />
          <button type="button" onClick={() => setSubjectForm((current) => ({ ...current, prerequisite: '' }))} className="mt-2 w-full rounded px-2 py-2 text-left text-xs font-semibold hover:bg-slate-50">None</button>
          <p className="border-y bg-slate-50 px-2 py-2 text-[10px] font-bold text-slate-500">AVAILABLE SUBJECTS (FROM PREVIOUS SEMESTERS)</p>
          <div className="max-h-48 overflow-y-auto">{filteredPrerequisites.map((item) => <label key={item.subjectId} className="flex cursor-pointer items-start gap-2 px-2 py-2 text-xs hover:bg-blue-50"><input type="checkbox" checked={selectedPrerequisites.includes(item.subjectCode)} onChange={() => togglePrerequisite(item.subjectCode)} className="mt-0.5" /><span><strong>{item.subjectCode}</strong> — {item.subjectTitle} <span className="text-slate-400">({years[item.yearLevel]}, {semesters[item.semester]})</span></span></label>)}{!filteredPrerequisites.length && <p className="p-3 text-center text-xs text-slate-400">No eligible subjects.</p>}</div>
        </div>}
      </div>
      <div className="flex items-end justify-end gap-2 sm:col-span-2 xl:col-span-2"><button type="button" onClick={closeSubjectEditor} className="h-9 min-w-20 whitespace-nowrap rounded-lg border border-slate-300 px-3 text-xs font-bold">{editingId ? 'Cancel' : 'Clear'}</button><button disabled={saving} className="h-9 min-w-28 whitespace-nowrap rounded-lg bg-[#073b82] px-4 text-xs font-bold text-white">{editingId ? 'Save Changes' : '+ Add Subject'}</button></div>
    </div>
  </form>;

  return <div className="space-y-3 text-[13px] text-[#102a56]">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-xl font-bold">Curriculum Checklist</h1></div><button onClick={downloadTemplate} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold shadow-sm">⇩&nbsp; Download Template</button></header>
    {notice && <div className={`flex justify-between rounded-lg border px-4 py-3 text-sm ${notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}><span>{notice.message}</span><button onClick={() => setNotice(null)}>×</button></div>}
    <div className="flex border-b border-slate-200">{[['manual', 'Create Manually'], ['bulk', 'Bulk Upload']].map(([id, label]) => <button key={id} onClick={() => setMode(id)} className={`border-b-2 px-4 py-2 text-xs font-semibold ${mode === id ? 'border-blue-700 text-blue-700' : 'border-transparent text-slate-600'}`}>{label}</button>)}</div>

    <section className="rounded-xl border border-blue-100 bg-blue-50 p-4" aria-label="Assigned curriculum version">
      {assignedCurriculum?.curriculum ? <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Curriculum Version</p><p className="mt-1 font-bold text-[#073b82]">{assignedCurriculum.curriculum.curriculumVersion}</p><p className="text-xs text-slate-600">{assignedCurriculum.curriculum.curriculumName} · Batch {assignedCurriculum.batchYear}</p></div><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Latest Approved</span></div> : <p className="text-sm font-semibold text-slate-600">No approved curriculum is assigned to this program.</p>}
    </section>

    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-600">{selected ? `${selected.programCode} · ${selected.curriculumVersion} (${selected.status})` : 'New curriculum checklist'}</span>{selected && <button type="button" disabled={saving} onClick={startNewCurriculum} className="rounded-lg border border-blue-700 px-3 py-2 text-xs font-bold text-blue-700 disabled:opacity-50">Create New Checklist</button>}</div>
      {!selected && <form onSubmit={create} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="mb-3 font-bold">Curriculum Information</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[['curriculumCode', 'Curriculum Code'], ['curriculumName', 'Curriculum Name'], ['curriculumVersion', 'Version'], ['schoolYear', 'School Year']].map(([field, placeholder]) => <input key={field} required placeholder={placeholder} value={curriculumForm[field]} onChange={(e) => setCurriculumForm({ ...curriculumForm, [field]: e.target.value })} className={inputClass} />)}</div><button disabled={saving || !curriculumForm.programCode} className="mt-3 rounded-lg bg-[#073b82] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Create Curriculum</button></form>}
    {mode === 'manual' ? <>
      {selected && <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">▧ Curriculum Information</h2></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{[['programCode', 'Program'], ['curriculumCode', 'Curriculum Code'], ['curriculumName', 'Curriculum Name'], ['curriculumVersion', 'Version'], ['schoolYear', 'School Year']].map(([field, label]) => <label key={field} className="text-xs text-slate-600">{label}<input disabled={!editable || field === 'programCode' || field === 'curriculumVersion'} value={selected[field] || ''} onChange={(e) => updateSelected(field, e.target.value)} className={inputClass} /></label>)}</div>{selected.registrarComment && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><strong>Registrar comment:</strong> {selected.registrarComment}</p>}
      {editable && !editingId && renderSubjectForm()}
      </section>}
    </> : <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-bold">Bulk Upload Curriculum</h2>
        {selected && <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold">{selected.programCode} · {selected.curriculumVersion}</span>}
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <div>
          <input ref={fileRef} aria-label="Curriculum CSV file" type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
          <button
            type="button"
            disabled={!canImportCsv}
            onClick={openFilePicker}
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex min-h-52 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 transition disabled:cursor-not-allowed disabled:opacity-50 ${isDraggingFile ? 'border-blue-600 bg-blue-50' : 'border-slate-300 bg-slate-50'}`}
          >
            <span className="mb-3 rounded-lg bg-emerald-100 p-3 font-black text-emerald-700">CSV</span>
            <strong>{uploadName || 'Drag and drop your CSV file here'}</strong>
            <span className="mt-2 text-xs text-slate-500">or click to choose a file</span>
          </button>
          {!editable && <p className="mt-2 text-xs text-amber-700">Select or create a curriculum in Draft or Returned status before importing subjects.</p>}
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><h3 className="font-bold">Template Columns</h3>{['Year Level', 'Semester', 'Course Code', 'Course Title', 'Units', 'Prerequisite(s)'].map((item) => <div key={item} className="border-b border-amber-200 py-2 last:border-0">{item}</div>)}</div>
      </div>
    </section>}

    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div><h2 className="font-bold">Current Curriculum Checklist</h2></div>
        <div className="flex flex-wrap gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search subjects..." className={`${inputClass} mt-0 w-52`} />
          <select aria-label="Filter by year level" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className={`${inputClass} mt-0 w-36`}><option value="all">All years</option>{Object.entries(years).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select aria-label="Filter by semester" value={semesterFilter} onChange={(e) => setSemesterFilter(e.target.value)} className={`${inputClass} mt-0 w-40`}><option value="all">All semesters</option>{Object.entries(semesters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <span className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold">Total Subjects: {subjects.length}</span><span className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold">Total Units: {totalUnits}</span>
        </div>
      </div>
      {editable && <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3"><button type="button" onClick={selectAllVisible} disabled={!visibleSubjects.length || saving} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50">{allVisibleSelected ? 'Clear Visible Selection' : 'Select All'}</button>{selectedSubjectIds.length > 0 && <button type="button" onClick={deleteSelectedSubjects} disabled={saving} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Delete Selected ({selectedSubjectIds.length})</button>}<span className="text-xs text-slate-500">Select All applies only to the currently filtered rows.</span></div>}
      <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-600"><tr><th className="px-4 py-3">Select</th>{['#', 'Year Level', 'Semester', 'Course Code', 'Course Title', 'Units', 'Prerequisite(s)', 'Actions'].map((item) => <th key={item} className="px-4 py-3">{item}</th>)}</tr></thead><tbody>
        {visibleSubjects.map((item, index) => <React.Fragment key={item.subjectId}>
          <tr className="border-t hover:bg-slate-50"><td className="px-4 py-3"><input type="checkbox" aria-label={`Select ${item.subjectCode}`} disabled={!editable} checked={selectedSubjectIds.includes(item.subjectId)} onChange={() => toggleSubjectSelection(item.subjectId)} /></td><td className="px-4 py-3">{index + 1}</td><td className="px-4 py-3">{years[item.yearLevel]}</td><td className="px-4 py-3">{semesters[item.semester]}</td><td className="px-4 py-3 font-bold">{item.subjectCode}</td><td className="px-4 py-3">{item.subjectTitle}</td><td className="px-4 py-3">{item.units}</td><td className="px-4 py-3"><span className={`rounded px-2 py-1 ${item.prerequisite ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>{item.prerequisite || 'None'}</span></td><td className="whitespace-nowrap px-4 py-3"><button disabled={!editable} onClick={() => editSubject(item)} className="mr-3 font-bold text-blue-700 disabled:opacity-30">Edit</button><button disabled={!editable} onClick={() => deleteSubject(item)} className="font-bold text-red-600 disabled:opacity-30">Delete</button></td></tr>
          {editingId === item.subjectId && <tr className="border-t border-blue-200"><td colSpan="9" className="p-3 align-top">{renderSubjectForm(true)}</td></tr>}
        </React.Fragment>)}
        {!loading && !visibleSubjects.length && <tr><td colSpan="9" className="p-10 text-center text-slate-400">No subjects found in this curriculum.</td></tr>}
      </tbody></table></div>
    </section>
    {selected && <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3"><p className="text-xs"><strong>Reminder:</strong> Save your changes before submitting for Registrar review.</p><div className="flex flex-wrap gap-2"><button disabled={!editable || saving} onClick={saveMetadata} className="rounded-lg border bg-white px-3 py-2 text-xs font-bold disabled:opacity-50">Save Changes</button><button onClick={() => setPreview(true)} className="rounded-lg border bg-white px-3 py-2 text-xs font-bold">Preview Checklist</button><button disabled={!editable || saving || !subjects.length} onClick={submit} className="rounded-lg bg-[#073b82] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Submit for Review</button></div></footer>}
    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><div className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 flex justify-between border-b bg-white p-4"><div><h2 className="font-bold">Curriculum Checklist Preview</h2><p className="text-xs text-slate-500">{selected?.curriculumName} · {selected?.schoolYear}</p></div><button onClick={() => setPreview(false)} className="rounded-lg border px-3">Close</button></div><div className="p-5">{Object.entries(years).map(([year, label]) => <div key={year} className="mb-5"><h3 className="mb-2 font-bold">{label}</h3>{subjects.filter((item) => Number(item.yearLevel) === Number(year)).map((item) => <div key={item.subjectId} className="grid grid-cols-[100px_1fr_70px] border-b py-2 text-sm"><strong>{item.subjectCode}</strong><span>{item.subjectTitle}</span><span>{item.units} units</span></div>)}</div>)}</div></div></div>}
  </div>;
};

export default CurriculumBuilder;
