import { buildLedgerHierarchy } from './registrarGradesLedger';

const clean = (value) => String(value ?? '').trim();
const identity = (value) => clean(value);
const display = (value, fallback = 'All') => clean(value) || fallback;
const activeFilter = (value) => clean(value) && clean(value).toLowerCase() !== 'all';
const programIdOf = (record) => identity(record.program_id ?? record.programId);
const facultyIdOf = (record) => identity(record.faculty_user_id ?? record.facultyUserId);
const academicSectionIdOf = (record) => identity(record.academic_section_id ?? record.academicSectionId);

const slug = (value, fallback, preserveCase = false) => (preserveCase ? clean(value) : clean(value).toLowerCase())
  .replace(/[^a-z0-9]+/gi, '-')
  .replace(/^-+|-+$/g, '') || fallback;

const displayDate = (record) => {
  const value = record.timestamp || record.recorded_at || record.date;
  if (!value) return '--';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? clean(value) : parsed.toLocaleString();
};

export const selectLedgerExportRecords = (records = [], scope = { type: 'all' }) => records.filter((record) => {
  if ((scope.type === 'program' || scope.type === 'faculty' || scope.type === 'section') && !identity(scope.programId)) return false;
  if ((scope.type === 'faculty' || scope.type === 'section') && !identity(scope.facultyUserId)) return false;
  if (scope.type === 'section' && (!identity(scope.academicSectionId) || !identity(scope.schoolYear) || !identity(scope.semester))) return false;
  if (scope.programId && programIdOf(record) !== identity(scope.programId)) return false;
  if (scope.facultyUserId && facultyIdOf(record) !== identity(scope.facultyUserId)) return false;
  if (scope.academicSectionId && academicSectionIdOf(record) !== identity(scope.academicSectionId)) return false;
  if (scope.schoolYear && clean(record.school_year || record.schoolYear) !== clean(scope.schoolYear)) return false;
  if (scope.semester && clean(record.semester).toLowerCase() !== clean(scope.semester).toLowerCase()) return false;
  return true;
});

export const getLedgerExportFilename = (scope = { type: 'all' }, hierarchy = [], filters = {}) => {
  const program = hierarchy[0];
  const faculty = program?.faculties?.[0];
  const section = faculty?.sections?.[0];
  const representedSchoolYears = [...new Set(hierarchy.flatMap((item) =>
    item.faculties.flatMap((facultyItem) => facultyItem.sections.map((sectionItem) => clean(sectionItem.schoolYear)))
  ).filter(Boolean))];
  const schoolYear = activeFilter(filters.schoolYear)
    ? clean(filters.schoolYear)
    : representedSchoolYears.length === 1 ? representedSchoolYears[0] : 'all-years';
  const parts = ['grades-ledger'];

  if (scope.type === 'program') parts.push(slug(program?.code, `program-${scope.programId}`, true));
  else if (scope.type === 'faculty') parts.push(slug(program?.code, `program-${scope.programId}`, true), slug(faculty?.name, `faculty-${scope.facultyUserId}`));
  else if (scope.type === 'section') parts.push(
    slug(section?.section, `section-${scope.academicSectionId}`, true),
    slug(section?.semester, 'semester', true)
  );
  else parts.push('all');

  parts.push(slug(schoolYear, 'all-years', true));
  return `${parts.join('-')}.pdf`;
};

const scopeTitle = (type) => ({
  program: 'Program Report',
  faculty: 'Faculty Report',
  section: 'Section Grade Report',
}[type] || 'Complete Grades Ledger');

const studentRows = (students) => students.map((student) => [
  student.studentNumber,
  student.studentName,
  display(student.gradePayload?.midterm, '--'),
  display(student.gradePayload?.finals ?? student.gradePayload?.final, '--'),
  display(student.gradePayload?.finalAverage ?? student.gradePayload?.grade, '--'),
  display(student.status, 'N/A'),
  displayDate(student),
]);

