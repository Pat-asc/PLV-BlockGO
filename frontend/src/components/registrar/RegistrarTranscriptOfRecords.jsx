import React, { useMemo, useState } from 'react';
import { fetchStudentTranscript } from '../../services/api';

const semesterLabel = (value) => ({ FIRST: 'First Semester', SECOND: 'Second Semester', MIDYEAR: 'Midyear' }[value] || value);

const RegistrarTranscriptOfRecords = ({ students = [] }) => {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [transcript, setTranscript] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return students.filter((student) => !query || [student.fullname, student.studentno, student.email]
      .some((value) => String(value || '').toLowerCase().includes(query))).slice(0, 100);
  }, [search, students]);

  const groupedRecords = useMemo(() => (transcript?.records || []).reduce((groups, record) => {
    const key = `${record.yearLevel}|${record.semester}|${record.schoolYear || 'Academic period pending'}`;
    groups[key] = groups[key] || [];
    groups[key].push(record);
    return groups;
  }, {}), [transcript]);

  const loadTranscript = async (studentId = selectedId) => {
    if (!studentId) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetchStudentTranscript(studentId);
      setTranscript(response.data);
    } catch (requestError) {
      setTranscript(null);
      setError(requestError.message || 'Unable to load the transcript.');
    } finally {
      setLoading(false);
    }
  };

  const exportPdf = () => {
    if (!transcript || !window.jspdf?.jsPDF) return;
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    const { student, curriculum, records, completeness } = transcript;
    const drawHeader = () => {
      doc.setTextColor(0, 51, 102);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.text('PAMANTASAN NG LUNGSOD NG VALENZUELA', 105, 15, { align: 'center' });
      doc.setFontSize(12);
      doc.text('OFFICIAL TRANSCRIPT OF RECORDS', 105, 22, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(40);
      doc.text(`${student.studentName}  |  ${student.studentNo}`, 14, 31);
      doc.text(`${student.programName} (${student.programCode})`, 14, 36);
      doc.text(`Curriculum: ${curriculum.curriculumName} ${curriculum.curriculumVersion}`, 14, 41);
    };
    drawHeader();
    doc.autoTable({
      startY: 47,
      head: [['School Year', 'Year / Semester', 'Code', 'Descriptive Title', 'Units', 'Final Grade', 'Standing']],
      body: records.map((record) => [record.schoolYear || '—', `${record.yearLevel} / ${semesterLabel(record.semester)}`,
        record.subjectCode, record.subjectTitle, Number(record.units).toFixed(2), record.grade ?? '—', record.standing]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [0, 51, 102] },
      columnStyles: { 3: { cellWidth: 63 } },
      didDrawPage: ({ pageNumber }) => {
        if (pageNumber > 1) drawHeader();
        doc.setFontSize(8);
        doc.text(`Page ${pageNumber}`, 196, 289, { align: 'right' });
      },
      margin: { top: 47, bottom: 14 },
    });
    const finalY = Math.min((doc.lastAutoTable?.finalY || 50) + 8, 272);
    doc.setFontSize(9);
    doc.text(`Curriculum completeness: ${completeness.completedSubjects}/${completeness.requiredSubjects}`, 14, finalY);
    doc.text('Prepared by the Office of the University Registrar', 14, finalY + 7);
    doc.save(`TOR_${student.studentNo || student.studentName.replace(/\s+/g, '_')}.pdf`);
  };

  const printTranscript = () => window.print();

  return (
    <section className="space-y-5 print:bg-white">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm print:hidden">
        <h2 className="text-2xl font-bold text-[#003366]">Transcript of Records</h2>
        <p className="mt-1 text-sm text-slate-500">Generate a Registrar-authorized TOR from explicitly released, finalized ledger grades.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student number, name, or email"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Select student</option>
            {filteredStudents.map((student) => <option key={student.id} value={student.id}>{student.studentno || 'No ID'} — {student.fullname}</option>)}
          </select>
          <button type="button" disabled={!selectedId || loading} onClick={() => loadTranscript()} className="rounded-xl bg-[#003366] px-5 py-2 text-sm font-bold text-white disabled:opacity-50">
            {loading ? 'Loading…' : 'Generate TOR'}
          </button>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>

      {transcript && <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="border-b border-slate-200 pb-5 text-center">
          <h1 className="text-xl font-bold text-[#003366]">PAMANTASAN NG LUNGSOD NG VALENZUELA</h1>
          <p className="mt-1 font-bold tracking-wide">OFFICIAL TRANSCRIPT OF RECORDS</p>
        </header>
        <div className="mt-5 grid gap-2 text-sm md:grid-cols-2">
          <p><strong>Student:</strong> {transcript.student.studentName}</p><p><strong>Student No.:</strong> {transcript.student.studentNo}</p>
          <p><strong>Program:</strong> {transcript.student.programName}</p><p><strong>Batch:</strong> {transcript.student.batchYear || '—'}</p>
          <p className="md:col-span-2"><strong>Curriculum:</strong> {transcript.curriculum.curriculumName} {transcript.curriculum.curriculumVersion}</p>
        </div>
        <div className="mt-6 space-y-5">
          {Object.entries(groupedRecords).map(([key, records]) => {
            const [year, semester, schoolYear] = key.split('|');
            return <section key={key} className="break-inside-avoid">
              <h3 className="mb-2 font-bold text-[#003366]">Year {year} — {semesterLabel(semester)} ({schoolYear})</h3>
              <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-xs">
                <thead><tr className="bg-slate-100"><th className="border p-2">Code</th><th className="border p-2">Descriptive Title</th><th className="border p-2">Units</th><th className="border p-2">Grade</th><th className="border p-2">Standing</th></tr></thead>
                <tbody>{records.map((record) => <tr key={record.subjectCode}><td className="border p-2">{record.subjectCode}</td><td className="border p-2">{record.subjectTitle}</td><td className="border p-2">{record.units}</td><td className="border p-2">{record.grade ?? '—'}</td><td className="border p-2">{record.standing}</td></tr>)}</tbody>
              </table></div>
            </section>;
          })}
        </div>
        <div className={`mt-6 rounded-xl p-4 text-sm ${transcript.completeness.isComplete ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
          <strong>{transcript.completeness.isComplete ? 'Curriculum complete' : 'Curriculum incomplete'}:</strong> {transcript.completeness.completedSubjects}/{transcript.completeness.requiredSubjects} required subjects completed.
          {!transcript.completeness.isComplete && <p className="mt-1">Official completion certification must not be issued until the listed missing, failed, or unreleased subjects are resolved.</p>}
        </div>
        <div className="mt-6 flex gap-3 print:hidden">
          <button type="button" onClick={exportPdf} className="rounded-xl bg-[#003366] px-4 py-2 text-sm font-bold text-white">Download multi-page PDF</button>
          <button type="button" onClick={printTranscript} className="rounded-xl border border-[#003366] px-4 py-2 text-sm font-bold text-[#003366]">Print</button>
        </div>
      </article>}
    </section>
  );
};

export default RegistrarTranscriptOfRecords;
