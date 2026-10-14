export const mapActiveFacultyAssignments = (response = {}) =>
  (response.assignments || []).map((item) => {
    const facultySectionId = Number(item.facultySectionId || item.facultyAssignmentId || item.id);
    const hasUnits = item.units !== null && item.units !== undefined && String(item.units).trim() !== "";
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
      units: hasUnits ? String(item.units) : null,
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

  const activeAssignments = mapActiveFacultyAssignments(response);
  // The authenticated assignment-options response is authoritative for a Chairperson.
  // Never reintroduce rows from another program through the shared browser cache.
  const next = activeAssignments;
  const changed = JSON.stringify(next) !== JSON.stringify(cached);

  if (changed) localStorage.setItem("registrarAssignments", JSON.stringify(next));
  return { assignments: next, activeAssignments, changed };
};
