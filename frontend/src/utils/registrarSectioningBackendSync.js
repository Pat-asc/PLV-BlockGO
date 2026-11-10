import {
  assignStudentsToSection,
  createSection,
  fetchDepartmentSections,
  fetchSectionedEnrolledStudents,
  promoteStudentEnrollments,
} from "../services/api";
import {
  AVAILABLE_YEAR_LEVELS,
  getCanonicalProgramName,
  getDefaultSectionName,
  YEAR_LEVEL_PREFIXES,
} from "./studentSectioningHelpers";

export const refreshSectioningBatchFromBackend = async (batch) => {
  const canonicalProgram = getCanonicalProgramName(batch.program || "");
  const schoolYear = batch.schoolYear || (/^\d{4}$/.test(String(batch.batchYear || ""))
    ? `${batch.batchYear}-${Number(batch.batchYear) + 1}` : batch.batchYear);
  if (!canonicalProgram || !schoolYear || !batch.semester) {
    throw new Error("Refresh the section's program and academic period before making changes.");
  }
  const [rosterResponse, sectionsResponse] = await Promise.all([
    fetchSectionedEnrolledStudents({ department: canonicalProgram, schoolYear, semester: batch.semester }),
    fetchDepartmentSections(canonicalProgram),
  ]);

  const removedIds = new Set(
    (batch.removedStudents || []).map((s) => String(s.studentId).trim().toLowerCase())
  );

  return {
    ...batch,
    program: canonicalProgram,
    schoolYear,
    students: (rosterResponse.data || [])
      .filter((student) => {
        const id = String(student.studentNo || student.studentId || "").trim().toLowerCase();
        if (!id || removedIds.has(id)) return false;
        if (
          student.isActive === false ||
          student.is_active === false ||
          String(student.status || "").toUpperCase() === "DROPPED" ||
          String(student.accountStatus || "").toUpperCase() === "REVOKED"
        ) {
          return false;
        }
        return true;
      })
      .map((student) => ({
        ...student,
        studentId: student.studentNo,
        firstName: student.fullName,
        lastName: "",
        middleName: "",
        yearLevel: AVAILABLE_YEAR_LEVELS[Number(student.yearLevel) - 1],
        sectionCode: student.section || "",
        sectionName: getDefaultSectionName(canonicalProgram, student.section || ""),
      })),
    sectionPlans: (sectionsResponse.data || sectionsResponse.sections || []).map((section) => ({
      ...section,
      id: Number(section.id),
      academicSectionId: Number(section.id),
      yearLevel: AVAILABLE_YEAR_LEVELS[Number(section.yearLevel) - 1],
      sectionCode: `${section.yearLevel}-${section.sectionNum}`,
      sectionName: getDefaultSectionName(canonicalProgram, `${section.yearLevel}-${section.sectionNum}`),
    })),
    removedStudents: batch.removedStudents || [],
  };
};

const yearLevelNumberFrom = (value = "", sectionCode = "") => {
  const text = String(value || "").trim();
  const directNumber = text.match(/[1-4]/)?.[0];
  if (directNumber) return directNumber;

  const labelEntry = Object.entries(YEAR_LEVEL_PREFIXES).find(
    ([label]) => label === value
  );
  if (labelEntry) return labelEntry[1];

  return String(sectionCode || "").match(/[1-4]/)?.[0] || "";
};

const sectionNumberFrom = (sectionCode = "") => {
  const parts = String(sectionCode || "").split("-");
  if (parts[1]) return parts[1].replace(/\D/g, "");
  return String(sectionCode || "").match(/\d+$/)?.[0] || "";
};

const normalizeSectionValue = (value = "") =>
  String(value || "").trim().replace(/\D/g, "");

const findBackendSection = (sections = [], department = "", yearLevel = "", sectionNum = "") =>
  sections.find(
    (section) =>
      normalizeSectionValue(section.yearLevel) === normalizeSectionValue(yearLevel) &&
      normalizeSectionValue(section.sectionNum) === normalizeSectionValue(sectionNum)
  );

const getDepartmentSections = async (department) => {
  const response = await fetchDepartmentSections(department);
  return response.data || response.sections || [];
};

