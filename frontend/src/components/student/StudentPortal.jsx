import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchStudentCurriculum, fetchStudentCurrentSubjects, fetchStudentHistoricalGrades, getSystemSetting, updateStudentProfile } from '../../services/api';
import StudentNavbar from './StudentNavbar';
import StudentInfoCard from './StudentInfoCard';
import StudentSummary from './StudentSummary';
import StudentHistoricalGrades from './StudentHistoricalGrades';
import StudentBlockchainTransactions from './StudentBlockchainTransactions';
import StudentCurrentSubjects from './StudentCurrentSubjects';
import CurriculumViewer from '../shared/CurriculumViewer';
import BackButton from '../shared/BackButton';
import TextSizeControl from '../shared/TextSizeControl';
import { getGradeEquivalent } from '../../utils/gradingHelpers';
import { curriculumProgress } from '../../utils/studentAcademicHelpers';

const StudentPortal = ({ studentData, onLogout }) => {
  const [grades, setGrades] = useState([]);
  const [gradeError, setGradeError] = useState('');
  const [gradeMessage, setGradeMessage] = useState('');
  const [curricula, setCurricula] = useState([]);
  const [currentEnrollment, setCurrentEnrollment] = useState(null);
  const [currentSubjects, setCurrentSubjects] = useState([]);
  const [subjectLoading, setSubjectLoading] = useState(true);
  const [subjectError, setSubjectError] = useState('');
  const [loading, setLoading] = useState(true);
  const [curriculumLoading, setCurriculumLoading] = useState(false);
  const [curriculumError, setCurriculumError] = useState('');
  const [activeSemester, setActiveSemester] = useState('Semester Grades');
  const [activeView, setActiveView] = useState('grades');
  const [profile, setProfile] = useState(() => ({ ...studentData }));
  const [profileForm, setProfileForm] = useState(() => ({ phone: studentData.phone || '', sex: studentData.sex || '', middleName: studentData.middleName || '' }));
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState('');

  const rawFullName = profile.name || '';
  const firstName = rawFullName.split(' ')[0] || '';
  const storedMiddleName = profile.middleName || '';
  const remainingName = rawFullName.split(' ').slice(1).join(' ').trim();
  const escapedMiddleName = storedMiddleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lastName = storedMiddleName && escapedMiddleName ? remainingName.replace(new RegExp(`^${escapedMiddleName}\\s*`, 'i'), '').trim() : remainingName;

  const loadGrades = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setGradeError('');
    try {
      const response = await fetchStudentHistoricalGrades();
      const records = Array.isArray(response?.data) ? response.data : [];
      setGrades(records);
      setGradeMessage(records.length === 0
        ? (response?.message || 'No released grades are available for this term yet.')
        : '');
    } catch (error) {
      console.error('Unable to load finalized student grade history:', error);
      setGradeError(error.message || 'Unable to retrieve grade records from the blockchain. Please try again later.');
      setGradeMessage('');
      if (!background) setGrades([]);
    } finally { if (!background) setLoading(false); }
  }, []);

  const loadCurriculum = useCallback(async () => {
    setCurriculumLoading(true); setCurriculumError('');
    try {
      const response = await fetchStudentCurriculum();
      if (!response?.data) {
        setCurricula([]);
        setCurriculumError(response?.message || 'No published curriculum is assigned to your program.');
      } else {
        setCurricula([response.data]);
        if (!Array.isArray(response.data.subjects) || response.data.subjects.length === 0)
          setCurriculumError('The published curriculum has no configured subjects yet.');
      }
    } catch (error) {
      console.error('Unable to load the student curriculum checklist:', error);
      setCurricula([]); setCurriculumError('No published curriculum checklist is assigned to your account.');
    } finally { setCurriculumLoading(false); }
  }, []);

  const loadSubjects = useCallback(async () => {
    setSubjectLoading(true); setSubjectError('');
    try {
      const response = await fetchStudentCurrentSubjects();
      setCurrentEnrollment(response?.data || null);
      setCurrentSubjects(Array.isArray(response?.data?.subjects) ? response.data.subjects : []);
    } catch (error) {
      setCurrentEnrollment(null); setCurrentSubjects([]);
      setSubjectError(error.message || 'Unable to load your enrolled subjects.');
    } finally { setSubjectLoading(false); }
  }, []);

  useEffect(() => {
    loadGrades();
    loadSubjects();
    const handleAcademicDataChanged = () => { loadGrades(true); loadSubjects(); };
    window.addEventListener('blockgo:academic-data-changed', handleAcademicDataChanged);
    return () => window.removeEventListener('blockgo:academic-data-changed', handleAcademicDataChanged);
  }, [loadGrades, loadSubjects]);

  useEffect(() => { if (activeView === 'curriculum' && curricula.length === 0) loadCurriculum(); }, [activeView, curricula.length, loadCurriculum]);

  useEffect(() => {
    const applyEncodingPeriod = (value) => {
      if (!value) return;
      try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; setActiveSemester(parsed?.semester ? `${parsed.semester} Grades` : 'Semester Grades'); }
      catch (error) { console.error('Failed to parse encoding period:', error); }
    };
    getSystemSetting('encoding_period').then((response) => { if (response.status === 'Success') applyEncodingPeriod(response.value); }).catch(() => {});
    const handleSetting = (event) => { if ((event.detail?.key || event.detail?.Key) === 'encoding_period') applyEncodingPeriod(event.detail?.value || event.detail?.Value); };
    window.addEventListener('blockgo:system-setting-changed', handleSetting);
    return () => window.removeEventListener('blockgo:system-setting-changed', handleSetting);
  }, []);

  const finalizedByRecord = useMemo(() => {
    const map = new Map();
    grades.forEach((grade) => {
      const existing = map.get(grade.recordId) || grade;
      if (grade.term === 'finals' || !map.has(grade.recordId)) map.set(grade.recordId, { ...existing, ...grade });
    });
    return [...map.values()];
  }, [grades]);
  const equivalentFor = (grade) => {
    const numericGrade = Number(grade.finalAverage || grade.grade);
    if (!Number.isFinite(numericGrade)) return null;
    return numericGrade > 5 ? Number(getGradeEquivalent(numericGrade)) : numericGrade;
  };
  const totalUnits = finalizedByRecord.reduce((sum, grade) => sum + Number(grade.units || 0), 0);
  const totalWeight = finalizedByRecord.reduce((sum, grade) => sum + Number(equivalentFor(grade) || 0) * Number(grade.units || 0), 0);
  const calculatedGWA = totalUnits > 0 ? (totalWeight / totalUnits).toFixed(2) : '0.00';
  const failedSubjectsCount = finalizedByRecord.filter((grade) => equivalentFor(grade) === 5).length;
  const isDeansLister = finalizedByRecord.length > 0 && Number(calculatedGWA) <= 1.75 && finalizedByRecord.every((grade) => {
    const equivalent = equivalentFor(grade);
    return equivalent !== null && equivalent <= 2.25;
  });
  const currentYear = Number(String(profile.yearLevel || profile.section || '').match(/[1-4]/)?.[0] || 0);
  const progressBySubject = useMemo(() => curriculumProgress(curricula[0]?.subjects || [], currentSubjects, grades, currentEnrollment), [curricula, currentSubjects, grades, currentEnrollment]);

  const views = [
    { id: 'grades', label: 'Grades' },
    { id: 'curriculum', label: 'Curriculum Checklist' },
  ];

  const saveProfile = async (event) => {
    event.preventDefault(); setProfileSaving(true); setProfileNotice('');
    try {
      await updateStudentProfile(profileForm);
      setProfile((current) => ({ ...current, ...profileForm }));
      setProfileNotice('Profile settings saved.');
    } catch (error) { setProfileNotice(error.message || 'Profile settings could not be saved.'); }
    finally { setProfileSaving(false); }
  };

  const renderSettings = ({ close }) => (
    <div className="space-y-5">
      <form onSubmit={saveProfile}>
        <div className="mb-3">
          <h3 className="text-sm font-bold text-slate-800">Account</h3>
          <p className="text-xs text-slate-500">Update the profile details you are allowed to manage.</p>
        </div>
        {profileNotice ? <p role="status" className="mb-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{profileNotice}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">Middle Name<input value={profileForm.middleName} onChange={(event) => setProfileForm((current) => ({ ...current, middleName: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-[#003366] focus:ring-2 focus:ring-blue-100" /></label>
          <label className="text-xs font-semibold text-slate-700">Phone<input value={profileForm.phone} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-[#003366] focus:ring-2 focus:ring-blue-100" /></label>
          <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Sex<select value={profileForm.sex} onChange={(event) => setProfileForm((current) => ({ ...current, sex: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#003366]"><option value="">Prefer not to specify</option><option value="Female">Female</option><option value="Male">Male</option></select></label>
        </div>
        <button disabled={profileSaving} className="mt-3 h-10 w-full rounded-lg bg-[#003366] px-4 text-sm font-bold text-white transition hover:bg-[#00264d] disabled:opacity-50">{profileSaving ? 'Saving…' : 'Save Profile'}</button>
      </form>

      <section className="border-t border-slate-200 pt-4">
        <div className="mb-3"><h3 className="text-sm font-bold text-slate-800">Preferences</h3><p className="text-xs text-slate-500">Choose a comfortable portal display.</p></div>
        <TextSizeControl />
      </section>

      <section className="border-t border-slate-200 pt-4">
        <div className="mb-3"><h3 className="text-sm font-bold text-slate-800">Other</h3><p className="text-xs text-slate-500">Open secondary academic and verification pages.</p></div>
        <div className="grid gap-2">
          <button type="button" onClick={() => { setActiveView('subjects'); close(); }} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#003366]"><span>Current Subjects</span><span aria-hidden="true">›</span></button>
          <button type="button" onClick={() => { setActiveView('transactions'); close(); }} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#003366]"><span>Blockchain Transactions</span><span aria-hidden="true">›</span></button>
        </div>
      </section>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-10 font-sans">
      <StudentNavbar studentData={profile} onLogout={onLogout} renderSettings={renderSettings} />
      <div className="mx-auto max-w-7xl">
        <StudentInfoCard studentData={{ firstName, lastName, middleName: storedMiddleName || 'Not provided', studentId: currentEnrollment?.studentNo || profile.studentNo || 'N/A', dateOfBirth: profile.dateOfBirth || 'Not provided', sex: profile.sex || 'Not provided', phone: profile.phone || 'Not provided', email: profile.studentEmail || profile.email, department: currentEnrollment?.department || profile.department, section: currentEnrollment?.section || profile.section, yearLevel: currentEnrollment?.yearLevel || profile.yearLevel, schoolYear: currentEnrollment?.schoolYear || profile.schoolYear, semester: currentEnrollment?.semester || profile.semester, enrollmentStatus: currentEnrollment ? 'Enrolled' : profile.enrollmentStatus, curriculumName: curricula[0]?.curriculumName || profile.curriculumName, curriculumVersion: curricula[0]?.curriculumVersion || profile.curriculumVersion, address: profile.address || 'Not provided' }} />
        <StudentSummary totalUnits={totalUnits} gwa={calculatedGWA} isDeansLister={isDeansLister} failedSubjectsCount={failedSubjectsCount} semesterLabel={activeSemester} />

        <nav className="mx-4 mt-5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm md:mx-6" aria-label="Student portal sections"><div className="grid grid-cols-2 gap-1.5 sm:flex">{views.map((view) => <button key={view.id} type="button" onClick={() => setActiveView(view.id)} className={`rounded-lg px-4 py-2.5 text-sm font-bold transition ${activeView === view.id ? 'bg-[#003366] text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}>{view.label}</button>)}</div></nav>
        <main className="mx-4 mt-4 md:mx-6">
          {['subjects', 'transactions'].includes(activeView) ? <BackButton onClick={() => setActiveView('grades')} label="Back to Grades" className="mb-3" /> : null}
          {activeView === 'transactions' ? <StudentBlockchainTransactions /> : null}
          {activeView === 'subjects' ? <StudentCurrentSubjects subjects={currentSubjects} schoolYear={currentEnrollment?.schoolYear || ''} semester={currentEnrollment?.semester || ''} loading={subjectLoading} error={subjectError} /> : null}
          {activeView === 'grades' ? <StudentHistoricalGrades grades={grades} loading={loading} error={gradeError} emptyMessage={gradeMessage} /> : null}
          {activeView === 'curriculum' ? <>{curriculumError ? <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{curriculumError}</div> : null}{gradeError ? <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Grades are temporarily unavailable; curriculum subjects remain visible.</div> : null}<CurriculumViewer curricula={curricula} currentYear={currentEnrollment?.yearLevel || currentYear} loading={curriculumLoading} emptyMessage={curriculumError || 'No published curriculum is assigned to your account.'} progressBySubject={progressBySubject} /></> : null}
        </main>
      </div>
    </div>
  );
};

export default StudentPortal;
