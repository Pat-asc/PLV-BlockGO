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

test("reconciliation replaces only the requested program with backend-active rows", () => {
  localStorage.setItem("registrarAssignments", JSON.stringify([
    { id: 1, program: "BSIT" }, { id: 2, program: "BSCS" },
  ]));

  const result = reconcileActiveAssignmentCache({
    program: { code: "BSIT", name: "BS Information Technology" }, assignments: [],
  }, "BS Information Technology");

  expect(result.assignments).toEqual([{ id: 2, program: "BSCS" }]);
  expect(JSON.parse(localStorage.getItem("registrarAssignments"))).toEqual([{ id: 2, program: "BSCS" }]);
});