export const syncSectioningBatchToBackend = async (batch = {}) => {
  const department = getCanonicalProgramName(batch.program || "");
  const sectionPlans = batch.sectionPlans || [];

  if (!department || !sectionPlans.length) {
    return { sectionsSynced: 0, studentsSynced: 0 };
  }

  const schoolYear = batch.schoolYear || (/^\d{4}-\d{4}$/.test(batch.batchYear || '') ? batch.batchYear : '');
  if (!schoolYear || !batch.semester) {
    throw new Error('Select the enrollment school year and semester before saving sections.');
  }

  let backendSections = await getDepartmentSections(department);
  let sectionsSynced = 0;
  let studentsSynced = 0;

  for (const section of sectionPlans) {
    const yearLevel = yearLevelNumberFrom(section.yearLevel, section.sectionCode);
    const sectionNum = sectionNumberFrom(section.sectionCode);
    if (!yearLevel || !sectionNum) continue;

    let backendSection = findBackendSection(
      backendSections,
      department,
      yearLevel,
      sectionNum
    );

    if (!backendSection) {
      try {
        const created = await createSection({
          department,
          yearLevel,
          sectionNum,
          maxCapacity: Number(section.maxCapacity || 40),
        });
        sectionsSynced += 1;
        backendSection = {
          id: created.id,
          department,
          yearLevel,
          sectionNum,
        };
        backendSections = [...backendSections, backendSection];
      } catch (error) {
        backendSections = await getDepartmentSections(department);
        backendSection = findBackendSection(
          backendSections,
          department,
          yearLevel,
          sectionNum
        );
        if (!backendSection) throw error;
      }
    }

    const removedIds = new Set(
      (batch.removedStudents || []).map((s) => String(s.studentId).trim().toLowerCase())
    );

    const sectionStudents = (batch.students || []).filter(
      (student) =>
        student.sectionCode === section.sectionCode &&
        normalizeSectionValue(
          yearLevelNumberFrom(student.yearLevel || section.yearLevel, section.sectionCode)
        ) === normalizeSectionValue(yearLevel) &&
        !removedIds.has(String(student.studentId || "").trim().toLowerCase()) &&
        student.isActive !== false &&
        student.is_active !== false &&
        String(student.status || "").toUpperCase() !== "DROPPED" &&
        String(student.accountStatus || "").toUpperCase() !== "REVOKED"
    );
    if (backendSection?.id) {
      section.id = Number(backendSection.id);
      section.academicSectionId = Number(backendSection.id);
    }
    if (!backendSection?.id || !sectionStudents.length) continue;

    const normalizedStudentIds = sectionStudents.map((student) =>
      String(student.studentId || "").trim()
    );

    const invalidStudentIds = normalizedStudentIds.filter(
      (studentId) =>
        !/^\d{2,4}-\d{4,}$/.test(studentId) ||
        /-0+$/.test(studentId)
    );

    if (invalidStudentIds.length) {
      throw new Error(
        `Invalid or stale Student ID(s): ${[...new Set(invalidStudentIds)].join(", ")}. Refresh the enrolled roster before saving.`
      );
    }
    const studentIds = [...new Set(normalizedStudentIds)];
    const expectedSectionIds = Object.fromEntries(sectionStudents
      .filter((student) => student.academicSectionId && String(student.academicSectionId) !== String(backendSection.id))
      .map((student) => [student.studentId, Number(student.academicSectionId)]));
    const period = { schoolYear, semester: batch.semester };
    if (Object.keys(expectedSectionIds).length) period.expectedSectionIds = expectedSectionIds;
    const result = await assignStudentsToSection(backendSection.id, studentIds, period);
    if (result.errors?.length || result.status !== 'Success' || result.assignedCount !== studentIds.length) {
      throw new Error(result.errors?.join('; ') || result.message || 'Some students could not be assigned. Refresh the enrolled roster and retry.');
    }
    sectionStudents.forEach((student) => { student.academicSectionId = Number(backendSection.id); });
    studentsSynced += result.assignedCount;
  }

  return { sectionsSynced, studentsSynced };
};