export const exportRegistrarGradesLedgerPdf = ({
  records = [],
  filters = {},
  scope = { type: 'all' },
  jsPDF: JsPdf = typeof window !== 'undefined' ? window.jspdf?.jsPDF : null,
  generatedAt = new Date(),
} = {}) => {
  const scopedRecords = selectLedgerExportRecords(records, scope);
  if (scopedRecords.length === 0) return { exported: false, reason: 'empty' };
  if (!JsPdf) throw new Error('jsPDF is unavailable.');

  const hierarchy = buildLedgerHierarchy(scopedRecords);
  const doc = new JsPdf('l', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 14;
  let cursorY = 18;

  doc.setTextColor(0, 51, 102);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('PAMANTASAN NG LUNGSOD NG VALENZUELA', pageWidth / 2, cursorY, { align: 'center' });
  doc.setFontSize(10);
  doc.text('BlockGO / Grade Records Management System', pageWidth / 2, cursorY + 6, { align: 'center' });
  doc.setFontSize(14);
  doc.text('Grades Ledger', pageWidth / 2, cursorY + 14, { align: 'center' });
  doc.setFontSize(11);
  doc.text(scopeTitle(scope.type), pageWidth / 2, cursorY + 21, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(8);
  cursorY += 31;
  const filterLines = [
    `Generated: ${generatedAt.toLocaleString()}`,
    `School Year: ${display(activeFilter(filters.schoolYear) ? filters.schoolYear : '', 'All')}`,
    `Semester: ${display(activeFilter(filters.semester) ? filters.semester : '', 'All')}`,
    `Term: ${display(activeFilter(filters.term) ? filters.term : '', 'All')}`,
    `Status: ${display(activeFilter(filters.status) ? filters.status : '', 'All')}`,
  ];
  if (activeFilter(filters.search)) filterLines.push(`Search: ${filters.search}`);
  filterLines.forEach((line, index) => doc.text(line, left + ((index % 3) * 90), cursorY + (Math.floor(index / 3) * 5)));
  cursorY += Math.ceil(filterLines.length / 3) * 5 + 4;

  const ensureRoom = (minimumHeight = 20) => {
    if (cursorY + minimumHeight <= pageHeight - 15) return;
    doc.addPage();
    cursorY = 16;
  };

  hierarchy.forEach((program) => {
    ensureRoom(24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 51, 102);
    doc.setFontSize(11);
    doc.text(`Program: ${program.code} - ${program.name}`, left, cursorY);
    cursorY += 7;

    program.faculties.forEach((faculty) => {
      ensureRoom(20);
      doc.setFontSize(9);
      doc.setTextColor(30, 30, 30);
      doc.text(`Faculty: ${faculty.name}`, left + 3, cursorY);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(`Faculty ID: ${faculty.userId || faculty.facultyNumber || '--'}  |  Email: ${faculty.email || '--'}`, left + 3, cursorY + 5);
      cursorY += 11;

      faculty.sections.forEach((section) => {
        ensureRoom(28);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(0, 51, 102);
        doc.text(`Section: ${section.section}`, left + 6, cursorY);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(70, 70, 70);
        doc.setFontSize(7.5);
        doc.text(`School Year: ${section.schoolYear || '--'}  |  Semester: ${section.semester || '--'}  |  Subjects: ${section.subjectCount}`, left + 6, cursorY + 5);
        cursorY += 11;

        section.subjects.forEach((subject) => {
          ensureRoom(24);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(30, 30, 30);
          doc.setFontSize(8);
          doc.text(
            `Subject: ${subject.subjectCode} - ${subject.subjectName || 'Title unavailable'}  |  Term: ${subject.term || '--'}  |  Status: ${subject.statuses.join(', ') || 'N/A'}`,
            left + 9,
            cursorY
          );

          doc.autoTable({
            head: [['Student No.', 'Student Name', 'Midterm', 'Final', 'Final Grade / Rating', 'Status', 'Submitted / Finalized']],
            body: studentRows(subject.students),
            startY: cursorY + 4,
            theme: 'grid',
            showHead: 'everyPage',
            rowPageBreak: 'avoid',
            pageBreak: 'auto',
            margin: { left: left + 9, right: left },
            headStyles: { fillColor: [0, 51, 102], textColor: 255, fontSize: 7, fontStyle: 'bold' },
            bodyStyles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
            columnStyles: {
              0: { cellWidth: 25 },
              1: { cellWidth: 48 },
              2: { cellWidth: 19, halign: 'center' },
              3: { cellWidth: 19, halign: 'center' },
              4: { cellWidth: 29, halign: 'center' },
              5: { cellWidth: 34 },
              6: { cellWidth: 48 },
            },
          });
          cursorY = (doc.lastAutoTable?.finalY || cursorY + 16) + 9;
        });
      });
    });
  });

  const totalPages = doc.internal.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(90, 90, 90);
    doc.text(`Page ${page} of ${totalPages}`, pageWidth - left, pageHeight - 7, { align: 'right' });
  }

  const filename = getLedgerExportFilename(scope, hierarchy, filters);
  doc.save(filename);
  return { exported: true, filename, recordCount: scopedRecords.length, pageCount: totalPages };
};
