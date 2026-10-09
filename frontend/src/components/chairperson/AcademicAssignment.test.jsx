import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import AcademicAssignment from "./AcademicAssignment";
import { fetchApprovedFaculties, fetchCurriculums, fetchFacultyAssignmentOptions, assignFacultyLoadToBackend } from "../../services/api";
jest.mock("../../services/api", () => ({ fetchApprovedFaculties: jest.fn(), fetchCurriculums: jest.fn(), fetchFacultyAssignmentOptions: jest.fn(), assignFacultyLoadToBackend: jest.fn() }));
jest.mock("../../utils/sharedClientState", () => ({ pushAssignmentsSharedState: jest.fn() }));
jest.mock("./FacultyLoading", () => ({
  __esModule: true,
  default: () => <div>Bulk import</div>,
  DAY_OPTIONS: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
}));
beforeEach(() => {
  localStorage.clear(); jest.clearAllMocks();
  fetchApprovedFaculties.mockResolvedValue({ faculties: [{ id: 1, fullname: "Carlos Reyes", department: "Bachelor of Science in Information Technology" }] });
  fetchCurriculums.mockResolvedValue({ data: [{ programCode: "BSIT", status: "PUBLISHED", subjects: [{ subjectCode: "IT 321", subjectTitle: "Web Systems and Technologies", yearLevel: 3, semester: "SECOND", units: 3 }] }] });
  fetchFacultyAssignmentOptions.mockResolvedValue({
    subjects: [{ subjectCode: "IT 321", subjectTitle: "Web Systems and Technologies", yearLevel: 3, semester: "SECOND", units: 3 }],
    sections: [{ id: 31, department: "Bachelor of Science in Information Technology", programCode: "BSIT", yearLevel: 3, section: "3-1" }],
    schoolYears: ["2026-2027"], enrollmentPeriods: [],
    activeAcademicPeriod: { schoolYear: "2026-2027", semester: "SECOND" },
  });
  assignFacultyLoadToBackend.mockResolvedValue({ status: "Success", assignment: { id: 77, academicSectionId: 31 } });
  localStorage.setItem("studentSections", JSON.stringify([{ program: "Bachelor of Science in Information Technology", yearLevel: "3rd Year", section: "IT 3A", schoolYear: "2026", semester: "2nd Semester", students: [] }]));
});
const selectFaculty = async (name = /Carlos Reyes/) => {
  fireEvent.click(await screen.findByRole("button", { name }));
};
const stageAssignment = (subjectCode = "IT 321") => {
  fireEvent.click(screen.getByRole("radio", { name: `Select ${subjectCode}` }));
  fireEvent.click(screen.getByRole("button", { name: /Assign$/ }));
};
const pendingTotal = (label) => screen.getByText(/^\d+$/, {
  selector: label === "Total Assignments"
    ? ".sa-totals > div:first-child strong"
    : ".sa-totals > div:last-child strong",
});
const savedAssignment = (overrides = {}) => ({
  id: 70, facultyId: "1", facultyName: "Carlos Reyes",
  program: "Bachelor of Science in Information Technology", sectionName: "BSIT 3-1",
  yearLevel: "3rd Year", schoolYear: "2026-2027", semester: "2nd Semester",
  semesterCode: "SECOND", subjectCode: "IT 100", subjectTitle: "Saved Subject",
  units: "3", schedule: "Monday 8:00 AM", ...overrides,
});
test("limits professors and programs to the chairperson department", async () => {
  fetchApprovedFaculties.mockResolvedValue({ faculties: [
    { id: 1, fullname: "Carlos Reyes", department: "Bachelor of Science in Information Technology" },
    { id: 2, fullname: "Other Professor", department: "Bachelor of Science in Accountancy" },
  ] });
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  expect(await screen.findByRole("button", { name: /Carlos Reyes/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Other Professor/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Academic Program" }));
  expect(within(screen.getByRole("listbox", { name: "Academic Program" })).getAllByRole("option")).toHaveLength(1);
});
test("does not display another department assignment retained in browser storage", async () => {
  localStorage.setItem("registrarAssignments", JSON.stringify([
    savedAssignment({ id: 900, program: "Bachelor of Science in Civil Engineering", subjectCode: "CE 101", subjectTitle: "Civil Engineering" }),
  ]));
  fetchFacultyAssignmentOptions.mockResolvedValue({
    program: { code: "BSIT", name: "Bachelor of Science in Information Technology" },
    subjects: [], sections: [], enrollmentPeriods: [], schoolYears: ["2026-2027"],
    activeAcademicPeriod: { schoolYear: "2026-2027", semester: "SECOND" },
    assignments: [savedAssignment({ id: 901, subjectCode: "IT 101", subjectTitle: "Information Technology" })],
  });

  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);

  expect(await screen.findByText("IT 101")).toBeInTheDocument();
  expect(screen.queryByText("CE 101")).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("registrarAssignments"))).toEqual([
    expect.objectContaining({ id: 901, subjectCode: "IT 101" }),
  ]);
});
test("CE Chairperson sees CE assignments and never inherits IT assignments", async () => {
  fetchApprovedFaculties.mockResolvedValue({ faculties: [{ id: 2, fullname: "Maria Santos", department: "Bachelor of Science in Civil Engineering" }] });
  fetchCurriculums.mockResolvedValue({ data: [{ programCode: "BSCE", status: "PUBLISHED", subjects: [] }] });
  localStorage.setItem("registrarAssignments", JSON.stringify([
    savedAssignment({ id: 910, program: "Bachelor of Science in Information Technology", subjectCode: "IT 101" }),
  ]));
  fetchFacultyAssignmentOptions.mockResolvedValue({
    program: { code: "BSCE", name: "Bachelor of Science in Civil Engineering" },
    subjects: [], sections: [], enrollmentPeriods: [], schoolYears: ["2026-2027"],
    activeAcademicPeriod: { schoolYear: "2026-2027", semester: "SECOND" },
    assignments: [savedAssignment({ id: 911, facultyUserId: 2, program: "Bachelor of Science in Civil Engineering", subjectCode: "CE 101", subjectTitle: "Civil Engineering" })],
  });

  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Civil Engineering"/>);

  expect(await screen.findByText("CE 101")).toBeInTheDocument();
  expect(screen.queryByText("IT 101")).not.toBeInTheDocument();
});
test.each([
  ["IT 202", "Data Communications", 2],
  ["IT 203", "Data Structures", 3],
  ["IT 204", "Advanced Systems", 4],
])("shows authoritative units for saved %s assignment", async (subjectCode, subjectTitle, units) => {
  fetchFacultyAssignmentOptions.mockResolvedValue({
    program: { code: "BSIT", name: "Bachelor of Science in Information Technology" },
    subjects: [], sections: [], enrollmentPeriods: [], schoolYears: ["2026-2027"],
    activeAcademicPeriod: { schoolYear: "2026-2027", semester: "SECOND" },
    assignments: [savedAssignment({ id: 200 + units, subjectCode, subjectTitle, units })],
  });

  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);

  const row = (await screen.findByText(subjectCode)).closest("tr");
  expect(within(row).getByText(String(units))).toBeInTheDocument();
  expect(within(row).queryByText("0")).not.toBeInTheDocument();
});

