export const STUDENT_BATCHES_KEY = "chairpersonStudentBatches";
export const STUDENT_SUBMISSION_LOGS_KEY = "chairpersonSubmissionLogs";
export const AVAILABLE_YEAR_LEVELS = [
  "1st Year",
  "2nd Year",
  "3rd Year",
  "4th Year",
];
export const AVAILABLE_SECTION_CODES = [
  "1-1",
  "1-2",
  "1-3",
  "1-4",
  "2-1",
  "2-2",
  "3-1",
  "3-2",
  "4-1",
  "4-2",
];

export const YEAR_LEVEL_PREFIXES = {
  "1st Year": "1",
  "2nd Year": "2",
  "3rd Year": "3",
  "4th Year": "4",
};

// ECMAScript Date uses the proleptic Gregorian calendar. UTC avoids a local
// timezone rollover changing the year near midnight on January 1.
export const getGregorianCalendarYear = (date = new Date()) =>
  date.getUTCFullYear();

const getStudentIdYearPrefix = (year = "") => {
  const match = String(year).trim().match(/^(\d{4})(?:\D|$)/);
  return match ? match[1].slice(-2) : "";
};

export const getNextStudentId = (
  year = "",
  batches = [],
  persistedHighestSequence = 0
) => {
  const yearPrefix = getStudentIdYearPrefix(year);
  if (!yearPrefix) return "";

  const studentIdPattern = new RegExp(`^${yearPrefix}-(\\d{4})$`);
  let highestSequence = Math.max(Number(persistedHighestSequence) || 0, 0);

  batches.forEach((batch) => {
    [...(batch.students || []), ...(batch.removedStudents || [])].forEach(
      (student) => {
        const match = String(student?.studentId || "").trim().match(studentIdPattern);
        if (!match) return;
        highestSequence = Math.max(highestSequence, Number(match[1]));
      }
    );
  });

  const nextSequence = highestSequence + 1;
  return nextSequence <= 9999
    ? `${yearPrefix}-${String(nextSequence).padStart(4, "0")}`
    : "";
};

const PROGRAM_SECTION_PREFIXES = {
  "Bachelor of Early Childhood Education": "BECEd",
  "Bachelor of Secondary Education major in English": "BSEd English",
  "Bachelor of Secondary Education major in Filipino": "BSEd Filipino",
  "Bachelor of Secondary Education major in Mathematics": "BSEd Mathematics",
  "Bachelor of Secondary Education major in Science": "BSEd Science",
  "Bachelor of Secondary Education major in Social Studies": "BSEd Social Studies",
  "Bachelor of Science in Civil Engineering": "BSCE",
  "Bachelor of Science in Electrical Engineering": "BSEE",
  "Bachelor of Science in Information Technology": "BSIT",
  "Bachelor of Arts in Communication": "BAC",
  "Bachelor of Science in Psychology": "BSP",
  "Bachelor of Science in Social Work": "BSSW",
  "Bachelor of Public Administration": "BPA",
  "Bachelor of Science in Accountancy": "BSA",
  "Bachelor of Science in Business Administration major in Financial Management":
    "BSBA FM",
  "Bachelor of Science in Business Administration major in Human Resource Management":
    "BSBA HRM",
  "Bachelor of Science in Business Administration major in Marketing Management":
    "BSBA MM",
};

export const getProgramSectionPrefix = (program = "") => {
  const normalizedProgram = String(program).trim();
  if (/^[A-Z][A-Z0-9-]{1,19}$/.test(normalizedProgram)) return normalizedProgram;

  const matched = Object.entries(PROGRAM_SECTION_PREFIXES).find(
    ([fullName]) => fullName.toLowerCase() === normalizedProgram.toLowerCase()
  );
  if (matched) return matched[1];

  return PROGRAM_SECTION_PREFIXES[normalizedProgram] ||
  normalizedProgram
    .split(/\s+/)
    .filter((word) => /^[A-Z]/.test(word))
    .map((word) => word[0])
    .join("") ||
  "SECTION";
};