export const syncSectioningBatchesToBackend = async (batches = []) => {
  let sectionsSynced = 0;
  let studentsSynced = 0;

  for (const batch of batches) {
    const result = await syncSectioningBatchToBackend(batch);
    sectionsSynced += result.sectionsSynced;
    studentsSynced += result.studentsSynced;
  }

  return { sectionsSynced, studentsSynced };
};

export const getNextAcademicSchoolYear = (schoolYear = "") => {
  const match = String(schoolYear).trim().match(/^(\d{4})-(\d{4})$/);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    throw new Error("Promotion requires a valid consecutive school year.");
  }
  return `${Number(match[1]) + 1}-${Number(match[2]) + 1}`;
};

const promotionSourceContext = (batch, student) => ({
  program: getCanonicalProgramName(batch.program),
  schoolYear: student.sourceSchoolYear || student.promotedFromSchoolYear || student.originBatchYear || batch.schoolYear || batch.batchYear,
  semester: student.sourceSemester || student.promotedFromSemester || student.originSemester || batch.semester,
  yearLevel: yearLevelNumberFrom(
    student.sourceYearLevel || student.promotedFromYearLevel || student.originYearLevel,
    student.originSectionCode || student.promotedFromSectionCode
  ),
});

const promotionTargetSignature = (item) => [
  item.studentUserId,
  item.targetSchoolYear,
  item.targetSemester,
  item.targetYearLevel,
  item.targetSection || "",
].join("|").toLowerCase();

const sameStudentNumber = (row, studentId) =>
  String(row.studentNo || row.studentId || "").trim().toLowerCase() ===
  String(studentId || "").trim().toLowerCase();

const resolveRefreshedPromotionSource = (roster, student) => {
  const expectedEnrollmentId = Number(student.sourceEnrollmentId || student.enrollmentId);
  const expectedStudentUserId = Number(student.studentUserId || student.id);
  const expectedAcademicSectionId = Number(
    student.sourceAcademicSectionId || student.academicSectionId
  );
  const studentId = String(student.studentId || student.studentNo || "").trim();

  if (Number.isInteger(expectedEnrollmentId) && expectedEnrollmentId > 0) {
    const exact = roster.find((row) => Number(row.enrollmentId) === expectedEnrollmentId);
    if (!exact) return null;
    if (Number.isInteger(expectedStudentUserId) && expectedStudentUserId > 0 &&
        Number(exact.id) !== expectedStudentUserId) return null;
    if (Number.isInteger(expectedAcademicSectionId) && expectedAcademicSectionId > 0 &&
        Number(exact.academicSectionId) !== expectedAcademicSectionId) return null;
    if (!sameStudentNumber(exact, studentId)) return null;
    return exact;
  }

  const candidates = roster.filter((row) =>
    sameStudentNumber(row, studentId) &&
    (!Number.isInteger(expectedStudentUserId) || expectedStudentUserId <= 0 || Number(row.id) === expectedStudentUserId) &&
    (!Number.isInteger(expectedAcademicSectionId) || expectedAcademicSectionId <= 0 ||
      Number(row.academicSectionId) === expectedAcademicSectionId)
  );
  return candidates.length === 1 ? candidates[0] : null;
};

