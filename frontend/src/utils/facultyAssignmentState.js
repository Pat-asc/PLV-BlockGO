const normalizeText = (value = "") => String(value || "").trim().toLowerCase();

export const mapActiveFacultyAssignments = (response = {}) =>
  (response.assignments || []).map((item) => {
    const facultySectionId = Number(item.facultySectionId || item.facultyAssignmentId || item.id);
    return {
      ...item,
      id: facultySectionId,
      facultySectionId,
      facultyAssignmentId: facultySectionId,
      assignmentCycleId: String(item.assignmentCycleId || facultySectionId),
      facultyId: String(item.facultyUserId || item.facultyId || ""),
      facultyName: item.facultyName || item.facultyEmail || "",
      semesterCode: item.semester,
      semester: ({ FIRST: "1st Semester", SECOND: "2nd Semester", MIDYEAR: "Summer" })[item.semester] || item.semester,
      sectionName: item.sectionName || item.section,
      units: String(item.units || 0),
    };
  });

export const reconcileActiveAssignmentCache = (response = {}, department = "") => {
  let cached = [];
  try {
    const parsed = JSON.parse(localStorage.getItem("registrarAssignments"));
    cached = Array.isArray(parsed) ? parsed : [];
  } catch {
    cached = [];
  }

  const aliases = new Set([
    department,
    response.program?.code,
    response.program?.name,
  ].map(normalizeText).filter(Boolean));
  const belongsToProgram = (item) => [item.program, item.department, item.programCode]
    .some((value) => aliases.has(normalizeText(value)));
  const activeAssignments = mapActiveFacultyAssignments(response);
  const next = [...cached.filter((item) => !belongsToProgram(item)), ...activeAssignments];
  const changed = JSON.stringify(next) !== JSON.stringify(cached);

  if (changed) localStorage.setItem("registrarAssignments", JSON.stringify(next));
  return { assignments: next, activeAssignments, changed };
};
