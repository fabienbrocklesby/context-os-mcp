import { describe, expect, it } from "vitest";

import { buildTimeContext } from "~/domain/time-context";

describe("buildTimeContext", () => {
  it("validates Saturday in Pacific/Auckland from the real timezone-local date", () => {
    const context = buildTimeContext({
      timezone: "Pacific/Auckland",
      now: "2026-05-01T22:30:00.000Z",
    });

    expect(context).toMatchObject({
      now_utc: "2026-05-01T22:30:00.000Z",
      timezone: "Pacific/Auckland",
      timezone_source: "input",
      local_date: "2026-05-02",
      weekday: "Saturday",
      weekday_index: 6,
      is_weekend: true,
      is_business_day: false,
      is_business_hours: false,
    });
  });

  it("recognizes Monday business hours", () => {
    const context = buildTimeContext({
      timezone: "Pacific/Auckland",
      now: "2026-05-03T22:30:00.000Z",
    });

    expect(context.local_date).toBe("2026-05-04");
    expect(context.weekday).toBe("Monday");
    expect(context.is_business_day).toBe(true);
    expect(context.is_business_hours).toBe(true);
  });

  it("handles UTC date boundaries without model assumptions", () => {
    const context = buildTimeContext({
      timezone: "UTC",
      now: "2026-05-02T00:05:00.000Z",
    });

    expect(context.local_date).toBe("2026-05-02");
    expect(context.local_time).toBe("00:05:00");
    expect(context.utc_offset_minutes).toBe(0);
  });

  it("rejects invalid timezones explicitly", () => {
    expect(() =>
      buildTimeContext({
        timezone: "Not/AZone",
        now: "2026-05-02T00:00:00.000Z",
      }),
    ).toThrow("Invalid IANA timezone");
  });

  it("skips invalid project profile timezones and falls back to env default", () => {
    const context = buildTimeContext({
      projectTimezone: "Not/AZone",
      envDefaultTimezone: "UTC",
      now: "2026-05-02T00:00:00.000Z",
    });

    expect(context.timezone).toBe("UTC");
    expect(context.timezone_source).toBe("env_default");
  });
});