export const buildAuthoritativePromotionRequest = async (batches = []) => {
  const planned = batches.flatMap((batch) => {
    const canonicalProgram = getCanonicalProgramName(batch.program);
    const removedIds = new Set(
      (batch.removedStudents || []).map((s) => String(s.studentId).trim().toLowerCase())
    );
    return (batch.students || [])
      .filter(
        (student) =>
          !removedIds.has(String(student.studentId || "").trim().toLowerCase()) &&
          student.isActive !== false &&
          student.is_active !== false &&
          String(student.status || "").toUpperCase() !== "DROPPED" &&
          String(student.accountStatus || "").toUpperCase() !== "REVOKED"
      )
      .map((student) => ({ batch: { ...batch, program: canonicalProgram }, student }));
  });
  if (!planned.length) return [];

  const contexts = new Map();
  planned.forEach(({ batch, student }) => {
    const context = promotionSourceContext(batch, student);
    if (!context.program || !context.schoolYear || !context.semester || !context.yearLevel) {
      throw new Error(`Student '${student.studentId || "unknown"}' is missing its source enrollment identity. Refresh sections before promoting.`);
    }
    contexts.set(Object.values(context).join("|").toLowerCase(), context);
  });

  const rosters = new Map();
  await Promise.all([...contexts.entries()].map(async ([key, context]) => {
    const response = await fetchSectionedEnrolledStudents({
      department: context.program,
      schoolYear: context.schoolYear,
      semester: context.semester,
      yearLevel: context.yearLevel,
    });
    rosters.set(key, response?.data || response?.students || []);
  }));

  const authoritative = new Map();
  planned.forEach(({ batch, student }) => {
    const context = promotionSourceContext(batch, student);
    const key = Object.values(context).join("|").toLowerCase();
    const roster = rosters.get(key) || [];
    const studentId = String(student.studentId || "").trim();
    const source = resolveRefreshedPromotionSource(roster, student);

    if (!source) {
      throw new Error(`Student '${studentId}' no longer matches the current source enrollment. Refresh sections before promoting.`);
    }
    if (String(source.enrollmentState || "").toUpperCase() !== "PLANNING") {
      throw new Error(`The section containing student '${studentId}' is locked. Unlock the section before promoting.`);
    }

    const item = {
      sourceEnrollmentId: Number(source.enrollmentId),
      studentUserId: Number(source.id),
      sourceAcademicSectionId: Number(source.academicSectionId) || null,
      studentId: String(source.studentNo || studentId).trim(),
      program: source.department || batch.program,
      sourceSchoolYear: source.schoolYear || context.schoolYear,
      sourceSemester: source.semester || context.semester,
      sourceYearLevel: yearLevelNumberFrom(source.yearLevel, source.section),
      sourceSection: source.section || student.originSectionCode || student.promotedFromSectionCode || "",
      targetSchoolYear: batch.schoolYear || batch.batchYear,
      targetSemester: batch.semester,
      targetYearLevel: yearLevelNumberFrom(student.yearLevel, student.sectionCode),
      targetSection: student.sectionCode || null,
    };

    if (!Number.isInteger(item.sourceEnrollmentId) || item.sourceEnrollmentId <= 0 ||
        !Number.isInteger(item.studentUserId) || item.studentUserId <= 0) {
      throw new Error(`Student '${studentId}' has an incomplete server enrollment identity. Refresh sections before promoting.`);
    }

    const duplicate = authoritative.get(item.sourceEnrollmentId);
    if (duplicate && promotionTargetSignature(duplicate) !== promotionTargetSignature(item)) {
      throw new Error(`Student '${item.studentId}' appears in conflicting promotion targets. Refresh sections before promoting.`);
    }
    authoritative.set(item.sourceEnrollmentId, item);
  });

  return [...authoritative.values()].sort((left, right) => left.sourceEnrollmentId - right.sourceEnrollmentId);
};

export const mergePromotionResultIntoBatches = (batches = [], promotedStudents = []) => {
  const byStudent = new Map(promotedStudents.map((student) => [
    String(student.studentNo || "").trim().toLowerCase(),
    student,
  ]));
  const seenEnrollments = new Set();
  return batches.map((batch) => ({
    ...batch,
    students: (batch.students || []).flatMap((student) => {
      const confirmed = byStudent.get(String(student.studentId || "").trim().toLowerCase());
      if (!confirmed) return [{ ...student }];
      const identity = Number(confirmed.sourceEnrollmentId) || String(student.studentId || "").trim().toLowerCase();
      if (seenEnrollments.has(identity)) return [];
      seenEnrollments.add(identity);
      return [{
        ...student,
        id: Number(confirmed.userId) || student.id,
        enrollmentId: Number(confirmed.targetEnrollmentId) || student.enrollmentId,
        academicSectionId: Number(confirmed.academicSectionId) || null,
        sourceEnrollmentId: Number(confirmed.sourceEnrollmentId) || student.sourceEnrollmentId,
        enrollmentState: "PLANNING",
      }];
    }),
  }));
};

export const persistPromotedBatchesToBackend = async (batches = []) => {
  const students = await buildAuthoritativePromotionRequest(batches);

  if (!students.length) return { status: "Success", promotedCount: 0 };
  return promoteStudentEnrollments(students);
};
