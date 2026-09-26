import React, { useEffect, useState } from 'react';
import { bulkCreateStaffAccounts, createStaffAccount, fetchAcademicPrograms } from '../../services/api';

const initialForm = { staffId: '', firstName: '', middleName: '', lastName: '', email: '', role: 'faculty', programCode: '', facultyType: 'Regular', password: '' };
const fieldClass = 'mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-xs font-normal outline-none focus:border-[#003366]';

const Box = ({ title, children }) => (
  <fieldset className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <legend className="px-1 text-sm font-bold text-[#003366]">{title}</legend>
    {children}
  </fieldset>
);

const StaffAccountCreation = () => {
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [showPassword, setShowPassword] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkPreview, setBulkPreview] = useState([]);
  const [bulkResult, setBulkResult] = useState(null);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  useEffect(() => {
    fetchAcademicPrograms().then((response) => {
      const items = Array.isArray(response?.data) ? response.data : [];
      setPrograms(items);
      setForm((current) => ({ ...current, programCode: current.programCode || items[0]?.programCode || '' }));
    }).catch((error) => setNotice({ type: 'error', message: error.message }));
  }, []);

  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setNotice(null);
    try {
      const response = await createStaffAccount(form);
      setNotice({ type: 'success', message: `${response?.data?.role === 'faculty' ? 'Faculty' : 'Chairperson'} account created for ${response?.data?.email}.` });
      setForm({ ...initialForm, programCode: form.programCode });
    } catch (error) { setNotice({ type: 'error', message: error.message }); }
    finally { setSaving(false); }
  };

  const clear = () => { setForm({ ...initialForm, programCode: form.programCode }); setNotice(null); setShowPassword(false); };

  const selectBulkFile = (file) => {
    setBulkFile(file || null); setBulkResult(null); setBulkPreview([]);
    if (!file) return;
    file.text().then((text) => {
      const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 6);
      setBulkPreview(lines.map((line) => line.split(',').map((value) => value.trim())));
    });
  };
  const uploadBulk = async () => {
    if (!bulkFile) return;
    setSaving(true); setBulkResult(null);
    try { setBulkResult(await bulkCreateStaffAccounts(bulkFile)); }
    catch (error) { setBulkResult({ status: 'Error', message: error.message }); }
    finally { setSaving(false); }
  };
  const downloadBulkTemplate = () => {
    const csv = 'Staff ID,First Name,Middle Name,Last Name,Email,Role,Program Code,Faculty Type,Temporary Password\nFAC-2026-001,Juan,,Dela Cruz,faculty@plv.edu.ph,faculty,BSIT,Regular,ChangeMe123!\nCHAIR-2026-001,Ana,,Santos,chair@plv.edu.ph,department_admin,BSIT,,ChangeMe123!\n';
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'staff-account-template.csv'; link.click(); URL.revokeObjectURL(link.href);
  };

  return <section>
    {notice ? <div className={`mb-3 rounded-lg p-3 text-sm ${notice.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{notice.message}</div> : null}
    <Box title="Bulk Staff Account Creation">
      <p className="mb-3 text-xs text-slate-600">CSV roles are restricted to Faculty and Chairperson/Department Head. Rows are validated independently and the result lists every failure.</p>
      <div className="flex flex-wrap items-center gap-2"><input aria-label="Staff CSV" type="file" accept=".csv,text/csv" onChange={(event) => selectBulkFile(event.target.files?.[0])} className="text-xs"/><button type="button" onClick={downloadBulkTemplate} className="rounded-lg border px-3 py-2 text-xs font-bold">Download Template</button><button type="button" onClick={uploadBulk} disabled={!bulkFile || saving} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Upload Staff CSV</button></div>
      {bulkPreview.length ? <div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-[10px]">{bulkPreview.map((row, rowIndex) => <tr key={rowIndex} className="border-b">{row.map((cell, cellIndex) => rowIndex === 0 ? <th key={cellIndex} className="px-2 py-1">{cell}</th> : <td key={cellIndex} className="px-2 py-1">{cell}</td>)}</tr>)}</table><p className="mt-1 text-[10px] text-slate-500">Preview shows the header and first five rows. Server validation is authoritative.</p></div> : null}
      {bulkResult ? <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs"><strong>{bulkResult.status}</strong><p>{bulkResult.message || `${bulkResult.data?.created || 0} created; ${bulkResult.data?.failed || 0} failed.`}</p>{bulkResult.data?.results?.filter((item) => !item.success).map((item) => <p key={item.rowNumber} className="text-red-700">Row {item.rowNumber}: {item.error}</p>)}</div> : null}
    </Box>
    <form onSubmit={submit} className="space-y-3">
      <Box title="1. Account Details"><div className="grid gap-4 md:grid-cols-3">
        <label className="text-xs font-semibold text-slate-700">Account Role<select value={form.role} onChange={(e) => update('role', e.target.value)} className={fieldClass}><option value="faculty">Faculty</option><option value="department_admin">Chairperson / Department Head</option></select></label>
        <label className="text-xs font-semibold text-slate-700">Institutional ID<input required value={form.staffId} onChange={(e) => update('staffId', e.target.value)} placeholder="FAC-2026-001" className={fieldClass}/></label>
        <label className="text-xs font-semibold text-slate-700">Email<input required type="email" value={form.email} onChange={(e) => update('email', e.target.value)} className={fieldClass}/></label>
      </div></Box>
      <Box title="2. Personal Information"><div className="grid gap-4 md:grid-cols-3">
        <label className="text-xs font-semibold text-slate-700">First Name<input required value={form.firstName} onChange={(e) => update('firstName', e.target.value)} className={fieldClass}/></label>
        <label className="text-xs font-semibold text-slate-700">Middle Name<input value={form.middleName} onChange={(e) => update('middleName', e.target.value)} className={fieldClass}/></label>
        <label className="text-xs font-semibold text-slate-700">Last Name<input required value={form.lastName} onChange={(e) => update('lastName', e.target.value)} className={fieldClass}/></label>
      </div></Box>
      <Box title="3. Academic Assignment"><div className="grid gap-4 md:grid-cols-2">
        <label className="text-xs font-semibold text-slate-700">Academic Program<select required value={form.programCode} onChange={(e) => update('programCode', e.target.value)} className={fieldClass}><option value="">Select program</option>{programs.map((program) => <option key={program.programId} value={program.programCode}>{program.programCode} — {program.programName}</option>)}</select></label>
        {form.role === 'faculty' ? <label className="text-xs font-semibold text-slate-700">Faculty Type<select value={form.facultyType} onChange={(e) => update('facultyType', e.target.value)} className={fieldClass}><option>Regular</option><option>Part-time</option><option>Full-time</option></select></label> : <div className="self-end rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Only one active Chairperson is allowed per academic program.</div>}
      </div></Box>
      <Box title="4. Security"><label className="text-xs font-semibold text-slate-700">Temporary Password<div className="relative mt-1"><input required minLength="8" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={(e) => update('password', e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3 pr-12 text-xs font-normal outline-none focus:border-[#003366]"/><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setShowPassword((value) => !value); }} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-[#003366]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">{showPassword ? <><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.3A10.7 10.7 0 0 1 12 4c5.5 0 9 5 9 8a12.7 12.7 0 0 1-2.1 3.7M6.2 6.2C4.2 7.7 3 10 3 12c0 3 3.5 8 9 8 1 0 2-.2 2.9-.5"/></> : <><path d="M3 12c0-3 3.5-8 9-8s9 5 9 8-3.5 8-9 8-9-5-9-8z"/><circle cx="12" cy="12" r="3"/></>}</svg></button></div><span className="mt-1 block text-[10px] font-normal text-slate-500">At least 8 characters.</span></label></Box>
      <div className="flex justify-end gap-3"><button type="button" onClick={clear} className="rounded-lg border border-slate-300 px-6 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Clear</button><button type="submit" disabled={saving} className="rounded-lg bg-[#003366] px-6 py-2.5 text-xs font-bold text-white hover:bg-[#00264d] disabled:opacity-50">{saving ? 'Creating Account…' : 'Create Account ›'}</button></div>
    </form>
  </section>;
};

export default StaffAccountCreation;
