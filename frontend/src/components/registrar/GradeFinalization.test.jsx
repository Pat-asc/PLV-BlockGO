import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import GradeFinalization from "./GradeFinalization";
import { fetchAllGrades, finalizeGrade } from "../../services/api";

jest.mock("../../services/api", () => ({
  fetchAllGrades: jest.fn(),
  finalizeGrade: jest.fn(),
}));
const approvedRecord = {
  id: "grade-uuid-1",
  assignment_cycle_id: "77",
  course: "BSIT",
  section: "BSIT 1-1",
  subject_code: "IT 101",
  status: "DepartmentApproved",
  grade: JSON.stringify({ midterm: "85", finals: "90" }),
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  window.confirm = jest.fn(() => true);
});

test("finalizes the authoritative staging UUID and removes it after the ledger refresh", async () => {
  fetchAllGrades.mockResolvedValueOnce({ data: [approvedRecord] }).mockResolvedValue({ data: [] });
  finalizeGrade.mockResolvedValue({ status: "Success" });
  render(<GradeFinalization />);

  fireEvent.click(await screen.findByRole("button", { name: "Finalize to Ledger" }));
  await waitFor(() => expect(finalizeGrade).toHaveBeenCalledWith("grade-uuid-1", "registrar"));
  expect(await screen.findByText("No grades approved and forwarded for ledger finalization.")).toBeInTheDocument();
});

test("ledger failure shows a safe retry message and retains a still-pending record", async () => {
  fetchAllGrades.mockResolvedValue({ data: [approvedRecord] });
  finalizeGrade.mockRejectedValue(new Error("Ledger unavailable"));
  render(<GradeFinalization />);

  fireEvent.click(await screen.findByRole("button", { name: "Finalize to Ledger" }));
  expect(await screen.findByRole("status")).toHaveTextContent("authoritative ledger state has been refreshed");
  expect(finalizeGrade).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Finalize to Ledger" })).toBeEnabled();
});