export const getCanonicalProgramName = (program = "") => {
  const trimmed = String(program || "").trim();
  if (!trimmed) return "";
  if (/^bac$/i.test(trimmed) || /^bachelor of arts in communication$/i.test(trimmed)) {
    return "Bachelor of Arts in Communication";
  }
  const exactKey = Object.keys(PROGRAM_SECTION_PREFIXES).find(
    (key) => key.toLowerCase() === trimmed.toLowerCase()
  );
  if (exactKey) return exactKey;

  return trimmed;
};

export const areProgramsEquivalent = (progA = "", progB = "") => {
  const rawA = String(progA || "").trim();
  const rawB = String(progB || "").trim();
  if (!rawA || !rawB) return false;
  if (rawA.toLowerCase() === rawB.toLowerCase()) return true;

  const normA = getCanonicalProgramName(rawA);
  const normB = getCanonicalProgramName(rawB);
  if (normA.toLowerCase() === normB.toLowerCase()) return true;

  const prefixA = getProgramSectionPrefix(normA).toLowerCase();
  const prefixB = getProgramSectionPrefix(normB).toLowerCase();
  return prefixA === prefixB;
};

export const consolidateSectioningBatches = (batches = []) => {
  if (!Array.isArray(batches) || batches.length === 0) return [];

  const groups = new Map();

  batches.forEach((batch) => {
    if (!batch) return;
    const canonicalProgram = getCanonicalProgramName(batch.program);
    const schoolYear = batch.schoolYear || batch.batchYear || "";
    const semester = batch.semester || "";
    const isPromotion = batch.status === "Promoted" || String(batch.key || "").includes("promotion");
    const groupKey = [
      canonicalProgram.toLowerCase(),
      schoolYear.toLowerCase(),
      semester.toLowerCase(),
      isPromotion ? "promotion" : "active",
    ].join("|");

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push({ ...batch, program: canonicalProgram });
  });

  const consolidated = [];

  groups.forEach((groupBatches) => {
    const primary = groupBatches.reduce((best, curr) => {
      const bestTime = new Date(best.lastSectionedAt || best.submittedAt || 0).getTime();
      const currTime = new Date(curr.lastSectionedAt || curr.submittedAt || 0).getTime();
      return currTime >= bestTime ? curr : best;
    }, groupBatches[0]);

    const canonicalProgram = primary.program;
    const sectionPlansMap = new Map();
    groupBatches.forEach((batch) => {
      (batch.sectionPlans || []).forEach((section) => {
        const idKey = section.academicSectionId || section.id || section.sectionCode;
        if (!sectionPlansMap.has(idKey)) {
          sectionPlansMap.set(idKey, {
            ...section,
            sectionName: section.sectionName || getDefaultSectionName(canonicalProgram, section.sectionCode),
          });
        }
      });
    });

    const removedStudentsMap = new Map();
    groupBatches.forEach((batch) => {
      (batch.removedStudents || []).forEach((student) => {
        const id = String(student?.studentId || "").trim().toLowerCase();
        if (!id) return;
        if (!removedStudentsMap.has(id)) {
          removedStudentsMap.set(id, { ...student });
        } else {
          const existing = removedStudentsMap.get(id);
          if (!existing.removalReason && student.removalReason) {
            removedStudentsMap.set(id, { ...existing, ...student });
          }
        }
      });
    });

    const removedStudentIds = new Set(removedStudentsMap.keys());

    const studentsMap = new Map();
    groupBatches.forEach((batch) => {
      (batch.students || []).forEach((student) => {
        const id = String(student?.studentId || "").trim().toLowerCase();
        if (!id || removedStudentIds.has(id)) return;
        if (
          student.isActive === false ||
          student.is_active === false ||
          String(student.status || "").toUpperCase() === "DROPPED" ||
          String(student.accountStatus || "").toUpperCase() === "REVOKED"
        ) {
          return;
        }
        if (!studentsMap.has(id)) {
          studentsMap.set(id, {
            ...student,
            sectionName: student.sectionName || getDefaultSectionName(canonicalProgram, student.sectionCode),
          });
        }
      });
    });

    const consolidatedBatch = {
      ...primary,
      program: canonicalProgram,
      key: primary.key
        ? (primary.key.startsWith("BAC|") || primary.key.startsWith("bac|")
            ? primary.key.replace(/^bac\|/i, `${canonicalProgram}|`)
            : primary.key)
        : [
            canonicalProgram,
            primary.schoolYear || primary.batchYear,
            primary.semester,
            primary.status === "Promoted" ? "promotion" : "",
          ].filter(Boolean).join("|"),
      submittedTo: `${canonicalProgram} Chairperson`,
      sectionPlans: Array.from(sectionPlansMap.values()),
      students: Array.from(studentsMap.values()),
      removedStudents: Array.from(removedStudentsMap.values()),
    };

    consolidated.push(consolidatedBatch);
  });

  return consolidated;
};

