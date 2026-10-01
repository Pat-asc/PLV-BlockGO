import { showSystemNotification } from '../../services/NotificationContext';
import { requestSystemConfirmation } from '../../services/SystemDialogContext';
import React, { useEffect, useState } from "react";
import { fetchAcademicPeriodOptions, getSystemSetting, updateSystemSetting } from "../../services/api";
import StatusBadge from "../shared/StatusBadge";

const toSemesterDisplay = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "FIRST" || normalized === "1ST SEMESTER") return "1st Semester";
  if (normalized === "SECOND" || normalized === "2ND SEMESTER") return "2nd Semester";
  if (["MIDYEAR", "SUMMER", "SUMMER / MIDYEAR"].includes(normalized)) return "Summer";
  return "";
};

function EncodingPeriod({ onResetEncodingSeason }) {
  const today = new Date();
  const currentYear = today.getMonth() >= 5 ? today.getFullYear() : today.getFullYear() - 1;
  const fallbackSchoolYear = `${currentYear}-${currentYear + 1}`;
  const [period, setPeriod] = useState({
    schoolYear: fallbackSchoolYear,
    semester: "2nd Semester",
    startDate: "",
    endDate: "",
    term: "midterm",
  });
  const [statusMessage, setStatusMessage] = useState("");
  const [isResettingSeason, setIsResettingSeason] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [schoolYears, setSchoolYears] = useState([fallbackSchoolYear]);
  const [savedPeriod, setSavedPeriod] = useState(null);
  const [activeAcademicPeriod, setActiveAcademicPeriod] = useState(null);

  const isSuccessStatusMessage =
    statusMessage === "Encoding period saved successfully." ||
    statusMessage === "Encoding season reset successfully.";

  useEffect(() => {
    let active = true;

    const loadSavedPeriod = async () => {
      try {
        const [settingResult, optionsResult] = await Promise.allSettled([
          getSystemSetting("encoding_period"),
          fetchAcademicPeriodOptions(),
        ]);
        if (!active) return;
        const options = optionsResult.status === "fulfilled" ? optionsResult.value : null;
        const res = settingResult.status === "fulfilled" ? settingResult.value : null;
        const activeAcademicPeriod = options?.activeAcademicPeriod || null;
        let selectedSchoolYear =
          activeAcademicPeriod?.schoolYear ||
          options?.currentSchoolYear ||
          fallbackSchoolYear;

        let parsedSavedPeriod = null;

        if (res?.status === "Success" && res.value) {
          parsedSavedPeriod = JSON.parse(res.value);

          const authoritativeSemester =
            toSemesterDisplay(activeAcademicPeriod?.semester) ||
            parsedSavedPeriod?.semester ||
            "2nd Semester";

          const resolvedPeriod = {
            schoolYear:
              activeAcademicPeriod?.schoolYear ||
              parsedSavedPeriod?.schoolYear ||
              selectedSchoolYear,
            semester: authoritativeSemester,
            startDate: parsedSavedPeriod?.startDate || "",
            endDate: parsedSavedPeriod?.endDate || "",
            term: parsedSavedPeriod?.term || "midterm",
          };

          selectedSchoolYear = resolvedPeriod.schoolYear;

          setPeriod(resolvedPeriod);
          setSavedPeriod(resolvedPeriod);
          localStorage.setItem("encodingPeriod", JSON.stringify(resolvedPeriod));
        } else {
          setPeriod((current) => ({
            ...current,
            schoolYear: selectedSchoolYear,
            semester:
              toSemesterDisplay(activeAcademicPeriod?.semester) ||
              current.semester,
          }));

          setStatusMessage("No saved encoding period yet.");
          localStorage.removeItem("encodingPeriod");
        }
        setActiveAcademicPeriod(activeAcademicPeriod);
        setSchoolYears([...new Set([
          selectedSchoolYear,
          ...(options?.schoolYears || []),
          parsedSavedPeriod?.schoolYear,
          fallbackSchoolYear,
        ].filter(Boolean))]);
        if (optionsResult.status === "rejected") {
          setLoadError("Available school years could not be refreshed. The current year remains available.");
        }
      } catch (error) {
        if (!active) return;
        setLoadError("The encoding period could not be loaded. Please refresh and try again.");
      } finally {
        if (active) setIsLoading(false);
      }
    };

    const handleSystemSettingChanged = (event) => {
      const key = event.detail?.key || event.detail?.Key;
      if (key === "encoding_period" && event.detail?.source !== "encoding-period-save") {
        loadSavedPeriod();
      }
    };

    loadSavedPeriod();
    window.addEventListener("blockgo:system-setting-changed", handleSystemSettingChanged);
    return () => {
      active = false;
      window.removeEventListener("blockgo:system-setting-changed", handleSystemSettingChanged);
    };
  }, [fallbackSchoolYear]);

  const { startDate, endDate, term } = period;

  const updatePeriod = (field, value) => {
    setPeriod((current) => ({ ...current, [field]: value }));
  };

  const getBannerStatus = (schedule = period) => {
    if (!schedule.startDate || !schedule.endDate) return "Not Set";

    const today = new Date();
    const start = new Date(schedule.startDate);
    const end = new Date(schedule.endDate);

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    today.setHours(0, 0, 0, 0);

    if (today < start) return "Closed (Not Started Yet)";
    if (today > end) return "Closed";
    
    const diffTime = end - today;
    const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (daysLeft <= 3) return "Urgent";
    return "Open";
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      const encodingData = { ...period };
      const response = await updateSystemSetting("encoding_period", JSON.stringify(encodingData));
      if (response?.status !== "Success" || typeof response.value !== "string") {
        throw new Error("The saved encoding period could not be confirmed. Refresh and try again.");
      }
      const savedData = JSON.parse(response.value);
      setPeriod(savedData);
      setActiveAcademicPeriod({ schoolYear: savedData.schoolYear, semester: savedData.semester });
      setSchoolYears((current) => [...new Set([savedData.schoolYear, ...current])]);
      localStorage.setItem("encodingPeriod", response.value);
      window.dispatchEvent(
        new CustomEvent("blockgo:system-setting-changed", {
          detail: {
            key: "encoding_period",
            value: response.value,
            source: "encoding-period-save",
          },
        })
      );
      window.dispatchEvent(new CustomEvent("blockgo:academic-data-changed", {
        detail: { reason: "encoding_period_changed", source: "encoding-period-save" },
      }));
      setStatusMessage("Encoding period saved successfully.");
      setSavedPeriod(savedData);
    } catch (error) {
      setStatusMessage(error.message || "Failed to save encoding period.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetSeason = async () => {
    const requestedPeriod = { ...period };
    const shouldReset = await requestSystemConfirmation(
      `Open ${requestedPeriod.schoolYear} ${requestedPeriod.semester} ${term} as a new encoding context? Current faculty assignments will be deactivated, while historical grades and saved sections remain intact.`
    );

    if (!shouldReset) return;

    try {
      setIsResettingSeason(true);
      if (typeof onResetEncodingSeason !== "function") {
        throw new Error("Encoding season reset is unavailable. Please refresh the page and try again.");
      }

      const response = await onResetEncodingSeason(requestedPeriod);
      const context = response?.academicContext;
      const openedSemester = toSemesterDisplay(context?.semester);
      if (!context?.academicPeriodId || !context?.schoolYear || !openedSemester || !context?.term) {
        throw new Error("The opened academic period could not be confirmed. Refresh the page before making further changes.");
      }
      const openedPeriod = {
        schoolYear: context.schoolYear,
        semester: openedSemester,
        term: context.term,
        startDate: context.startDate || "",
        endDate: context.endDate || "",
      };
      setPeriod(openedPeriod);
      setSavedPeriod(openedPeriod);
      setActiveAcademicPeriod(context);
      setSchoolYears((current) => [...new Set([openedPeriod.schoolYear, ...current])]);
      localStorage.setItem("encodingPeriod", JSON.stringify(openedPeriod));
      setStatusMessage("Encoding season reset successfully.");
      showSystemNotification(
        "Encoding season has been reset. Current faculty assignments were deactivated and the selected academic period is now active."
      );
    } catch (error) {
      setStatusMessage(
        error?.message || "Failed to reset encoding season."
      );
    } finally {
      setIsResettingSeason(false);
    }
  };

  const formatDate = (value) => {
    if (!value) return "Not set";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
  };

  const formatDay = (value) => {
    if (!value) return "Select a date";
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
  };

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm md:p-4">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-base font-bold text-slate-900">Encoding Period Control</h3>

          <StatusBadge status={getBannerStatus()} />
        </div>

        {(statusMessage || !savedPeriod) && (
          <div
            className={`mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
              isSuccessStatusMessage
                ? "border border-green-200 bg-green-50 text-green-700"
                : "border-blue-200 bg-blue-50/60 text-slate-600"
            }`}
          >
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${isSuccessStatusMessage ? "bg-green-600" : "bg-blue-700"}`}>i</span>
            <span>{statusMessage || "No saved encoding period yet."}</span>
          </div>
        )}
        {loadError && <div role="alert" className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{loadError}</div>}

        <p className="mt-3 text-xs font-semibold text-slate-700">Current Active Academic Period: {activeAcademicPeriod ? `${activeAcademicPeriod.schoolYear} · ${toSemesterDisplay(activeAcademicPeriod.semester)}` : "None"}</p>
        <p className="mt-2 text-xs font-semibold text-slate-700">Academic Period for Encoding</p>
        <p className="mt-1 text-xs text-slate-600">Select the School Year, Semester, and Encoding Term to use for grade encoding.</p>

        <div className="mt-3 grid grid-cols-1 items-end gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto_1fr]">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">School Year</label>
            <select
              aria-label="School Year"
              value={period.schoolYear}
              onChange={(event) => updatePeriod("schoolYear", event.target.value)}
              disabled={isLoading}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            >
              {isLoading ? <option value={period.schoolYear}>Loading school years…</option> : schoolYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Semester</label>
            <select
              aria-label="Semester"
              value={period.semester}
              onChange={(e) => updatePeriod("semester", e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            >
              <option value="1st Semester">1st Semester</option>
              <option value="2nd Semester">2nd Semester</option>
              <option value="Summer">Summer</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Encoding Term</label>
            <select
              aria-label="Encoding Term"
              value={term}
              onChange={(e) => updatePeriod("term", e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            >
              <option value="midterm">Midterms</option>
              <option value="finals">Finals</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Start Date</label>
            <input
              aria-label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => updatePeriod("startDate", e.target.value)}
              onClick={(e) => e.currentTarget.showPicker?.()}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <span className="mb-2 hidden rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600 xl:block">to</span>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">End Date</label>
            <input
              aria-label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => updatePeriod("endDate", e.target.value)}
              onClick={(e) => e.currentTarget.showPicker?.()}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isLoading || isSaving}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0b3478] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#08285e]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="M5 3h12l2 2v16H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></svg>
            {isSaving ? "Saving…" : "Save Schedule"}
          </button>

          <button
            type="button"
            onClick={handleResetSeason}
            disabled={isLoading || isResettingSeason}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-400 bg-white px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 1-2-5"/></svg>
            {isResettingSeason ? "Resetting..." : "Reset Encoding Season"}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm md:p-4">
        <h3 className="text-base font-bold text-slate-900">Current Schedule</h3>

        <div className="mt-3 grid grid-cols-1 overflow-hidden rounded-md border border-blue-100 bg-blue-50/30 sm:grid-cols-2 xl:grid-cols-6">
          <div className="p-3 xl:border-r xl:border-slate-200">
            <p className="text-[10px] text-slate-500">School Year</p>
            <p className="mt-1.5 text-xs font-semibold text-slate-900">{savedPeriod?.schoolYear || "Not set"}</p>
          </div>
          <div className="p-3 xl:border-r xl:border-slate-200">
            <p className="text-[10px] text-slate-500">Semester</p>
            <p className="mt-1.5 text-xs font-semibold text-slate-900">{savedPeriod?.semester || "Not set"}</p>
          </div>

          <div className="p-3 xl:border-r xl:border-slate-200">
            <p className="text-[10px] text-slate-500">Encoding Term</p>
            <p className="mt-1.5 text-xs font-semibold text-slate-900">
              {savedPeriod ? (savedPeriod.term === "midterm" ? "Midterms" : "Finals") : "Not set"}
            </p>
          </div>

          <div className="p-3 xl:border-r xl:border-slate-200">
            <p className="text-[10px] text-slate-500">Start Date</p>
            <p className="mt-1.5 text-xs font-semibold text-slate-900">{formatDate(savedPeriod?.startDate)}</p>
            <p className="mt-1 text-xs text-slate-500">{formatDay(savedPeriod?.startDate)}{savedPeriod?.startDate ? " • 12:00 AM" : ""}</p>
          </div>

          <div className="p-3 xl:border-r xl:border-slate-200">
            <p className="text-[10px] text-slate-500">End Date</p>
            <p className="mt-1.5 text-xs font-semibold text-slate-900">{formatDate(savedPeriod?.endDate)}</p>
            <p className="mt-1 text-xs text-slate-500">{formatDay(savedPeriod?.endDate)}{savedPeriod?.endDate ? " • 11:59 PM" : ""}</p>
          </div>

          <div className="p-3">
            <p className="text-[10px] text-slate-500">Faculty Banner Status</p>
            <div className="mt-1.5"><StatusBadge status={getBannerStatus(savedPeriod || {})} /></div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default EncodingPeriod;
