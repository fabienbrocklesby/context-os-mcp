export type TimezoneSource =
  | "input"
  | "project_profile"
  | "env_default"
  | "utc_default";

export type WeekdayName =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export type WeekdayIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type BusinessHours = {
  start: string;
  end: string;
  business_days: WeekdayIndex[];
};

export type TimeContext = {
  now_utc: string;
  timezone: string;
  timezone_source: TimezoneSource;
  local_date: string;
  local_time: string;
  weekday: WeekdayName;
  weekday_index: WeekdayIndex;
  utc_offset_minutes: number;
  is_weekend: boolean;
  is_business_day: boolean;
  is_business_hours: boolean;
  business_hours: BusinessHours;
  holiday_context: {
    status: "not_configured";
    is_public_holiday: null;
    source: null;
    note: string;
  };
};

export type TimeContextInput = {
  timezone?: string;
  projectTimezone?: unknown;
  envDefaultTimezone?: string;
  now?: string;
  businessHours?: {
    start?: string;
    end?: string;
    business_days?: number[];
  };
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: WeekdayName;
};

const WEEKDAY_INDEX: Record<WeekdayName, WeekdayIndex> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  start: "09:00",
  end: "17:00",
  business_days: [1, 2, 3, 4, 5],
};

export function buildTimeContext(input: TimeContextInput = {}): TimeContext {
  const { timezone, source } = resolveTimezone(input);
  assertValidTimezone(timezone);
  const now = input.now ? new Date(input.now) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid ISO date/time: ${input.now}`);
  }
  const businessHours = normalizeBusinessHours(input.businessHours);
  const parts = zonedParts(now, timezone);
  const weekdayIndex = WEEKDAY_INDEX[parts.weekday];
  const isBusinessDay = businessHours.business_days.includes(weekdayIndex);
  const localTime = `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;

  return {
    now_utc: now.toISOString(),
    timezone,
    timezone_source: source,
    local_date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    local_time: localTime,
    weekday: parts.weekday,
    weekday_index: weekdayIndex,
    utc_offset_minutes: utcOffsetMinutes(now, timezone, parts),
    is_weekend: !DEFAULT_BUSINESS_HOURS.business_days.includes(weekdayIndex),
    is_business_day: isBusinessDay,
    is_business_hours: isBusinessDay && isWithinBusinessHours(localTime, businessHours),
    business_hours: businessHours,
    holiday_context: {
      status: "not_configured",
      is_public_holiday: null,
      source: null,
      note: "Public holiday calendars are not configured in Phase 1; do not claim holiday status without a live source.",
    },
  };
}

export function nextBusinessStartLabel(timeContext: TimeContext) {
  const [year, month, day] = timeContext.local_date.split("-").map(Number);
  for (let offset = 0; offset <= 14; offset += 1) {
    const candidate = new Date(Date.UTC(year, month - 1, day + offset));
    const weekday = isoWeekdayFromUtcDate(candidate);
    const isToday = offset === 0;
    if (
      timeContext.business_hours.business_days.includes(weekday) &&
      (!isToday || timeContext.local_time < `${timeContext.business_hours.start}:00`)
    ) {
      return `${candidate.getUTCFullYear()}-${pad(candidate.getUTCMonth() + 1)}-${pad(candidate.getUTCDate())}T${timeContext.business_hours.start}:00[${timeContext.timezone}]`;
    }
  }
  return undefined;
}

function resolveTimezone(input: TimeContextInput): { timezone: string; source: TimezoneSource } {
  if (input.timezone) {
    return { timezone: input.timezone, source: "input" };
  }
  const projectTimezone =
    typeof input.projectTimezone === "string" ? input.projectTimezone.trim() : "";
  if (projectTimezone && isValidTimezone(projectTimezone)) {
    return { timezone: projectTimezone, source: "project_profile" };
  }
  if (input.envDefaultTimezone) {
    return { timezone: input.envDefaultTimezone, source: "env_default" };
  }
  return { timezone: "UTC", source: "utc_default" };
}

function normalizeBusinessHours(input?: TimeContextInput["businessHours"]): BusinessHours {
  const start = input?.start ?? DEFAULT_BUSINESS_HOURS.start;
  const end = input?.end ?? DEFAULT_BUSINESS_HOURS.end;
  if (!isHourMinute(start)) {
    throw new Error(`Invalid business_hours.start: ${start}`);
  }
  if (!isHourMinute(end)) {
    throw new Error(`Invalid business_hours.end: ${end}`);
  }
  const businessDays = input?.business_days ?? DEFAULT_BUSINESS_HOURS.business_days;
  if (
    !businessDays.length ||
    businessDays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
  ) {
    throw new Error("business_hours.business_days must contain ISO weekday numbers 1 through 7.");
  }
  return {
    start,
    end,
    business_days: [...new Set(businessDays)] as WeekdayIndex[],
  };
}

function assertValidTimezone(timezone: string) {
  if (isValidTimezone(timezone)) {
    return;
  }
  throw new Error(`Invalid IANA timezone: ${timezone}`);
}

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    calendar: "iso8601",
    numberingSystem: "latn",
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday as WeekdayName,
  };
}

function utcOffsetMinutes(date: Date, timezone: string, parts: ZonedParts) {
  if (timezone === "UTC") {
    return 0;
  }
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((localAsUtc - date.getTime()) / 60_000);
}

function isWithinBusinessHours(localTime: string, businessHours: BusinessHours) {
  const current = minutesSinceMidnight(localTime);
  const start = minutesSinceMidnight(businessHours.start);
  const end = minutesSinceMidnight(businessHours.end);
  if (start <= end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}

function minutesSinceMidnight(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function isHourMinute(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isoWeekdayFromUtcDate(date: Date): WeekdayIndex {
  const day = date.getUTCDay();
  return (day === 0 ? 7 : day) as WeekdayIndex;
}

function pad(value: number) {
  return value.toString().padStart(2, "0");
}