export const getDefaultSectionName = (program = "", sectionCode = "") =>
  `${getProgramSectionPrefix(program)} ${sectionCode}`.trim();

const normalizeHeader = (value = "") =>
  String(value)
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const getColumnIndex = (headers = [], acceptedHeaders = []) =>
  acceptedHeaders
    .map((header) => headers.indexOf(header))
    .find((index) => index !== -1) ?? -1;

export const parseCsvRows = (text = "") => {
  const rows = [];
  let row = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        field += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === "," && !insideQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(field);
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => String(value).trim())) rows.push(row);

  return rows;
};

const escapeCsvValue = (value = "") => {
  const stringValue = String(value ?? "");

  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
};

export const buildCsvContent = (rows = []) =>
  rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");

export const getStudentMiddleName = (student = {}) =>
  student.middleName || student.middleInitial || "";

export const parseStudentIdSpreadsheet = (text = "") => {
  const rows = parseCsvRows(text);

  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => normalizeHeader(header));
  const studentIdIndex = getColumnIndex(headers, [
    "student id",
    "student no",
    "student number",
    "id number",
  ]);
  const sexIndex = getColumnIndex(headers, ["sex", "gender"]);
  const lastNameIndex = getColumnIndex(headers, ["last name", "surname", "last"]);
  const firstNameIndex = getColumnIndex(headers, [
    "first name",
    "given name",
    "first",
  ]);
  const middleNameIndex = getColumnIndex(headers, [
    "middle initial",
    "mi",
    "m i",
    "middle name",
  ]);
  const yearLevelIndex = getColumnIndex(headers, ["year level", "year", "level"]);

  if (
    studentIdIndex === -1 ||
    sexIndex === -1 ||
    lastNameIndex === -1 ||
    firstNameIndex === -1 ||
    middleNameIndex === -1
  ) {
    return [];
  }

  return rows
    .slice(1)
    .map((values) => ({
      studentId: values[studentIdIndex]?.trim() || "",
      sex: values[sexIndex]?.trim() || "",
      lastName: values[lastNameIndex]?.trim() || "",
      firstName: values[firstNameIndex]?.trim() || "",
      middleName: values[middleNameIndex]?.trim() || "",
      middleInitial: values[middleNameIndex]?.trim() || "",
      yearLevel:
        yearLevelIndex === -1 ? "1st Year" : values[yearLevelIndex]?.trim() || "1st Year",
      sectionCode: "",
    }))
    .filter(
      (student) =>
        student.studentId &&
        student.sex &&
        student.lastName &&
        student.firstName &&
        student.middleName
    );
};

export const buildStudentCsvContent = (students = [], options = {}) => {
  const { includeYearLevel = true } = options;
  const header = [
    "Student ID",
    "Sex",
    "Last Name",
    "First Name",
    "Middle Name",
  ];

  if (includeYearLevel) {
    header.push("Year Level");
  }

  const rows = students.map((student) =>
    includeYearLevel
      ? [
          student.studentId,
          student.sex,
          student.lastName,
          student.firstName,
          getStudentMiddleName(student),
          student.yearLevel || "",
        ]
      : [
          student.studentId,
          student.sex,
          student.lastName,
          student.firstName,
          getStudentMiddleName(student),
        ]
  );

  return buildCsvContent([header, ...rows]);
};

