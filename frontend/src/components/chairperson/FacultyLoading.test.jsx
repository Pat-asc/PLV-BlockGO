import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import FacultyLoading, { FACULTY_LOADING_CSV_TEMPLATE } from "./FacultyLoading";
import {
  bulkAssignFacultyLoads,
  fetchApprovedFaculties,
  fetchFacultyAssignmentOptions,
} from "../../services/api";

jest.mock("../../services/api", () => ({
  assignFacultyLoadToBackend: jest.fn(),
  bulkAssignFacultyLoads: jest.fn(),
  fetchApprovedFaculties: jest.fn(),
  fetchFacultyAssignmentOptions: jest.fn(),
  unassignFacultySection: jest.fn(),
}));

jest.mock("../../utils/sharedClientState", () => ({
  pushAssignmentsSharedState: jest.fn().mockResolvedValue(undefined),
}));

const options = {
  sections: [
    { id: 42, programCode: "BSIT", department: "BS Information Technology", yearLevel: 1, section: "1-1" },
    { id: 43, programCode: "BSIT", department: "BS Information Technology", yearLevel: 1, section: "1-2" },
  ],
  subjects: [
    { subjectCode: "IT 101", subjectTitle: "Introduction to Computing", yearLevel: 1, semester: "FIRST", units: 3 },
    { subjectCode: "IT 102", subjectTitle: "Programming 1", yearLevel: 1, semester: "FIRST", units: 3 },
  ],
  schoolYears: ["2026-2027"],
};

const faculty = [
  { id: 11, fullname: "Professor A", email: "a@plv.edu.ph", department: "BS Information Technology" },
  { id: 12, fullname: "Professor B", email: "b@plv.edu.ph", department: "BS Information Technology" },
];