test("same subject in two sections retains both assignments and the same authoritative units", async () => {
  fetchFacultyAssignmentOptions.mockResolvedValue({
    program: { code: "BSIT", name: "Bachelor of Science in Information Technology" },
    subjects: [], sections: [], enrollmentPeriods: [], schoolYears: ["2026-2027"],
    activeAcademicPeriod: { schoolYear: "2026-2027", semester: "SECOND" },
    assignments: [
      savedAssignment({ id: 211, subjectCode: "IT 201", sectionName: "BSIT 2-1", units: 3 }),
      savedAssignment({ id: 212, subjectCode: "IT 201", sectionName: "BSIT 2-2", units: 3 }),
    ],
  });

  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);

  const rows = (await screen.findAllByText("IT 201")).map((cell) => cell.closest("tr"));
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => within(row).getByText("3"))).toHaveLength(2);
  expect(screen.getByText("BSIT 2-1")).toBeInTheDocument();
  expect(screen.getByText("BSIT 2-2")).toBeInTheDocument();
});

test("legacy unresolved saved assignment displays N/A rather than fabricated units", async () => {
  fetchFacultyAssignmentOptions.mockResolvedValue({
    program: { code: "BSIT", name: "Bachelor of Science in Information Technology" },
    subjects: [], sections: [], enrollmentPeriods: [], schoolYears: ["2026-2027"],
    activeAcademicPeriod: { schoolYear: "2026-2027", semester: "SECOND" },
    assignments: [savedAssignment({ id: 220, subjectCode: "LEG 101", subjectTitle: null, units: null })],
  });

  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);

  const row = (await screen.findByText("LEG 101")).closest("tr");
  expect(within(row).getByText("Not available")).toBeInTheDocument();
  expect(within(row).getByText("N/A")).toBeInTheDocument();
  expect(within(row).queryByText("0")).not.toBeInTheDocument();
});
test("stages assignments, prevents duplicates, and persists only on Save", async () => {
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  fireEvent.click(await screen.findByRole("button", { name: /Carlos Reyes/ }));
  fireEvent.click(screen.getByRole("radio", { name: "Select IT 321" }));
  fireEvent.change(screen.getByLabelText("Day for BSIT 3-1"), { target: { value: "Monday" } });
  fireEvent.change(screen.getByLabelText("Start time for BSIT 3-1"), { target: { value: "08:00" } });
  fireEvent.change(screen.getByLabelText("End time for BSIT 3-1"), { target: { value: "10:00" } });
  fireEvent.click(screen.getByRole("button", { name: "＋ Assign" }));
  expect(localStorage.getItem("registrarAssignments")).toBeNull();
  expect(screen.getByText("1 pending assignment")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "＋ Assign" }));
  expect(screen.getByRole("status")).toHaveTextContent("already have an assignment");
  fireEvent.click(screen.getByRole("button", { name: "Save Assignments" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Assignments saved successfully"));
  const saved = JSON.parse(localStorage.getItem("registrarAssignments"));
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ facultyId: "1", subjectCode: "IT 321", sectionName: "BSIT 3-1", schedule: "Monday | 08:00-10:00" });
  expect(assignFacultyLoadToBackend).toHaveBeenCalledWith(expect.objectContaining({ schedule: "Monday | 08:00-10:00" }));
  expect(assignFacultyLoadToBackend).toHaveBeenCalledTimes(1);
});
test("saves only the selected professor's pending load", async () => {
  fetchApprovedFaculties.mockResolvedValue({ faculties: [
    { id: 1, fullname: "Carlos Reyes", department: "Bachelor of Science in Information Technology" },
    { id: 2, fullname: "Ana Santos", department: "Bachelor of Science in Information Technology" },
  ] });
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  fireEvent.click(await screen.findByRole("button", { name: /Carlos Reyes/ }));
  fireEvent.click(screen.getByRole("radio", { name: "Select IT 321" }));
  fireEvent.click(screen.getByRole("button", { name: "＋ Assign" }));
  expect(screen.getByRole("button", { name: "Save Assignments" })).toBeEnabled();
  fireEvent.focus(screen.getByLabelText("Search professors"));
  fireEvent.click(screen.getByRole("button", { name: /Ana Santos/ }));
  expect(screen.getByRole("button", { name: "Save Assignments" })).toBeDisabled();

  fireEvent.focus(screen.getByLabelText("Search professors"));
  fireEvent.click(screen.getByRole("button", { name: /Carlos Reyes/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save Assignments" }));
  await waitFor(() => expect(assignFacultyLoadToBackend).toHaveBeenCalledTimes(1));
  expect(JSON.parse(localStorage.getItem("registrarAssignments"))[0].facultyId).toBe("1");
});
test("allows removing a pending assignment without saving", async () => {
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  fireEvent.click(await screen.findByRole("button", { name: /Carlos Reyes/ }));
  fireEvent.click(screen.getByRole("radio", { name: "Select IT 321" }));
  fireEvent.click(screen.getByRole("button", { name: "＋ Assign" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove IT 321 BSIT 3-1" }));
  expect(screen.getByRole("button", { name: "Save Assignments" })).toBeDisabled();
  expect(localStorage.getItem("registrarAssignments")).toBeNull();
});
test("renders Assigned Sections before Subject Assigning", async () => {
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await screen.findByRole("button", { name: /Carlos Reyes/ });
  const assigned = screen.getByRole("heading", { name: "Assigned Sections" });
  const assigning = screen.getByRole("heading", { name: "Subject Assigning" });
  expect(assigned.compareDocumentPosition(assigning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("shows the authoritative period and explicit period columns", async () => {
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  expect(await screen.findByLabelText("Current academic period")).toHaveTextContent("2026-2027 · 2nd Semester");
  expect(screen.getByRole("columnheader", { name: "School Year" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Semester" })).toBeInTheDocument();
});

test("shows only the active enrollment period and does not render a period mismatch action", async () => {
  const firstSemesterSubject = {
    subjectCode: "IT 321",
    subjectTitle: "Web Systems and Technologies",
    yearLevel: 3,
    semester: "FIRST",
    units: 3,
  };

  fetchCurriculums.mockResolvedValue({
    data: [{
      programCode: "BSIT",
      status: "PUBLISHED",
      subjects: [firstSemesterSubject],
    }],
  });

  fetchFacultyAssignmentOptions.mockResolvedValue({
    subjects: [firstSemesterSubject],
    sections: [{
      id: 31,
      department: "Bachelor of Science in Information Technology",
      programCode: "BSIT",
      yearLevel: 3,
      section: "3-1",
    }],
    schoolYears: ["2025-2026"],
    enrollmentPeriods: [{
      schoolYear: "2026-2027",
      semester: "FIRST",
      semesterDisplay: "1st Semester",
      yearLevel: 3,
      section: "3-1",
      academicSectionId: 31,
    }, {
      schoolYear: "2025-2026",
      semester: "FIRST",
      yearLevel: 3,
      academicSectionId: 31,
    }],
    activeAcademicPeriod: {
      schoolYear: "2025-2026",
      semester: "FIRST",
    },
    assignments: [],
  });

  render(
    <AcademicAssignment
      chairpersonDepartment="Bachelor of Science in Information Technology"
    />
  );

  await selectFaculty();

  fireEvent.click(
    screen.getByRole("radio", { name: "Select IT 321" })
  );

  expect(
    screen.getByLabelText("Current academic period")
  ).toHaveTextContent("2025-2026 · 1st Semester");

  expect(screen.queryByText("2026-2027 · 1st Semester")).not.toBeInTheDocument();

  expect(screen.queryByText(/period mismatch/i)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Assign$/ })).toBeEnabled();

  expect(
    screen.getByRole("button", { name: "Save Assignments" })
  ).toBeDisabled();

  expect(assignFacultyLoadToBackend).not.toHaveBeenCalled();
});

test("uses the backend-returned authoritative period after saving", async () => {
  assignFacultyLoadToBackend.mockResolvedValue({
    status: "Success",
    assignment: { id: 77, academicSectionId: 31, schoolYear: "2027-2028", semester: "FIRST" },
  });
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  stageAssignment();
  fireEvent.click(screen.getByRole("button", { name: "Save Assignments" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Assignments saved successfully"));
  expect(JSON.parse(localStorage.getItem("registrarAssignments"))[0]).toMatchObject({
    schoolYear: "2027-2028", semesterCode: "FIRST", semester: "1st Semester",
  });
});

test("rejects an end time that is not after the start time", async () => {
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  fireEvent.click(screen.getByRole("radio", { name: "Select IT 321" }));
  fireEvent.change(screen.getByLabelText("Day for BSIT 3-1"), { target: { value: "Monday" } });
  fireEvent.change(screen.getByLabelText("Start time for BSIT 3-1"), { target: { value: "10:00" } });
  fireEvent.change(screen.getByLabelText("End time for BSIT 3-1"), { target: { value: "09:00" } });
  fireEvent.click(screen.getByRole("button", { name: /Assign$/ }));
  expect(screen.getByRole("status")).toHaveTextContent("Start time must be before end time");
  expect(screen.getByRole("button", { name: "Save Assignments" })).toBeDisabled();
});

test("accepts and displays a readable day and time range", async () => {
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  fireEvent.click(screen.getByRole("radio", { name: "Select IT 321" }));
  fireEvent.change(screen.getByLabelText("Day for BSIT 3-1"), { target: { value: "Monday" } });
  fireEvent.change(screen.getByLabelText("Start time for BSIT 3-1"), { target: { value: "08:00" } });
  fireEvent.change(screen.getByLabelText("End time for BSIT 3-1"), { target: { value: "10:00" } });
  fireEvent.click(screen.getByRole("button", { name: /Assign$/ }));
  expect(screen.getByText("Monday • 8:00 AM–10:00 AM")).toBeInTheDocument();
});

test("Clear Selection removes four pending rows and resets pending totals without an API call", async () => {
  const subjects = ["IT 321", "GE 101", "GE 102", "IT 322"].map((subjectCode) => ({
    subjectCode, subjectTitle: `${subjectCode} title`, yearLevel: 3, semester: "SECOND", units: 3,
  }));
  fetchFacultyAssignmentOptions.mockResolvedValue({
    subjects,
    sections: [{ id: 31, department: "Bachelor of Science in Information Technology", programCode: "BSIT", yearLevel: 3, section: "3-1" }],
    schoolYears: ["2026-2027"], enrollmentPeriods: [],
    activeAcademicPeriod: { schoolYear: "2026-2027", semester: "SECOND" },
  });
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  subjects.forEach(({ subjectCode }) => stageAssignment(subjectCode));
  expect(pendingTotal("Total Assignments")).toHaveTextContent("4");
  expect(pendingTotal("Total Units")).toHaveTextContent("12");

  fireEvent.click(screen.getByRole("button", { name: /Clear Selection/ }));

  expect(pendingTotal("Total Assignments")).toHaveTextContent("0");
  expect(pendingTotal("Total Units")).toHaveTextContent("0");
  expect(screen.getByRole("button", { name: "Save Assignments" })).toBeDisabled();
  expect(screen.getByText("No assignments yet.")).toBeInTheDocument();
  expect(assignFacultyLoadToBackend).not.toHaveBeenCalled();
});

test("Clear Selection is disabled when the selected faculty has only saved assignments", async () => {
  fetchFacultyAssignmentOptions.mockResolvedValue({
    subjects: [{ subjectCode: "IT 321", subjectTitle: "Web Systems and Technologies", yearLevel: 3, semester: "SECOND", units: 3 }],
    sections: [{ id: 31, department: "Bachelor of Science in Information Technology", programCode: "BSIT", yearLevel: 3, section: "3-1" }],
    schoolYears: ["2026-2027"], enrollmentPeriods: [],
    activeAcademicPeriod: { schoolYear: "2026-2027", semester: "SECOND" },
    assignments: [savedAssignment(), savedAssignment({ id: 71, subjectCode: "GE 101" })],
  });
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();

  expect(screen.getAllByText("Saved")).toHaveLength(2);
  expect(screen.getByRole("button", { name: /Clear Selection/ })).toBeDisabled();
  expect(pendingTotal("Total Assignments")).toHaveTextContent("0");
  expect(JSON.parse(localStorage.getItem("registrarAssignments"))).toHaveLength(2);
  expect(assignFacultyLoadToBackend).not.toHaveBeenCalled();
});

test("Clear Selection removes pending rows but preserves mixed saved rows", async () => {
  fetchFacultyAssignmentOptions.mockResolvedValue({
    subjects: [{ subjectCode: "IT 321", subjectTitle: "Web Systems and Technologies", yearLevel: 3, semester: "SECOND", units: 3 }],
    sections: [{ id: 31, department: "Bachelor of Science in Information Technology", programCode: "BSIT", yearLevel: 3, section: "3-1" }],
    schoolYears: ["2026-2027"], enrollmentPeriods: [],
    activeAcademicPeriod: { schoolYear: "2026-2027", semester: "SECOND" },
    assignments: [savedAssignment(), savedAssignment({ id: 71, subjectCode: "GE 101" })],
  });
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  stageAssignment();
  expect(pendingTotal("Total Assignments")).toHaveTextContent("1");

  fireEvent.click(screen.getByRole("button", { name: /Clear Selection/ }));

  expect(screen.getAllByText("Saved")).toHaveLength(2);
  expect(pendingTotal("Total Assignments")).toHaveTextContent("0");
  expect(JSON.parse(localStorage.getItem("registrarAssignments"))).toHaveLength(2);
  expect(assignFacultyLoadToBackend).not.toHaveBeenCalled();
});

test("Clear Selection is isolated to the currently selected faculty", async () => {
  fetchApprovedFaculties.mockResolvedValue({ faculties: [
    { id: 1, fullname: "Carlos Reyes", department: "Bachelor of Science in Information Technology" },
    { id: 2, fullname: "Ana Santos", department: "Bachelor of Science in Information Technology" },
  ] });
  fetchFacultyAssignmentOptions.mockResolvedValue({
    subjects: [
      { subjectCode: "IT 321", subjectTitle: "Web Systems", yearLevel: 3, semester: "SECOND", units: 3 },
      { subjectCode: "IT 322", subjectTitle: "Mobile Systems", yearLevel: 3, semester: "SECOND", units: 3 },
    ],
    sections: [{ id: 31, department: "Bachelor of Science in Information Technology", programCode: "BSIT", yearLevel: 3, section: "3-1" }],
    schoolYears: ["2026-2027"], enrollmentPeriods: [],
    activeAcademicPeriod: { schoolYear: "2026-2027", semester: "SECOND" },
  });
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  stageAssignment("IT 321");
  fireEvent.focus(screen.getByLabelText("Search professors"));
  fireEvent.click(screen.getByRole("button", { name: /Ana Santos/ }));
  stageAssignment("IT 322");
  fireEvent.focus(screen.getByLabelText("Search professors"));
  fireEvent.click(screen.getByRole("button", { name: /Carlos Reyes/ }));
  fireEvent.click(screen.getByRole("button", { name: /Clear Selection/ }));
  expect(screen.getByRole("button", { name: "Save Assignments" })).toBeDisabled();

  fireEvent.focus(screen.getByLabelText("Search professors"));
  fireEvent.click(screen.getByRole("button", { name: /Ana Santos/ }));
  expect(screen.getByText("1 pending assignment")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save Assignments" })).toBeEnabled();
});

test("Clear Selection removes temporary schedule state and allows a fresh selection", async () => {
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  stageAssignment();
  const schedule = screen.getByLabelText("Day for BSIT 3-1");
  fireEvent.change(schedule, { target: { value: "Saturday" } });
  fireEvent.click(screen.getByRole("button", { name: /Clear Selection/ }));

  stageAssignment();
  expect(screen.getByText("1 pending assignment")).toBeInTheDocument();
  expect(screen.getByLabelText("Day for BSIT 3-1")).toHaveValue("");
});

test("successful Save clears the temporary row and Clear cannot remove the persisted assignment", async () => {
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  stageAssignment();
  fireEvent.click(screen.getByRole("button", { name: "Save Assignments" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Assignments saved successfully"));

  expect(screen.getAllByText("Saved")).toHaveLength(1);
  expect(screen.queryByLabelText("Remove IT 321 BSIT 3-1")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Clear Selection/ })).toBeDisabled();
  expect(pendingTotal("Total Assignments")).toHaveTextContent("0");
  expect(JSON.parse(localStorage.getItem("registrarAssignments"))).toHaveLength(1);
  expect(assignFacultyLoadToBackend).toHaveBeenCalledTimes(1);
  expect(assignFacultyLoadToBackend).toHaveBeenCalledWith(expect.objectContaining({ academicSectionId: 31 }));
});

test("failed Save keeps the pending selection available", async () => {
  assignFacultyLoadToBackend.mockRejectedValue(new Error("Assignment rejected"));
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  stageAssignment();
  fireEvent.click(screen.getByRole("button", { name: "Save Assignments" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Assignment rejected"));

  expect(screen.getByText("1 pending assignment")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save Assignments" })).toBeEnabled();
  expect(localStorage.getItem("registrarAssignments")).toBeNull();
});

test("Clear Selection is a non-submit button and never invokes Save", async () => {
  const submit = jest.fn((event) => event.preventDefault());
  render(<form onSubmit={submit}><AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/></form>);
  await selectFaculty();
  stageAssignment();
  const clear = screen.getByRole("button", { name: /Clear Selection/ });
  expect(clear).toHaveAttribute("type", "button");
  submit.mockClear();
  fireEvent.click(clear);

  expect(submit).not.toHaveBeenCalled();
  expect(assignFacultyLoadToBackend).not.toHaveBeenCalled();
});

test("filters manual assignment rows by exact academicSectionId and restores all sections", async () => {
  fetchFacultyAssignmentOptions.mockResolvedValue({
    subjects: [{ subjectCode: "IT 321", subjectTitle: "Web Systems", yearLevel: 3, semester: "SECOND", units: 3 }],
    sections: [
      { id: 31, department: "Bachelor of Science in Information Technology", programCode: "BSIT", yearLevel: 3, section: "3-1" },
      { id: 32, department: "Bachelor of Science in Information Technology", programCode: "BECE", yearLevel: 3, section: "3-1" },
    ],
    schoolYears: ["2026-2027"], enrollmentPeriods: [],
    activeAcademicPeriod: { schoolYear: "2026-2027", semester: "SECOND" },
  });
  assignFacultyLoadToBackend.mockResolvedValue({ status: "Success", assignment: { id: 88, academicSectionId: 32 } });
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  fireEvent.click(screen.getByRole("radio", { name: "Select IT 321" }));

  expect(screen.getByLabelText("Day for BSIT 3-1")).toBeInTheDocument();
  expect(screen.getByLabelText("Day for BECE 3-1")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Section Filter"), { target: { value: "32" } });
  expect(screen.queryByLabelText("Day for BSIT 3-1")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Day for BECE 3-1")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Assign$/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save Assignments" }));
  await waitFor(() => expect(assignFacultyLoadToBackend).toHaveBeenCalledWith(
    expect.objectContaining({ academicSectionId: 32, sectionName: "BECE 3-1" })
  ));

  fireEvent.change(screen.getByLabelText("Section Filter"), { target: { value: "all" } });
  expect(screen.getByLabelText("Day for BSIT 3-1")).toBeInTheDocument();
  expect(screen.getByLabelText("Day for BECE 3-1")).toBeInTheDocument();
});

test("hydrates a persisted server schedule after reload", async () => {
  fetchFacultyAssignmentOptions.mockResolvedValue({
    program: { code: "BSIT", name: "Bachelor of Science in Information Technology" },
    subjects: [{ subjectCode: "IT 321", subjectTitle: "Web Systems", yearLevel: 3, semester: "SECOND", units: 3 }],
    sections: [{ id: 31, department: "Bachelor of Science in Information Technology", programCode: "BSIT", yearLevel: 3, section: "3-1" }],
    schoolYears: ["2026-2027"], enrollmentPeriods: [],
    activeAcademicPeriod: { schoolYear: "2026-2027", semester: "SECOND" },
    assignments: [{ id: 77, facultyUserId: 1, facultyName: "Carlos Reyes", program: "Bachelor of Science in Information Technology", sectionName: "BSIT 3-1", yearLevel: "3", subjectCode: "IT 321", academicSectionId: 31, schoolYear: "2026-2027", semester: "SECOND", schedule: "Tuesday" }],
  });
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  expect(await screen.findByText("Tuesday")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Select IT 321" }));
  expect(screen.getByLabelText("Day for BSIT 3-1")).toHaveValue("Tuesday");
  expect(JSON.parse(localStorage.getItem("registrarAssignments"))[0]).toMatchObject({ id: 77, schedule: "Tuesday" });
});

test("authoritative empty assignments remove stale current-cycle browser rows", async () => {
  localStorage.setItem("registrarAssignments", JSON.stringify([savedAssignment()]));
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();

  await waitFor(() => expect(JSON.parse(localStorage.getItem("registrarAssignments"))).toEqual([]));
  expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  expect(screen.getByText("No assignments yet.")).toBeInTheDocument();
});

test("encoding-season refresh removes a previously active assignment without a page reload", async () => {
  const activeResponse = {
    program: { code: "BSIT", name: "Bachelor of Science in Information Technology" },
    subjects: [{ subjectCode: "IT 321", subjectTitle: "Web Systems", yearLevel: 3, semester: "SECOND", units: 3 }],
    sections: [{ id: 31, department: "Bachelor of Science in Information Technology", programCode: "BSIT", yearLevel: 3, section: "3-1" }],
    schoolYears: ["2026-2027"], enrollmentPeriods: [], assignments: [savedAssignment()],
  };
  fetchFacultyAssignmentOptions.mockResolvedValueOnce(activeResponse).mockResolvedValueOnce({ ...activeResponse, assignments: [] });
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  expect(await screen.findByText("Saved")).toBeInTheDocument();

  window.dispatchEvent(new CustomEvent("blockgo:academic-data-changed", { detail: { reason: "encoding_season_reset" } }));

  await waitFor(() => expect(screen.queryByText("Saved")).not.toBeInTheDocument());
  expect(JSON.parse(localStorage.getItem("registrarAssignments"))).toEqual([]);
});

test("failed reset refresh preserves the last confirmed current assignment", async () => {
  const activeResponse = {
    program: { code: "BSIT", name: "Bachelor of Science in Information Technology" },
    subjects: [], sections: [], schoolYears: ["2026-2027"], enrollmentPeriods: [], assignments: [savedAssignment()],
  };
  fetchFacultyAssignmentOptions.mockResolvedValueOnce(activeResponse).mockRejectedValueOnce(new Error("offline"));
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  expect(await screen.findByText("Saved")).toBeInTheDocument();

  window.dispatchEvent(new CustomEvent("blockgo:academic-data-changed", { detail: { reason: "encoding_season_reset" } }));

  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("could not be refreshed"));
  expect(screen.getByText("Saved")).toBeInTheDocument();
});

test("keeps schedules subject-specific so an existing BSIT 1-1 load cannot block another eligible subject", async () => {
  const subjects = [
    { subjectCode: "IT 101", subjectTitle: "Introduction to Computing", yearLevel: 1, semester: "FIRST", units: 3 },
    { subjectCode: "MATH 101", subjectTitle: "Mathematics in the Modern World", yearLevel: 1, semester: "FIRST", units: 3 },
  ];
  fetchCurriculums.mockResolvedValue({ data: [{ programCode: "BSIT", status: "PUBLISHED", subjects }] });
  fetchFacultyAssignmentOptions.mockResolvedValue({
    program: { code: "BSIT", name: "Bachelor of Science in Information Technology" },
    subjects,
    sections: [
      { id: 2, department: "Bachelor of Science in Information Technology", programCode: "BSIT", yearLevel: 1, section: "1-1" },
      { id: 3, department: "Bachelor of Science in Information Technology", programCode: "BSIT", yearLevel: 1, section: "1-2" },
    ],
    enrollmentPeriods: [
      { academicSectionId: 2, schoolYear: "2026-2027", semester: "FIRST", yearLevel: 1, section: "1-1" },
      { academicSectionId: 3, schoolYear: "2026-2027", semester: "FIRST", yearLevel: 1, section: "1-2" },
    ],
    activeAcademicPeriod: { schoolYear: "2026-2027", semester: "FIRST" },
    assignments: [{
      id: 3, facultyUserId: 1, facultyName: "Carlos Reyes", program: "Bachelor of Science in Information Technology",
      sectionName: "BSIT 1-1", yearLevel: "1", subjectCode: "IT 101", academicSectionId: 2,
      schoolYear: "2026-2027", semester: "FIRST", schedule: "Wednesday | 08:00-10:00",
    }],
  });
  assignFacultyLoadToBackend.mockImplementation(async (assignment) => ({
    status: "Success", assignment: { id: assignment.academicSectionId + 100, academicSectionId: assignment.academicSectionId },
  }));

  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  fireEvent.change(screen.getByLabelText("Year Level"), { target: { value: "1st Year" } });

  fireEvent.click(screen.getByRole("radio", { name: "Select IT 101" }));
  expect(screen.getByLabelText("Day for BSIT 1-1")).toHaveValue("Wednesday");

  fireEvent.click(screen.getByRole("radio", { name: "Select MATH 101" }));
  expect(screen.getByLabelText("Day for BSIT 1-1")).toHaveValue("");
  expect(screen.getByLabelText("Day for BSIT 1-2")).toHaveValue("");

  fireEvent.change(screen.getByLabelText("Section Filter"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: /Assign$/ }));
  expect(screen.getByText("1 pending assignment")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save Assignments" }));
  await waitFor(() => expect(assignFacultyLoadToBackend).toHaveBeenCalledWith(
    expect.objectContaining({ academicSectionId: 2, subjectCode: "MATH 101", schedule: "" })
  ));

  fireEvent.change(screen.getByLabelText("Section Filter"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: /Assign$/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save Assignments" }));
  await waitFor(() => expect(assignFacultyLoadToBackend).toHaveBeenCalledWith(
    expect.objectContaining({ academicSectionId: 3, subjectCode: "MATH 101", schedule: "" })
  ));
});

