import React from 'react';

const stages = [
  ['User Action', 'Faculty, Chairperson, Registrar, Student, or System Administrator enters or requests data.'],
  ['Application', 'React validates presentation rules; authenticated ASP.NET endpoints enforce authorization and academic context.'],
  ['Database', 'PostgreSQL stores accounts, operational master data, enrollment, assignments, workflow state, release metadata, and audit records.'],
  ['Approval', 'Draft grades move through submission, return/correction, Chairperson approval, and Registrar finalization safeguards.'],
  ['Blockchain', 'Registrar finalization writes Fabric Version 1. An authorized correction writes Version 2 or later while every earlier finalized version remains in immutable key history.'],
  ['World State', 'CouchDB represents only the latest/current Fabric grade state; immutable prior versions remain in the Fabric ledger history.'],
  ['Retrieval', 'Authorized APIs combine the appropriate PostgreSQL and finalized ledger data for each role.'],
];

export const storageMapping = [
  ['User accounts and profiles', 'Registrar / user registration', 'ASP.NET Auth API', 'PostgreSQL', 'No', 'Authorized account owners and administrators'],
  ['Enrollments, programs, curricula, sections', 'Registrar / Chairperson', 'ASP.NET academic APIs', 'PostgreSQL', 'No', 'Registrar, Chairperson, Faculty, Student as scoped'],
  ['Faculty assignments', 'Chairperson', 'Assignment service', 'PostgreSQL FacultySections', 'No', 'Chairperson, assigned Faculty, Registrar'],
  ['Draft, returned, and approved grades', 'Faculty / Chairperson', 'Grade workflow API', 'PostgreSQL pending_grade_records', 'No', 'Faculty and Chairperson within scope'],
  ['Finalized grade versions', 'Registrar finalization / authorized correction', 'Middleware Fabric gateway and chaincode', 'Hyperledger Fabric immutable key history', 'Yes', 'Chairperson, Registrar, System Administrator, released Student views'],
  ['Fabric current grade state', 'Fabric transaction', 'Chaincode', 'CouchDB world state', 'Ledger world state', 'Authorized system APIs / System Administrator browser'],
  ['Grade release metadata', 'Registrar', 'Grade API', 'PostgreSQL grade_releases by record and grade version', 'No', 'Registrar and Student visibility checks'],
  ['Support and audit data', 'System / administrators', 'ASP.NET services', 'PostgreSQL', 'No', 'Authorized administrators'],
  ['Temporary filters and forms', 'Current user', 'React', 'Application memory', 'No', 'Current browser session'],
];

const colors = { 'User Action': 'border-amber-300 bg-amber-50', Application: 'border-blue-300 bg-blue-50', Database: 'border-emerald-300 bg-emerald-50', Approval: 'border-violet-300 bg-violet-50', Blockchain: 'border-indigo-300 bg-indigo-50', 'World State': 'border-cyan-300 bg-cyan-50', Retrieval: 'border-slate-300 bg-slate-50' };

const DataLifeCycle = () => <div className="space-y-6">
  <header><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Verified System Architecture</p><h2 className="mt-1 text-2xl font-bold text-[#003366]">BlockGo Data Life Cycle</h2><p className="mt-2 max-w-4xl text-sm text-slate-600">Operational data remains in PostgreSQL. Finalized academic grade records are written to Hyperledger Fabric; CouchDB is Fabric world state, not a replacement for the application database.</p></header>
  <section className="grid gap-3 md:grid-cols-2 xl:flex xl:items-stretch" aria-label="Data life cycle flow">{stages.map(([title, description], index) => <React.Fragment key={title}><article className={`min-w-0 rounded-xl border p-4 xl:flex-1 ${colors[title]}`}><p className="text-xs font-bold uppercase tracking-wide">{title}</p><p className="mt-2 break-words text-sm text-slate-700">{description}</p></article>{index < stages.length - 1 ? <span aria-hidden="true" className="hidden self-center text-center text-xl text-slate-400 xl:block">→</span> : null}</React.Fragment>)}</section>
  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="font-bold text-[#003366]">Storage and retrieval mapping</h3><div className="mt-3 max-w-full overflow-x-auto"><table className="min-w-[1050px] table-fixed text-left text-sm"><thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600"><tr>{['Data Type', 'Entered By', 'Processed By', 'Primary Storage', 'Blockchain?', 'Retrieved By'].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead><tbody>{storageMapping.map((row) => <tr key={row[0]} className="border-t border-slate-200">{row.map((cell, index) => <td key={`${row[0]}-${index}`} className="break-words px-3 py-3 align-top">{cell}</td>)}</tr>)}</tbody></table></div></section>
  <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-bold text-[#003366]">Legend</h3><div className="mt-3 flex flex-wrap gap-2">{['User Action', 'Application', 'Database', 'Approval', 'Blockchain', 'World State'].map((item) => <span key={item} className={`rounded-full border px-3 py-1 text-xs font-semibold ${colors[item]}`}>{item}</span>)}</div><p className="mt-3 text-sm text-slate-600">Encrypted grading-sheet attachments may use IPFS where the grade workflow supplies an IPFS CID. The attachment is separate from the finalized Fabric grade record.</p></section>
</div>;

export default DataLifeCycle;