const uploadCsv = async (content) => {
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new File([content], "loads.csv", { type: "text/csv" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Preview Faculty Loading" }));
  await screen.findByText("Faculty Loading Preview");
};

beforeEach(() => {
  localStorage.clear();
  window.alert = jest.fn();
  fetchApprovedFaculties.mockResolvedValue({ status: "Success", faculties: faculty });
  fetchFacultyAssignmentOptions.mockResolvedValue(options);
  bulkAssignFacultyLoads.mockReset();
});

test("sends exact bulk identities and marks a row saved only after backend confirmation", async () => {
  bulkAssignFacultyLoads.mockImplementation(async (rows) => ({
    status: "Success",
    results: rows.map((row) => ({
      clientId: row.id,
      success: true,
      assignment: {
        id: 501,
        assignmentCycleId: "501",
        facultyUserId: 11,
        facultyEmail: "a@plv.edu.ph",
        facultyName: "Professor A",
        program: "BS Information Technology",
        programCode: "BSIT",
        section: "BSIT 1-1",
        yearLevel: 1,
        subjectCode: "IT 101",
        academicSectionId: 42,
        schoolYear: "2026-2027",
        semester: "FIRST",
      },
    })),
  }));

  render(<FacultyLoading chairpersonDepartment="BS Information Technology" assignmentMode="bulk" />);
  await waitFor(() => expect(fetchFacultyAssignmentOptions).toHaveBeenCalled());
  await uploadCsv(
    "Faculty Email,Subject Code,Academic Section ID,Section,School Year,Semester\n" +
    "a@plv.edu.ph,IT 101,42,BSIT 1-1,2026-2027,1st Semester"
  );

  fireEvent.click(screen.getByRole("button", { name: "Save Assignments" }));
  await waitFor(() => expect(bulkAssignFacultyLoads).toHaveBeenCalledTimes(1));
  expect(bulkAssignFacultyLoads.mock.calls[0][0][0]).toEqual(expect.objectContaining({
    facultyUserId: 11,
    subjectCode: "IT 101",
    academicSectionId: 42,
    schoolYear: "2026-2027",
    semester: "FIRST",
  }));
  await screen.findByText("Faculty Loading", { selector: "span" });
  expect(JSON.parse(localStorage.getItem("registrarAssignments"))[0]).toEqual(expect.objectContaining({
    id: 501,
    academicSectionId: 42,
    facultyEmail: "a@plv.edu.ph",
  }));
  expect(screen.queryByRole("button", { name: "Save Assignments" })).not.toBeInTheDocument();
});

test("partial success preserves the failed row and Clear Selection removes only pending rows", async () => {
  bulkAssignFacultyLoads.mockImplementation(async (rows) => ({
    status: "PartialSuccess",
    results: [
      {
        clientId: rows[0].id,
        success: true,
        assignment: {
          id: 601, assignmentCycleId: "601", facultyUserId: 11,
          facultyEmail: "a@plv.edu.ph", facultyName: "Professor A",
          program: "BS Information Technology", programCode: "BSIT", section: "BSIT 1-1",
          yearLevel: 1, subjectCode: "IT 101", academicSectionId: 42,
          schoolYear: "2026-2027", semester: "FIRST",
        },
      },
      { clientId: rows[1].id, success: false, error: "Subject not found in the published curriculum." },
    ],
  }));

  render(<FacultyLoading chairpersonDepartment="BS Information Technology" assignmentMode="bulk" />);
  await waitFor(() => expect(fetchApprovedFaculties).toHaveBeenCalled());
  await uploadCsv(
    "Faculty ID,Subject Code,Academic Section ID,Section,School Year,Semester\n" +
    "11,IT 101,42,BSIT 1-1,2026-2027,FIRST\n" +
    "12,IT 102,43,BSIT 1-2,2026-2027,FIRST"
  );
  fireEvent.click(screen.getByRole("button", { name: "Save Assignments" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Pending — Subject not found");
  expect(JSON.parse(localStorage.getItem("registrarAssignments"))).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Clear Selection" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("registrarAssignments"))).toHaveLength(1);
  expect(screen.getAllByText("Professor A").length).toBeGreaterThan(0);
});

test("download template requires Academic Section ID and keeps Section display-only", () => {
  const [header] = FACULTY_LOADING_CSV_TEMPLATE.split("\n");
  expect(header).toContain("Academic Section ID");
  expect(header).toContain("Section");
});

test("rejects a CSV that omits Academic Section ID", async () => {
  render(<FacultyLoading chairpersonDepartment="BS Information Technology" assignmentMode="bulk" />);
  await waitFor(() => expect(fetchFacultyAssignmentOptions).toHaveBeenCalled());
  await uploadCsv(
    "Faculty Email,Subject Code,Section,School Year,Semester\n" +
    "a@plv.edu.ph,IT 101,BSIT 1-1,2026-2027,FIRST"
  );

  expect(screen.getByText(/Missing required CSV headers.*Academic Section ID/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save Assignments" })).toBeDisabled();
  expect(bulkAssignFacultyLoads).not.toHaveBeenCalled();
});

test("rejects an unknown numeric Academic Section ID", async () => {
  render(<FacultyLoading chairpersonDepartment="BS Information Technology" assignmentMode="bulk" />);
  await waitFor(() => expect(fetchFacultyAssignmentOptions).toHaveBeenCalled());
  await uploadCsv(
    "Faculty Email,Subject Code,Academic Section ID,Section,School Year,Semester\n" +
    "a@plv.edu.ph,IT 101,999,BSIT 1-1,2026-2027,FIRST"
  );

  expect(screen.getByText(/academic section ID "999" does not exist/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save Assignments" })).toBeDisabled();
  expect(bulkAssignFacultyLoads).not.toHaveBeenCalled();
});

test("duplicate section labels cannot override the numeric Academic Section ID", async () => {
  fetchFacultyAssignmentOptions.mockResolvedValue({
    ...options,
    sections: [
      options.sections[0],
      { id: 99, programCode: "BSCS", department: "BS Computer Science", yearLevel: 1, section: "1-1" },
    ],
  });
  bulkAssignFacultyLoads.mockImplementation(async (rows) => ({
    status: "Success",
    results: rows.map((row) => ({ clientId: row.id, success: true, assignment: {
      id: 700, assignmentCycleId: "700", facultyUserId: 11, facultyEmail: "a@plv.edu.ph",
      facultyName: "Professor A", program: "BS Information Technology", programCode: "BSIT",
      section: "BSIT 1-1", yearLevel: 1, subjectCode: "IT 101",
      academicSectionId: row.academicSectionId, schoolYear: "2026-2027", semester: "FIRST",
    } })),
  }));

  render(<FacultyLoading chairpersonDepartment="BS Information Technology" assignmentMode="bulk" />);
  await waitFor(() => expect(fetchFacultyAssignmentOptions).toHaveBeenCalled());
  await uploadCsv(
    "Faculty Email,Subject Code,Academic Section ID,Section,School Year,Semester\n" +
    "a@plv.edu.ph,IT 101,42,BSCS 1-1,2026-2027,FIRST"
  );
  fireEvent.click(screen.getByRole("button", { name: "Save Assignments" }));

  await waitFor(() => expect(bulkAssignFacultyLoads).toHaveBeenCalledTimes(1));
  expect(bulkAssignFacultyLoads.mock.calls[0][0][0].academicSectionId).toBe(42);
});
