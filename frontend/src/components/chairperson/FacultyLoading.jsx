import React, { useEffect, useMemo, useState } from "react";
import {
  AVAILABLE_YEAR_LEVELS,
  STUDENT_BATCHES_KEY,
  getDefaultSectionName,
  parseCsvRows,
  parseStudentIdSpreadsheet,
} from "../../utils/studentSectioningHelpers";
import {
  assignFacultyLoadToBackend,
  bulkAssignFacultyLoads,
  fetchApprovedFaculties,
  fetchFacultyAssignmentOptions,
  unassignFacultySection,
} from "../../services/api";
import { downloadTemplateButtonClass } from "../shared/downloadButtonStyles";
import { pushAssignmentsSharedState } from "../../utils/sharedClientState";

const SEMESTER_OPTIONS = ["1st Semester", "2nd Semester", "Summer"];
const DAY_OPTIONS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const normalizeText = (value = "") => String(value).trim().toLowerCase();
const normalizeHeader = (value = "") =>
  normalizeText(String(value).replace(/[_-]+/g, " "));
const getFacultyDisplayName = (faculty = {}) =>
  faculty.fullname ||
  faculty.fullName ||
  faculty.name ||
  faculty.email ||
  "Unnamed Faculty";
const getFacultyKey = (faculty = {}) =>
  String(faculty.id || faculty.email || getFacultyDisplayName(faculty));
const getFacultyDepartment = (faculty = {}) =>
  faculty.department || faculty.program || "";
const buildFacultyLoadingKey = (item = {}) =>
  [
    normalizeText(item.facultyUserId || item.facultyId),
    normalizeText(item.academicSectionId || item.sectionName || item.section),
    normalizeText(item.schoolYear),
    normalizeText(item.semester),
    normalizeText(item.subjectCode || item.subject),
  ].join("|");
const getCsvRowValue = (row = {}, acceptedHeaders = []) => {
  for (const header of acceptedHeaders) {
    const value = row[normalizeHeader(header)];
    if (String(value || "").trim()) {
      return String(value).trim();
    }
  }

  return "";
};
export const FACULTY_LOADING_CSV_TEMPLATE =
  "Faculty Name,Subject Title,Subject Code,Academic Section ID,Section,School Year,Semester,Units,Day,Time\n" +
  "Juan Dela Cruz,Introduction to Computing,IT 101,42,BSIT 1-1,2026-2027,1st Semester,3,Monday,7:00 AM - 9:00 AM\n" +
  "Maria Santos,Computer Programming 1,IT 102,43,BSIT 1-2,2026-2027,1st Semester,3,Tuesday,10:00 AM - 12:00 PM";
const mapFacultyLoadingRows = (csvText = "") => {
  const rows = parseCsvRows(csvText);

  if (rows.length < 2) {
    return { headers: [], rows: [] };
  }

  const [headerRow = [], ...dataRows] = rows;
  const headers = headerRow.map((header) => normalizeHeader(header));
  const mappedRows = dataRows
    .filter((row) => row.some((value) => String(value).trim()))
    .map((row) =>
      headers.reduce((record, header, index) => {
        record[header] = row[index]?.trim() || "";
        return record;
      }, {})
    );

  return { headers, rows: mappedRows };
};

