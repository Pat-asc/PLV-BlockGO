import infoLogo from '../../assets/infoLogo.webp';

const InfoField = ({ label, children, wide = false }) => (
  <div className={wide ? 'sm:col-span-2 lg:col-span-3' : ''}>
    <dt className="text-xs font-medium text-slate-500">{label}</dt>
    <dd className="mt-0.5 break-words text-sm font-semibold text-slate-800">{children}</dd>
  </div>
);

const StudentInfoCard = ({ studentData }) => (
  <details className="group mx-4 mt-4 rounded-xl border border-slate-200 bg-white shadow-sm md:mx-6">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003366] focus-visible:ring-inset sm:px-5">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Student Profile</p>
        <h2 className="truncate text-base font-bold text-[#003366]">{studentData.firstName} {studentData.lastName}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{studentData.studentId} · {studentData.department || 'Program not assigned'} · {studentData.yearLevel ? `Year ${studentData.yearLevel}` : 'Year not assigned'} / {studentData.section || 'No section'}</p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-slate-600"><span className="hidden sm:inline">Personal information</span><svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 transition group-open:rotate-180"><path d="m5 7.5 5 5 5-5" /></svg></span>
    </summary>
    <div className="border-t border-slate-200 px-4 py-5 sm:px-5">
      <dl className="grid grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-3">
        <InfoField label="First Name">{studentData.firstName}</InfoField>
        <InfoField label="Middle Name">{studentData.middleName}</InfoField>
        <InfoField label="Last Name">{studentData.lastName}</InfoField>
        <InfoField label="Date of Birth">{studentData.dateOfBirth}</InfoField>
        <InfoField label="Sex">{studentData.sex}</InfoField>
        <InfoField label="Phone">{studentData.phone}</InfoField>
        <InfoField label="Email">{studentData.email}</InfoField>
        <InfoField label="Academic Period">{studentData.schoolYear || 'Not assigned'} · {studentData.semester || 'No semester'}</InfoField>
        <InfoField label="Curriculum">{studentData.curriculumVersion || studentData.curriculumName || 'Not assigned'}</InfoField>
        <InfoField label="Enrollment Status">{studentData.enrollmentStatus || 'Unassigned'}</InfoField>
        <InfoField label="Address" wide>{studentData.address}</InfoField>
      </dl>
      <p className="mt-5 flex items-start gap-2 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500"><img src={infoLogo} alt="" className="mt-0.5 h-4 w-4 shrink-0" />If your personal information is incorrect or requires an update, visit the Office of the Registrar for assistance.</p>
    </div>
  </details>
);

export default StudentInfoCard;
