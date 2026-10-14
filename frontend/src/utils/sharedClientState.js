import {
  fetchSharedClientState,
  saveSharedClientState,
} from "../services/api";
import {
  STUDENT_BATCHES_KEY,
  STUDENT_SUBMISSION_LOGS_KEY,
  syncSectionedStudentsToStorage,
} from "./studentSectioningHelpers";
import { CHAIRPERSON_REVIEW_KEY } from "./chairpersonHelpers";
import { STUDENT_PUBLISHED_GRADES_KEY } from "./publishedGradesHelpers";

export const SHARED_CLIENT_STATE_KEYS = [
  STUDENT_BATCHES_KEY,
  STUDENT_SUBMISSION_LOGS_KEY,
  "studentMasterlist",
  "studentSections",
  "registrarAssignments",
  CHAIRPERSON_REVIEW_KEY,
  STUDENT_PUBLISHED_GRADES_KEY,
  "graduatingStudents",
  "irregularSubjectAssignments",
  "encodingPeriod",
  "facultyLoadResetAt",
  "STUDENT_BATCHES_KEY",
  "STUDENT_SUBMISSION_LOGS_KEY",
];

const parseLocalValue = (key) => {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const storeLocalValue = (key, value) => {
  if (value === null || value === undefined) return;
  localStorage.setItem(
    key,
    typeof value === "string" ? value : JSON.stringify(value)
  );
};

export const pushSharedClientState = async (keys = SHARED_CLIENT_STATE_KEYS) => {
  await Promise.all(
    keys.map(async (key) => {
      const value = parseLocalValue(key);
      if (value === null || value === undefined) return null;
      return saveSharedClientState(key, value);
    })
  );
};

export const pushSectioningSharedState = () =>
  pushSharedClientState([
    STUDENT_BATCHES_KEY,
    STUDENT_SUBMISSION_LOGS_KEY,
    "studentMasterlist",
    "studentSections",
    "graduatingStudents",
    "irregularSubjectAssignments",
  ]).catch((error) => console.warn("Shared sectioning sync failed:", error));

export const pushAssignmentsSharedState = () =>
  pushSharedClientState(["registrarAssignments"]).catch((error) =>
    console.warn("Shared assignment sync failed:", error)
  );

export const pullSharedClientState = async (keys = SHARED_CLIENT_STATE_KEYS) => {
  const results = await Promise.allSettled(
    keys.map(async (key) => {
      const response = await fetchSharedClientState(key);
      if (response?.value === null || response?.value === undefined) return null;
      storeLocalValue(key, response.value);
      return key;
    })
  );

  const updatedKeys = results
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value);

  if (updatedKeys.includes(STUDENT_BATCHES_KEY)) {
    const batches = parseLocalValue(STUDENT_BATCHES_KEY);
    if (Array.isArray(batches)) {
      syncSectionedStudentsToStorage(batches);
    }
  }

  if (updatedKeys.length) {
    window.dispatchEvent(
      new CustomEvent("blockgo:shared-client-state-changed", {
        detail: { keys: updatedKeys },
      })
    );
  }

  return updatedKeys;
};
