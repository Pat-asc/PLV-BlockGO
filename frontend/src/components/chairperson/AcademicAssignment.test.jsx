import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import AcademicAssignment from "./AcademicAssignment";
import { fetchApprovedFaculties, fetchCurriculums, fetchFacultyAssignmentOptions, assignFacultyLoadToBackend } from "../../services/api";
jest.mock("../../services/api", () => ({ fetchApprovedFaculties: jest.fn(), fetchCurriculums: jest.fn(), fetchFacultyAssignmentOptions: jest.fn(), assignFacultyLoadToBackend: jest.fn() }));
jest.mock("../../utils/sharedClientState", () => ({ pushAssignmentsSharedState: jest.fn() }));
jest.mock("./FacultyLoading", () => () => <div>Bulk import</div>);
beforeEach(() => {
  localStorage.clear(); jest.clearAllMocks();
  fetchApprovedFaculties.mockResolvedValue({ faculties: [{ id: 1, fullname: "Carlos Reyes", department: "Bachelor of Science in Information Technology" }] });
  fetchCurriculums.mockResolvedValue({ data: [{ programCode: "BSIT", status: "PUBLISHED", subjects: [{ subjectCode: "IT 321", subjectTitle: "Web Systems and Technologies", yearLevel: 3, semester: "SECOND", units: 3 }] }] });
  fetchFacultyAssignmentOptions.mockResolvedValue({
    subjects: [{ subjectCode: "IT 321", subjectTitle: "Web Systems and Technologies", yearLevel: 3, semester: "SECOND", units: 3 }],
    sections: [{ id: 31, department: "Bachelor of Science in Information Technology", programCode: "BSIT", yearLevel: 3, section: "3-1" }],
    schoolYears: ["2026-2027"], enrollmentPeriods: []
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
  expect(screen.getByLabelText("Academic Program").options).toHaveLength(1);
});
test("stages assignments, prevents duplicates, and persists only on Save", async () => {
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  fireEvent.click(await screen.findByRole("button", { name: /Carlos Reyes/ }));
  fireEvent.click(screen.getByRole("radio", { name: "Select IT 321" }));
  fireEvent.change(screen.getByLabelText("Schedule for BSIT 3-1"), { target: { value: "Mon 8:00 AM – 10:00 AM" } });
  fireEvent.click(screen.getByRole("button", { name: "＋ Assign" }));
  expect(localStorage.getItem("registrarAssignments")).toBeNull();
  expect(screen.getByText("1 pending assignment")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "＋ Assign" }));
  expect(screen.getByRole("status")).toHaveTextContent("already have an assignment");
  fireEvent.click(screen.getByRole("button", { name: "Save Assignments" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Assignments saved successfully"));
  const saved = JSON.parse(localStorage.getItem("registrarAssignments"));
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ facultyId: "1", subjectCode: "IT 321", sectionName: "BSIT 3-1", schedule: "Mon 8:00 AM – 10:00 AM" });
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

test("Clear Selection removes four pending rows and resets pending totals without an API call", async () => {
  const subjects = ["IT 321", "GE 101", "GE 102", "IT 322"].map((subjectCode) => ({
    subjectCode, subjectTitle: `${subjectCode} title`, yearLevel: 3, semester: "SECOND", units: 3,
  }));
  fetchFacultyAssignmentOptions.mockResolvedValue({
    subjects,
    sections: [{ id: 31, department: "Bachelor of Science in Information Technology", programCode: "BSIT", yearLevel: 3, section: "3-1" }],
    schoolYears: ["2026-2027"], enrollmentPeriods: [],
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
  localStorage.setItem("registrarAssignments", JSON.stringify([
    savedAssignment(), savedAssignment({ id: 71, subjectCode: "GE 101" }),
  ]));
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();

  expect(screen.getAllByText("Saved")).toHaveLength(2);
  expect(screen.getByRole("button", { name: /Clear Selection/ })).toBeDisabled();
  expect(pendingTotal("Total Assignments")).toHaveTextContent("0");
  expect(JSON.parse(localStorage.getItem("registrarAssignments"))).toHaveLength(2);
  expect(assignFacultyLoadToBackend).not.toHaveBeenCalled();
});

test("Clear Selection removes pending rows but preserves mixed saved rows", async () => {
  localStorage.setItem("registrarAssignments", JSON.stringify([
    savedAssignment(), savedAssignment({ id: 71, subjectCode: "GE 101" }),
  ]));
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
  const schedule = screen.getByLabelText("Schedule for BSIT 3-1");
  fireEvent.change(schedule, { target: { value: "Saturday 9:00 AM" } });
  fireEvent.click(screen.getByRole("button", { name: /Clear Selection/ }));

  stageAssignment();
  expect(screen.getByText("1 pending assignment")).toBeInTheDocument();
  expect(screen.getByLabelText("Schedule for BSIT 3-1")).toHaveValue("");
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
  });
  assignFacultyLoadToBackend.mockResolvedValue({ status: "Success", assignment: { id: 88, academicSectionId: 32 } });
  render(<AcademicAssignment chairpersonDepartment="Bachelor of Science in Information Technology"/>);
  await selectFaculty();
  fireEvent.click(screen.getByRole("radio", { name: "Select IT 321" }));

  expect(screen.getByLabelText("Schedule for BSIT 3-1")).toBeInTheDocument();
  expect(screen.getByLabelText("Schedule for BECE 3-1")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Section Filter"), { target: { value: "32" } });
  expect(screen.queryByLabelText("Schedule for BSIT 3-1")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Schedule for BECE 3-1")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Assign$/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save Assignments" }));
  await waitFor(() => expect(assignFacultyLoadToBackend).toHaveBeenCalledWith(
    expect.objectContaining({ academicSectionId: 32, sectionName: "BECE 3-1" })
  ));

  fireEvent.change(screen.getByLabelText("Section Filter"), { target: { value: "all" } });
  expect(screen.getByLabelText("Schedule for BSIT 3-1")).toBeInTheDocument();
  expect(screen.getByLabelText("Schedule for BECE 3-1")).toBeInTheDocument();
});