function FacultyLoading({ chairpersonDepartment = "", assignmentMode = "all" }) {
  const [selectedFacultyId, setSelectedFacultyId] = useState("");
  const [selectedYearLevel, setSelectedYearLevel] = useState("1st Year");
  const [selectedSectionName, setSelectedSectionName] = useState("");
  const [subjectCode, setSubjectCode] = useState("");
  const [subjectTitle, setSubjectTitle] = useState("");
  const [units, setUnits] = useState("");
  const [semester, setSemester] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleDay, setScheduleDay] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [facultyLoadingFile, setFacultyLoadingFile] = useState(null);
  const [facultyLoadingPreview, setFacultyLoadingPreview] = useState([]);
  const [facultyLoadingErrors, setFacultyLoadingErrors] = useState([]);
  const [facultyLoadingSummary, setFacultyLoadingSummary] = useState(null);
  const [approvedFaculties, setApprovedFaculties] = useState([]);
  const [assignmentOptions, setAssignmentOptions] = useState({ sections: [], subjects: [], schoolYears: [] });
  const [isBulkSaving, setIsBulkSaving] = useState(false);

  const [savedAssignments, setSavedAssignments] = useState(() => {
    const saved = localStorage.getItem("registrarAssignments");
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    const handleSharedStateChanged = (event) => {
      const keys = event.detail?.keys || [];
      if (!keys.includes("registrarAssignments")) return;

      try {
        const saved = localStorage.getItem("registrarAssignments");
        setSavedAssignments(saved ? JSON.parse(saved) : []);
      } catch (error) {
        console.warn("Failed to refresh assignments from shared state.", error);
      }
    };

    window.addEventListener(
      "blockgo:shared-client-state-changed",
      handleSharedStateChanged
    );

    return () =>
      window.removeEventListener(
        "blockgo:shared-client-state-changed",
        handleSharedStateChanged
      );
  }, []);

  useEffect(() => {
    let active = true;
    const loadAssignmentOptions = async () => {
      if (!chairpersonDepartment) return;
      try {
        const response = await fetchFacultyAssignmentOptions(chairpersonDepartment);
        if (active) {
          setAssignmentOptions({
            sections: response.sections || [],
            subjects: response.subjects || [],
            schoolYears: response.schoolYears || [],
          });
        }
      } catch (error) {
        if (active) setFacultyLoadingErrors([error.message || "Unable to load authoritative assignment options."]);
      }
    };
    loadAssignmentOptions();
    return () => { active = false; };
  }, [chairpersonDepartment]);

  const studentSections =
    JSON.parse(localStorage.getItem("studentSections")) || [];
  const studentBatches =
    JSON.parse(localStorage.getItem(STUDENT_BATCHES_KEY)) || [];

  const createdSections = studentBatches
    .filter((batch) => batch.status !== "Promoted")
    .flatMap((batch) =>
      (batch.sectionPlans || []).map((section) => {
        const sectionName =
          section.sectionName ||
          getDefaultSectionName(batch.program, section.sectionCode);
        const yearLevel = section.yearLevel || "";

        return {
          key: [
            batch.program,
            yearLevel,
            sectionName,
            batch.batchYear,
            batch.semester || "",
          ].join("|"),
          program: batch.program,
          yearLevel,
          section: sectionName,
          schoolYear: batch.batchYear,
          semester: batch.semester || "",
          students: (batch.students || [])
            .filter(
              (student) =>
                student.sectionCode === section.sectionCode &&
                (student.yearLevel || yearLevel) === yearLevel
            )
            .map((student) => ({
              studentId: student.studentId,
              sex: student.sex || "",
              firstName: student.firstName || "",
              lastName: student.lastName || "",
              middleInitial: student.middleInitial || "",
              studentType: student.studentType || "Regular",
              remarks: student.remarks || "",
              repeatedSubjects: student.repeatedSubjects || "",
              irregularSubjects: student.irregularSubjects || [],
            })),
        };
      })
    );
  const sectionOptions = [
    ...studentSections,
    ...createdSections.filter(
      (createdSection) =>
        !studentSections.some(
          (section) =>
            section.program === createdSection.program &&
            section.yearLevel === createdSection.yearLevel &&
            section.section === createdSection.section &&
            section.schoolYear === createdSection.schoolYear &&
            (section.semester || "") === (createdSection.semester || "")
        )
    ),
  ];

  const selectedProgram = chairpersonDepartment;

  useEffect(() => {
    const loadApprovedFaculty = async () => {
      try {
        const response = await fetchApprovedFaculties();
        if (response.status === "Success") {
          setApprovedFaculties(response.faculties || []);
        }
      } catch (error) {
        console.error("Failed to load approved faculties:", error);
      }
    };

    loadApprovedFaculty();
  }, []);

  const programAliases = new Set([
    normalizeText(selectedProgram),
    ...assignmentOptions.sections.flatMap((section) => [
      normalizeText(section.programCode),
      normalizeText(section.department),
    ]),
  ]);
  const filteredFaculty = approvedFaculties.filter((faculty) =>
    programAliases.has(normalizeText(getFacultyDepartment(faculty)))
  );

  const filteredSections = sectionOptions.filter(
    (section) =>
      section.program === selectedProgram &&
      section.yearLevel === selectedYearLevel
  );

  const selectedFaculty = filteredFaculty.find(
    (faculty) => getFacultyKey(faculty) === selectedFacultyId
  );

  const selectedSection = filteredSections.find(
    (section) => section.section === selectedSectionName
  );

  const selectedDaysText = scheduleDay;

  const resetForm = () => {
    setSelectedFacultyId("");
    setSelectedSectionName("");
    setSubjectCode("");
    setSubjectTitle("");
    setUnits("");
    setSemester("");
    setScheduleTime("");
    setScheduleDate("");
    setScheduleDay("");
    setSelectedFile(null);
  };

  const handleDistributeSectionToFaculty = async () => {
    if (
      !selectedProgram ||
      !selectedFacultyId ||
      !selectedSectionName ||
      !subjectCode.trim() ||
      !subjectTitle.trim() ||
      !units.trim() ||
      !semester.trim()
    ) {
      alert("Please complete the required fields.");
      return;
    }

    if (!selectedSection) {
      alert("Selected section was not found.");
      return;
    }

    if (!selectedFaculty) {
      alert("Selected faculty was not found.");
      return;
    }

    if (selectedFile && !selectedFile.name.toLowerCase().endsWith(".csv")) {
      alert("Please upload the section roster in CSV format.");
      return;
    }

    const saveAssignment = async () => {
      const alreadyExists = savedAssignments.some(
        (item) =>
          String(item.facultyId) === String(selectedFacultyId) &&
          item.sectionName === selectedSectionName &&
          item.schoolYear === selectedSection.schoolYear &&
          normalizeText(item.semester) === normalizeText(semester) &&
          normalizeText(item.subjectCode) === normalizeText(subjectCode)
      );

      if (alreadyExists) {
        alert("This faculty section distribution already exists.");
        return;
      }

      const newAssignment = {
        id: null,
        facultyId: selectedFacultyId,
        facultyEmail: selectedFaculty.email,
        facultyName: getFacultyDisplayName(selectedFaculty),
        program: selectedProgram,
        sectionName: selectedSection.section,
        yearLevel: selectedSection.yearLevel,
        subjectCode: subjectCode.trim(),
        subjectTitle: subjectTitle.trim(),
        units: units.trim(),
        schedule: scheduleTime.trim(),
        date: scheduleDate,
        day: selectedDaysText,
        schoolYear: selectedSection.schoolYear,
        semester: semester.trim(),
        loadMode: "Manual Section Distribution",
        rosterFileName: "Canonical enrollment roster",
        rosterStudents: [],
        uploadedAt: new Date().toISOString(),
      };

      let serverResult;
      try {
        serverResult = await assignFacultyLoadToBackend(newAssignment);
      } catch (error) {
        alert(error.message || "The server rejected this faculty assignment.");
        return;
      }
      const savedAssignment = {
        ...newAssignment,
        id: serverResult.assignment?.id,
        academicSectionId: serverResult.assignment?.academicSectionId,
      };
      const updatedAssignments = [...savedAssignments, savedAssignment];
      setSavedAssignments(updatedAssignments);
      localStorage.setItem(
        "registrarAssignments",
        JSON.stringify(updatedAssignments)
      );
      pushAssignmentsSharedState();
      alert("Section distributed to faculty successfully.");
      resetForm();
    };

    if (!selectedFile) {
      await saveAssignment();
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      const text = event.target?.result;

      if (!text) {
        alert("Unable to read the uploaded CSV file.");
        return;
      }

      const parsedStudents = parseStudentIdSpreadsheet(text);

      if (!parsedStudents.length) {
        alert(
          "The section CSV must contain Student ID, Sex, Last Name, First Name, and Middle Initial columns with valid rows."
        );
        return;
      }

      saveAssignment();
    };

    reader.readAsText(selectedFile);
  };

  const findBulkSectionById = (academicSectionId = "") => {
    const requestedId = Number(academicSectionId);
    if (!Number.isInteger(requestedId) || requestedId <= 0) return null;
    return assignmentOptions.sections.find((section) => Number(section.id) === requestedId) || null;
  };

  const normalizeSemesterCode = (value = "") => {
    const normalized = normalizeText(value).replace(/[_-]+/g, " ");
    if (["first", "1", "1st", "first semester", "1st semester"].includes(normalized)) return "FIRST";
    if (["second", "2", "2nd", "second semester", "2nd semester"].includes(normalized)) return "SECOND";
    if (["midyear", "mid year", "summer"].includes(normalized)) return "MIDYEAR";
    return "";
  };

  const formatYearLevel = (value) => {
    const number = Number(value);
    return `${number}${number === 1 ? "st" : number === 2 ? "nd" : number === 3 ? "rd" : "th"} Year`;
  };

  const findFacultyForLoadingRow = (row = {}) => {
    const facultyId = getCsvRowValue(row, ["faculty id", "id", "faculty email", "email", "prof email"]);
    const facultyName = getCsvRowValue(row, [
      "faculty name",
      "faculty",
      "name",
      "full name",
      "professor",
      "instructor",
      "teacher",
      "prof name",
      "prof"
    ]);

    if (facultyId) {
      return (
        filteredFaculty.find(
          (item) =>
            normalizeText(getFacultyKey(item)) === normalizeText(facultyId) ||
            normalizeText(item.email) === normalizeText(facultyId)
        ) || null
      );
    }

    if (facultyName) {
      return (
        filteredFaculty.find(
          (item) =>
            normalizeText(getFacultyDisplayName(item)) === normalizeText(facultyName)
        ) || null
      );
    }

    return null;
  };

  const buildFacultyLoadingPreview = (rows, headers = []) => {
    const previewRows = [];
    const errors = [];
    const duplicateKeys = new Set();
    const knownSections = assignmentOptions.sections
      .map((section) => `${section.programCode} ${section.section}`)
      .sort();
    const hasFacultyIdentifierColumn = headers.some(h => ["faculty id", "id", "faculty email", "email", "prof email", "faculty name", "faculty", "name", "full name", "professor", "instructor", "teacher", "prof name", "prof"].includes(h));
    const hasSubjectCodeColumn = headers.some(h => ["subject code", "course code", "code", "course", "subj code", "subj"].includes(h));
    const hasAcademicSectionIdColumn = headers.some(h => ["academic section id", "academic_section_id", "section id"].includes(h));
    const hasSchoolYearColumn = headers.some(h => ["school year", "academic year", "schoolyear"].includes(h));
    const hasSemesterColumn = headers.some(h => ["semester", "term"].includes(h));

    if (
      !hasFacultyIdentifierColumn ||
      !hasSubjectCodeColumn ||
      !hasAcademicSectionIdColumn ||
      !hasSchoolYearColumn ||
      !hasSemesterColumn
    ) {
      return {
        previewRows,
        errors: [
          "Missing required CSV headers. Please ensure columns exist for: Faculty (ID, Email, or Name), Subject Code, Academic Section ID, School Year, and Semester.",
        ],
        summary: {
          totalRows: rows.length,
          acceptedRows: 0,
          rejectedRows: rows.length,
        },
      };
    }

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const facultyName = getCsvRowValue(row, [
        "faculty name",
        "faculty",
        "name",
        "full name",
        "professor",
        "instructor",
        "teacher",
        "prof name",
        "prof"
      ]);
      const facultyId = getCsvRowValue(row, ["faculty id", "id", "faculty email", "email", "prof email"]);
      const rowSubjectCode = getCsvRowValue(row, ["subject code", "course code", "code", "course", "subj code", "subj"]);
      const rowSubjectTitle = getCsvRowValue(row, ["subject title", "subject name", "subject", "descriptive title", "description"]) || rowSubjectCode;
      const academicSectionId = getCsvRowValue(row, ["academic section id", "academic_section_id", "section id"]);
      const rowSchoolYear = getCsvRowValue(row, ["school year", "academic year", "schoolyear"]);
      const rowSemester = getCsvRowValue(row, ["semester", "term"]);
      const rowUnits = getCsvRowValue(row, ["units", "credit", "credits"]) || "3";
      const rowDay = getCsvRowValue(row, ["day", "days"]);
      const rowTime = getCsvRowValue(row, ["time", "schedule", "sched"]);

      if (
        !(facultyId || facultyName) ||
        !rowSubjectCode ||
        !academicSectionId ||
        !rowSchoolYear ||
        !rowSemester
      ) {
        errors.push(`Row ${rowNumber}: missing required loading fields.`);
        return;
      }

      const faculty = findFacultyForLoadingRow(row);
      const section = findBulkSectionById(academicSectionId);

      if (!faculty) {
        const facultyLabel = facultyId || facultyName;
        errors.push(
          `Row ${rowNumber}: faculty "${facultyLabel}" was not found in ${selectedProgram}.`
        );
        return;
      }

      if (!section) {
        const availableSectionText = knownSections.length
          ? ` Available sections: ${knownSections.slice(0, 8).join(", ")}${
              knownSections.length > 8 ? ", ..." : ""
            }.`
          : " No sections are currently available in this academic program.";
        errors.push(
          `Row ${rowNumber}: academic section ID "${academicSectionId}" does not exist in the selected program.${availableSectionText}`
        );
        return;
      }

      const semesterCode = normalizeSemesterCode(rowSemester);
      if (!semesterCode) {
        errors.push(`Row ${rowNumber}: semester must be First, Second, or Midyear.`);
        return;
      }

      if (!/^\d{4}-\d{4}$/.test(rowSchoolYear)) {
        errors.push(`Row ${rowNumber}: school year must use YYYY-YYYY.`);
        return;
      }

      const subject = assignmentOptions.subjects.find(
        (item) =>
          normalizeText(item.subjectCode) === normalizeText(rowSubjectCode) &&
          Number(item.yearLevel) === Number(section.yearLevel) &&
          normalizeSemesterCode(item.semester) === semesterCode
      );
      if (!subject) {
        errors.push(`Row ${rowNumber}: subject "${rowSubjectCode}" is not in the published curriculum for this section and semester.`);
        return;
      }

      const canonicalSectionName = `${section.programCode} ${section.section}`;

      const duplicateKey = buildFacultyLoadingKey({
        facultyUserId: getFacultyKey(faculty),
        facultyEmail: faculty.email,
        academicSectionId: section.id,
        sectionName: canonicalSectionName,
        schoolYear: rowSchoolYear,
        semester: semesterCode,
        subjectCode: rowSubjectCode,
      });
      const existingAssignment = savedAssignments.find(
        (item) => buildFacultyLoadingKey(item) === duplicateKey
      );

      if (duplicateKeys.has(duplicateKey)) {
        errors.push(`Row ${rowNumber}: duplicate row in this CSV skipped.`);
        return;
      }

      duplicateKeys.add(duplicateKey);
      previewRows.push({
        id: `${rowNumber}-${getFacultyKey(faculty)}-${section.id}-${rowSubjectCode}`,
        facultyId: getFacultyKey(faculty),
        facultyUserId: Number(getFacultyKey(faculty)),
        facultyEmail: faculty.email,
        facultyName: getFacultyDisplayName(faculty),
        program: selectedProgram,
        sectionName: canonicalSectionName,
        academicSectionId: section.id,
        yearLevel: formatYearLevel(section.yearLevel),
        subjectCode: rowSubjectCode.trim(),
        subjectTitle: subject.subjectTitle || rowSubjectTitle.trim(),
        units: rowUnits.trim(),
        schedule: rowTime.trim(),
        day: rowDay.trim(),
        schoolYear: rowSchoolYear.trim(),
        semester: semesterCode,
        loadMode: "Faculty Loading",
        rosterFileName: "Created section roster",
        rosterStudents: [],
        existingAssignmentId: existingAssignment?.id || null,
      });
    });

    return {
      previewRows,
      errors,
      summary: {
        totalRows: rows.length,
        acceptedRows: previewRows.length,
        rejectedRows: rows.length - previewRows.length,
      },
    };
  };

  const handleDownloadFacultyLoadingTemplate = () => {
    const blob = new Blob([FACULTY_LOADING_CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.setAttribute("download", "faculty-loading-template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportFacultyLoading = () => {
    if (!selectedProgram) {
      alert("No department selected for faculty loading.");
      return;
    }

    if (!facultyLoadingFile) {
      alert("Please choose a faculty loading CSV file.");
      return;
    }

    if (!facultyLoadingFile.name.toLowerCase().endsWith(".csv")) {
      alert("Please upload a CSV file.");
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      const csvText = String(event.target?.result || "");
      const { headers, rows } = mapFacultyLoadingRows(csvText);
      const { previewRows, errors, summary } = buildFacultyLoadingPreview(
        rows,
        headers
      );

      setFacultyLoadingPreview(previewRows);
      setFacultyLoadingErrors(errors);
      setFacultyLoadingSummary(summary);

      if (!previewRows.length) {
        alert(
          `No valid faculty loading rows found.${
            errors.length ? `\n\n${errors.slice(0, 5).join("\n")}` : ""
          }`
        );
        return;
      }

      if (errors.length) {
        alert(
          `Faculty loading preview ready.\nAccepted: ${summary.acceptedRows}\nRejected: ${summary.rejectedRows}\n\nFirst issues:\n${errors
            .slice(0, 5)
            .join("\n")}`
        );
      }
    };

    reader.readAsText(facultyLoadingFile);
  };

  const handleConfirmFacultyLoading = async () => {
    if (!facultyLoadingPreview.length || isBulkSaving) {
      alert("No faculty loading preview to distribute.");
      return;
    }
    setIsBulkSaving(true);
    try {
      const response = await bulkAssignFacultyLoads(facultyLoadingPreview);
      const resultByClientId = new Map(
        (response.results || []).map((result) => [String(result.clientId), result])
      );
      const importedAssignments = [];
      const failedAssignments = [];

      facultyLoadingPreview.forEach((item) => {
        const result = resultByClientId.get(String(item.id));
        if (!result?.success || !result.assignment) {
          failedAssignments.push({
            ...item,
            error: result?.error || "The backend did not return a result for this assignment.",
          });
          return;
        }

        importedAssignments.push({
          ...item,
          id: result.assignment.id,
          assignmentCycleId: result.assignment.assignmentCycleId,
          facultyId: result.assignment.facultyUserId,
          facultyUserId: result.assignment.facultyUserId,
          facultyEmail: result.assignment.facultyEmail,
          facultyName: result.assignment.facultyName,
          program: result.assignment.program,
          sectionName: result.assignment.section,
          yearLevel: formatYearLevel(result.assignment.yearLevel),
          subjectCode: result.assignment.subjectCode,
          academicSectionId: result.assignment.academicSectionId,
          schoolYear: result.assignment.schoolYear,
          semester: result.assignment.semester,
          rosterStudents: [],
          uploadedAt: new Date().toISOString(),
        });
      });

      if (importedAssignments.length) {
        const assignmentMap = new Map(
          savedAssignments.map((item) => [buildFacultyLoadingKey(item), item])
        );
        importedAssignments.forEach((item) => assignmentMap.set(buildFacultyLoadingKey(item), item));
        const updatedAssignments = Array.from(assignmentMap.values());
        setSavedAssignments(updatedAssignments);
        localStorage.setItem("registrarAssignments", JSON.stringify(updatedAssignments));
        await pushAssignmentsSharedState();
      }

      setFacultyLoadingPreview(failedAssignments);
      setFacultyLoadingErrors(failedAssignments.map((item) => `${item.facultyName} / ${item.subjectCode} / ${item.sectionName}: ${item.error}`));
      setFacultyLoadingSummary({
        totalRows: facultyLoadingPreview.length,
        acceptedRows: importedAssignments.length,
        rejectedRows: failedAssignments.length,
      });
      if (!failedAssignments.length) {
        setFacultyLoadingFile(null);
      }
      alert(
        failedAssignments.length
          ? `${importedAssignments.length} saved; ${failedAssignments.length} remain pending. Review each row's backend error.`
          : `${importedAssignments.length} faculty loading assignment${importedAssignments.length === 1 ? "" : "s"} distributed.`
      );
    } catch (error) {
      setFacultyLoadingPreview((items) => items.map((item) => ({ ...item, error: error.message || "Bulk assignment failed." })));
      setFacultyLoadingErrors([error.message || "Bulk assignment failed."]);
      alert(error.message || "Bulk assignment failed.");
    } finally {
      setIsBulkSaving(false);
    }
  };

  const handleDeleteAssignment = async (item) => {
    if (!item.id || !item.facultyEmail) {
      alert("This legacy browser-only record has no authoritative server assignment ID and cannot be removed here.");
      return;
    }
    try {
      await unassignFacultySection(item.facultyEmail, item.id);
    } catch (error) {
      alert(error.message || "The assignment could not be removed.");
      return;
    }
    const id = item.id;
    const updatedAssignments = savedAssignments.filter((item) => item.id !== id);
    setSavedAssignments(updatedAssignments);
    localStorage.setItem(
      "registrarAssignments",
      JSON.stringify(updatedAssignments)
    );
    pushAssignmentsSharedState();
  };

  const assignmentRows = useMemo(
    () =>
      savedAssignments.filter(
        (assignment) =>
          !selectedProgram || assignment.program === selectedProgram
      ),
    [savedAssignments, selectedProgram]
  );
  const automaticLoadCount = assignmentRows.filter(
    (assignment) => assignment.loadMode === "Faculty Loading"
  ).length;
  const manualLoadCount = assignmentRows.filter(
    (assignment) => assignment.loadMode !== "Faculty Loading"
  ).length;

  return (
    <div className="space-y-6">

      <section hidden={assignmentMode === "manual"} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-xl font-bold text-[#003366]">Faculty Loading</h3>
            
          </div>
          <button
            type="button"
            onClick={handleDownloadFacultyLoadingTemplate}
            className={downloadTemplateButtonClass}
          >
            Download Template
          </button>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_auto] xl:items-end">
          <div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <label className="shrink-0 text-base font-semibold text-slate-700">
                Upload Loading CSV
              </label>
              <input
                type="file"
                aria-label="Faculty loading CSV"
                accept=".csv"
                onChange={(event) => {
                  setFacultyLoadingFile(event.target.files?.[0] || null);
                  setFacultyLoadingPreview([]);
                  setFacultyLoadingErrors([]);
                  setFacultyLoadingSummary(null);
                }}
                className="block w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-500 file:mr-10 file:border-0 file:border-r file:border-solid file:border-slate-300 file:bg-transparent file:pr-4 file:text-sm file:font-semibold file:text-slate-500"
              />
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {facultyLoadingFile
                ? `Selected file: ${facultyLoadingFile.name}`
                : "Required columns: Faculty ID, Email, or Name; Subject Code; Academic Section ID; School Year; and Semester. Section is display-only. Optional: Subject Title, Units, Day, and Time."}
            </p>
          </div>

          <button
            type="button"
            onClick={handleImportFacultyLoading}
            className="rounded-xl bg-[#003366] px-6 py-3 text-sm font-semibold text-white hover:bg-[#00264d]"
          >
            Preview Faculty Loading
          </button>
        </div>

        {(facultyLoadingPreview.length > 0 || facultyLoadingErrors.length > 0) ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h4 className="text-lg font-bold text-[#003366]">
                  Faculty Loading Preview
                </h4>
                
                {facultyLoadingSummary ? (
                  <p className="mt-2 text-sm font-medium text-slate-700">
                    Processed {facultyLoadingSummary.totalRows} row
                    {facultyLoadingSummary.totalRows === 1 ? "" : "s"}:{" "}
                    {facultyLoadingSummary.acceptedRows} accepted,{" "}
                    {facultyLoadingSummary.rejectedRows} rejected.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFacultyLoadingPreview([]);
                    setFacultyLoadingErrors([]);
                    setFacultyLoadingSummary(null);
                  }}
                  disabled={isBulkSaving || !facultyLoadingPreview.length}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Clear Selection
                </button>
                <button
                  type="button"
                  onClick={handleConfirmFacultyLoading}
                  disabled={!facultyLoadingPreview.length || isBulkSaving}
                  className="rounded-xl bg-[#003366] px-4 py-2 text-sm font-semibold text-white hover:bg-[#00264d] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isBulkSaving ? "Assigning..." : "Save Assignments"}
                </button>
              </div>
            </div>

            {facultyLoadingErrors.length ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                <p className="font-semibold">
                  Warning{facultyLoadingErrors.length === 1 ? "" : "s"} found in
                  the uploaded CSV:
                </p>
                {facultyLoadingErrors.slice(0, 10).map((error) => (
                  <p key={error}>{error}</p>
                ))}
                {facultyLoadingErrors.length > 10 ? (
                  <p>
                    {facultyLoadingErrors.length - 10} more issue
                    {facultyLoadingErrors.length - 10 === 1 ? "" : "s"} not shown.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full bg-white">
                <thead>
                  <tr className="bg-[#003366] text-white">
                    <th className="px-4 py-3 text-left text-sm">Faculty</th>
                    <th className="px-4 py-3 text-left text-sm">Subject</th>
                    <th className="px-4 py-3 text-left text-sm">Section</th>
                    <th className="px-4 py-3 text-left text-sm">Units</th>
                    <th className="px-4 py-3 text-left text-sm">Semester</th>
                    <th className="px-4 py-3 text-left text-sm">Schedule</th>
                    <th className="px-4 py-3 text-left text-sm">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {facultyLoadingPreview.length ? (
                    facultyLoadingPreview.map((item) => (
                      <tr key={item.id} className="border-b">
                        <td className="px-4 py-3">{item.facultyName}</td>
                        <td className="px-4 py-3">
                          {item.subjectCode} - {item.subjectTitle}
                        </td>
                        <td className="px-4 py-3">{item.sectionName}</td>
                        <td className="px-4 py-3">{item.units || "--"}</td>
                        <td className="px-4 py-3">{item.semester || "--"}</td>
                        <td className="px-4 py-3">
                          {[item.day, item.schedule].filter(Boolean).join(" | ") ||
                            "--"}
                        </td>
                        <td className="px-4 py-3">
                          {item.error ? (
                            <span className="font-medium text-red-700" role="alert">Pending — {item.error}</span>
                          ) : (
                            <span className="font-medium text-amber-700">Pending</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7" className="py-6 text-center text-slate-500">
                        No valid rows to preview.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      <div hidden={assignmentMode === "bulk"} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-xl font-bold text-[#003366]">
          Manual Faculty Section Distribution
        </h3>
        

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Faculty
            </label>
            <select
              value={selectedFacultyId}
              onChange={(e) => setSelectedFacultyId(e.target.value)}
              disabled={!selectedProgram}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100"
            >
              <option value="">Choose faculty</option>
              {filteredFaculty.map((faculty) => (
                <option key={getFacultyKey(faculty)} value={getFacultyKey(faculty)}>
                  {getFacultyDisplayName(faculty)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Year Level
            </label>
            <select
              value={selectedYearLevel}
              onChange={(e) => {
                setSelectedYearLevel(e.target.value);
                setSelectedSectionName("");
              }}
              disabled={!selectedProgram}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100"
            >
              {AVAILABLE_YEAR_LEVELS.map((yearLevel) => (
                <option key={yearLevel} value={yearLevel}>
                  {yearLevel}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Section
            </label>
            <select
              value={selectedSectionName}
              onChange={(e) => setSelectedSectionName(e.target.value)}
              disabled={!selectedProgram}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100"
            >
              <option value="">Choose section</option>
              {filteredSections.length ? (
                filteredSections.map((section, index) => (
                  <option
                    key={`${section.section}-${section.schoolYear}-${index}`}
                    value={section.section}
                  >
                    {section.section} - {section.yearLevel}
                  </option>
                ))
              ) : (
                <option value="" disabled>
                  No {selectedYearLevel} sections found
                </option>
              )}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Subject Code
            </label>
            <input
              type="text"
              value={subjectCode}
              onChange={(e) => setSubjectCode(e.target.value)}
              placeholder="e.g. IT 101"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Total Units
            </label>
            <input
              type="text"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder="e.g. 3"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm md:max-w-40"
            />
          </div>

          <div className="md:col-span-2 xl:col-span-2">
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Subject Title
            </label>
            <input
              type="text"
              value={subjectTitle}
              onChange={(e) => setSubjectTitle(e.target.value)}
              placeholder="e.g. Introduction to Computing"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Semester
            </label>
            <select
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            >
              <option value="">Choose semester</option>
              {SEMESTER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Time (Optional)
            </label>
            <input
              type="text"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              placeholder="e.g. 7:00 AM - 9:00 AM"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Date (Optional)
            </label>
            <input
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Day (Optional)
            </label>
            <select
              value={scheduleDay}
              onChange={(e) => setScheduleDay(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            >
              <option value="">Choose day</option>
              {DAY_OPTIONS.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleDistributeSectionToFaculty}
          className="mt-6 rounded-xl bg-[#003366] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#00264d]"
        >
          Distribute Section to Faculty
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-bold text-[#003366]">
              Distributed Faculty Loading Records
            </h3>
            
          </div>
          <div className="flex flex-wrap gap-2 text-sm font-semibold">
            <span className="rounded-full bg-blue-50 px-3 py-1 text-[#003366]">
              Faculty Loading: {automaticLoadCount}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
              Manual Distribution: {manualLoadCount}
            </span>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[1280px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#003366] text-white">
                <th className="px-4 py-3 text-left text-sm">Mode</th>
                <th className="px-4 py-3 text-left text-sm">Faculty</th>
                <th className="px-4 py-3 text-left text-sm">Section</th>
                <th className="px-4 py-3 text-left text-sm">Students</th>
                <th className="px-4 py-3 text-left text-sm">CSV File</th>
                <th className="px-4 py-3 text-left text-sm">Subject</th>
                <th className="px-4 py-3 text-left text-sm">Units</th>
                <th className="px-4 py-3 text-left text-sm">Semester</th>
                <th className="px-4 py-3 text-left text-sm">Date</th>
                <th className="px-4 py-3 text-left text-sm">Time</th>
                <th className="px-4 py-3 text-left text-sm">Day</th>
                <th className="px-4 py-3 text-left text-sm">Action</th>
              </tr>
            </thead>

            <tbody>
              {assignmentRows.length > 0 ? (
                assignmentRows.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          item.loadMode === "Faculty Loading"
                            ? "bg-blue-50 text-[#003366]"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {item.loadMode === "Faculty Loading"
                          ? "Faculty Loading"
                          : "Manual Distribution"}
                      </span>
                    </td>
                    <td className="px-4 py-3">{item.facultyName}</td>
                    <td className="px-4 py-3">{item.sectionName}</td>
                    <td className="px-4 py-3">
                      {item.rosterStudents?.length || 0}
                    </td>
                    <td className="px-4 py-3">{item.rosterFileName || "--"}</td>
                    <td className="px-4 py-3">
                      {item.subjectCode} - {item.subjectTitle}
                    </td>
                    <td className="px-4 py-3">{item.units || "--"}</td>
                    <td className="px-4 py-3">{item.semester || "--"}</td>
                    <td className="px-4 py-3">{item.date || "--"}</td>
                    <td className="px-4 py-3">{item.schedule || "--"}</td>
                    <td className="px-4 py-3">{item.day || "--"}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDeleteAssignment(item)}
                        className="rounded-lg border border-red-200 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="12" className="py-6 text-center text-slate-500">
                    No faculty loading records yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default FacultyLoading;

