export const DAY_OPTIONS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const CLOCK_PATTERN = /^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i;

const toMinutes = (value) => {
  const match = String(value || "").trim().match(CLOCK_PATTERN);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = (match[3] || "").toUpperCase();
  if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (meridiem) hour = (hour % 12) + (meridiem === "PM" ? 12 : 0);
  return hour * 60 + minute;
};

const toInputTime = (value) => {
  const minutes = toMinutes(value);
  if (minutes === null) return "";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};

const formatTime = (value) => {
  const minutes = toMinutes(value);
  if (minutes === null) return String(value || "").trim();
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
};

const dayAliases = {
  mon: 'Monday', monday: 'Monday', tue: 'Tuesday', tues: 'Tuesday', tuesday: 'Tuesday',
  wed: 'Wednesday', wednesday: 'Wednesday', thu: 'Thursday', thur: 'Thursday', thurs: 'Thursday', thursday: 'Thursday',
  fri: 'Friday', friday: 'Friday', sat: 'Saturday', saturday: 'Saturday', sun: 'Sunday', sunday: 'Sunday',
};

export const parseFacultyScheduleBlocks = (value) => String(value || '').trim().split(/\s*(?:;|\r?\n)\s*/)
  .filter(Boolean).flatMap((block) => {
    const match = block.match(/^([^|]+)\|\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s*[-–—]\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)$/i);
    if (!match) return [];
    const start = toMinutes(match[2]);
    const end = toMinutes(match[3]);
    if (start === null || end === null || start >= end) return [];
    return match[1].split(/\s*(?:\/|,|&|\band\b)\s*/i).map((day) => dayAliases[day.trim().toLowerCase()])
      .filter(Boolean).map((day) => ({ day, start, end }));
  });

export const facultySchedulesOverlap = (left, right) => {
  const first = parseFacultyScheduleBlocks(left);
  const second = parseFacultyScheduleBlocks(right);
  return first.some((a) => second.some((b) => a.day === b.day && a.start < b.end && b.start < a.end));
};

export const isValidScheduleRange = (startTime, endTime) => {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  return start !== null && end !== null && start < end;
};

export const buildFacultySchedule = (day, startTime, endTime) => {
  const normalizedDay = String(day || "").trim();
  if (!normalizedDay && !startTime && !endTime) return "";
  if (!normalizedDay || !isValidScheduleRange(startTime, endTime)) return "";
  return `${normalizedDay} | ${toInputTime(startTime)}-${toInputTime(endTime)}`;
};

export const parseFacultySchedule = (value, fallbackDay = "") => {
  const raw = String(value || "").trim();
  const parts = raw.split("|").map((part) => part.trim()).filter(Boolean);
  const day = String(fallbackDay || (parts.length > 1 ? parts[0] : "")).trim();
  const timeText = parts.length > 1 ? parts.slice(1).join(" | ") : (day ? raw : "");
  const timeMatch = timeText.match(/(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s*[-–—]\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i);

  return {
    day: day || (DAY_OPTIONS.includes(raw) ? raw : ""),
    startTime: timeMatch ? toInputTime(timeMatch[1]) : "",
    endTime: timeMatch ? toInputTime(timeMatch[2]) : "",
  };
};

export const formatFacultySchedule = (value, fallbackDay = "") => {
  const raw = String(value || "").trim();
  const parsed = parseFacultySchedule(raw, fallbackDay);
  const day = parsed.day || String(fallbackDay || "").trim();
  if (parsed.startTime && parsed.endTime) {
    return `${day ? `${day} • ` : ""}${formatTime(parsed.startTime)}–${formatTime(parsed.endTime)}`;
  }
  if (day && raw && raw !== day && !raw.includes("|")) return `${day} • ${raw}`;
  return raw || day || "Schedule not available";
};

export const serializeAssignmentSchedule = (assignment = {}) => {
  if (assignment.startTime || assignment.endTime) {
    return buildFacultySchedule(assignment.day, assignment.startTime, assignment.endTime);
  }
  const day = String(assignment.day || "").trim();
  const schedule = String(assignment.schedule || "").trim();
  if (!day || !schedule || schedule.startsWith(`${day} |`) || schedule === day) return schedule || day;
  return `${day} | ${schedule}`;
};
