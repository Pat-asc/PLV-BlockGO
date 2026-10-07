import { mapActiveFacultyAssignments, reconcileActiveAssignmentCache } from "./facultyAssignmentState";

beforeEach(() => localStorage.clear());

test("maps explicit assignment and academic-section identities without substitution", () => {
  const [assignment] = mapActiveFacultyAssignments({ assignments: [{
    id: 120, assignmentCycleId: "120", facultyUserId: 9,
    academicSectionId: 42, program: "BSIT", semester: "FIRST",
  }] });

  expect(assignment).toMatchObject({
    id: 120, facultySectionId: 120, facultyAssignmentId: 120,
    assignmentCycleId: "120", academicSectionId: 42, facultyId: "9",
  });
  expect(assignment.facultySectionId).not.toBe(assignment.academicSectionId);
});

test("preserves authoritative units and keeps unresolved units nullable", () => {
  const assignments = mapActiveFacultyAssignments({ assignments: [
    { id: 201, facultyUserId: 9, academicSectionId: 41, units: 2 },
    { id: 202, facultyUserId: 9, academicSectionId: 42, units: 0 },
    { id: 203, facultyUserId: 9, academicSectionId: 43, units: null },
  ] });

  expect(assignments.map((assignment) => assignment.units)).toEqual(["2", "0", null]);
});

test("reconciliation keeps only backend-authorized active rows", () => {
  localStorage.setItem("registrarAssignments", JSON.stringify([
    { id: 1, program: "BSIT" }, { id: 2, program: "BSCS" },
  ]));

  const result = reconcileActiveAssignmentCache({
    program: { code: "BSIT", name: "BS Information Technology" }, assignments: [],
  }, "BS Information Technology");

  expect(result.assignments).toEqual([]);
  expect(JSON.parse(localStorage.getItem("registrarAssignments"))).toEqual([]);
});