export const downloadCsvFile = (csvContent = "", fileName = "students.csv") => {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const downloadStudentCsvFile = (students = [], fileName = "students.csv") => {
  downloadCsvFile(buildStudentCsvContent(students), fileName);
};

export const buildStudentMasterlistFromBatches = (batches = []) =>
  batches
    .filter((batch) => batch.status !== "Promoted")
    .flatMap((batch) =>
      (batch.students || []).map((student) => ({
        studentId: student.studentId,
        sex: student.sex || "",
        firstName: student.firstName || "",
        lastName: student.lastName || "",
        middleName: getStudentMiddleName(student),
        middleInitial: student.middleInitial || getStudentMiddleName(student),
        program: batch.program,
        yearLevel: student.yearLevel || "",
        section: student.sectionCode
          ? student.sectionName ||
            getDefaultSectionName(batch.program, student.sectionCode)
          : "",
        schoolYear: batch.batchYear,
        semester: batch.semester || student.semester || "",
        studentType: student.studentType || "Regular",
        remarks: student.remarks || "",
        repeatedSubjects: student.repeatedSubjects || "",
        irregularSubjects: student.irregularSubjects || [],
      }))
    );

export const buildGroupedSectionLists = (students = []) => {
  const grouped = {};

  students.forEach((student) => {
    if (!student.section || !student.yearLevel) return;

    const key = [
      student.program,
      student.yearLevel,
      student.section,
      student.schoolYear,
      student.semester,
    ].join("|");

    if (!grouped[key]) {
      grouped[key] = {
        key,
        program: student.program,
        yearLevel: student.yearLevel,
        section: student.section,
        schoolYear: student.schoolYear,
        semester: student.semester || "",
        students: [],
      };
    }

    grouped[key].students.push({
      studentId: student.studentId,
      sex: student.sex || "",
      firstName: student.firstName || "",
      lastName: student.lastName || "",
      middleName: getStudentMiddleName(student),
      middleInitial: student.middleInitial || getStudentMiddleName(student),
      studentType: student.studentType || "Regular",
      remarks: student.remarks || "",
      repeatedSubjects: student.repeatedSubjects || "",
      irregularSubjects: student.irregularSubjects || [],
    });
  });

  return Object.values(grouped);
};

export const syncSectionedStudentsToStorage = (batches = []) => {
  const studentMasterlist = buildStudentMasterlistFromBatches(batches);
  const groupedSections = buildGroupedSectionLists(studentMasterlist);
  const existingSectionKeys = new Set(
    groupedSections.map((section) =>
      [
        section.program,
        section.yearLevel,
        section.section,
        section.schoolYear,
        section.semester,
      ].join("|")
    )
  );
  const emptySectionPlans = batches
    .filter((batch) => batch.status !== "Promoted")
    .flatMap((batch) =>
      (batch.sectionPlans || [])
        .map((section) => {
          const sectionName =
            section.sectionName ||
            getDefaultSectionName(batch.program, section.sectionCode);
          const key = [
            batch.program,
            section.yearLevel || "",
            sectionName,
            batch.batchYear,
            batch.semester || "",
          ].join("|");

          return {
            key,
            program: batch.program,
            yearLevel: section.yearLevel || "",
            section: sectionName,
            schoolYear: batch.batchYear,
            semester: batch.semester || "",
            students: [],
          };
        })
        .filter((section) => {
          if (existingSectionKeys.has(section.key)) return false;
          existingSectionKeys.add(section.key);
          return true;
        })
    );

  localStorage.setItem("studentMasterlist", JSON.stringify(studentMasterlist));
  localStorage.setItem(
    "studentSections",
    JSON.stringify([...groupedSections, ...emptySectionPlans])
  );
};
