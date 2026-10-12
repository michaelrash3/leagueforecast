import { describe, expect, it } from "vitest";
import {
  buildNotificationDigest,
  coerceNotificationPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationEvent,
} from "../notifications";

const event = (id: string, kind: NotificationEvent["kind"] = "final-score"): NotificationEvent => ({
  id,
  kind,
  occurredAt: "2026-09-30T12:00:00.000Z",
  title: "Aces won",
  detail: "Aces 4, Bears 2",
});

describe("notification digests", () => {
  it("does nothing until the user explicitly opts in", () => {
    expect(
      buildNotificationDigest([event("1")], DEFAULT_NOTIFICATION_PREFERENCES, new Set())
    ).toBeNull();
  });

  it("deduplicates retried events and batches a refresh into one digest", () => {
    const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: true };
    const digest = buildNotificationDigest(
      [event("1"), event("1"), event("2"), event("3", "schedule-change")],
      preferences,
      new Set(["2"])
    );
    expect(digest).toEqual({
      id: "1|3",
      title: "2 league updates",
      body: "1 final score, 1 schedule change",
      eventIds: ["1", "3"],
    });
  });

  it("applies the configured forecast threshold", () => {
    const preferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enabled: true,
      forecastChanges: true,
      forecastThreshold: 10,
    };
    expect(
      buildNotificationDigest(
        [{ ...event("small", "forecast-change"), changePercent: 9.9 }],
        preferences,
        new Set()
      )
    ).toBeNull();
    expect(
      buildNotificationDigest(
        [{ ...event("large", "forecast-change"), changePercent: -12 }],
        preferences,
        new Set()
      )?.eventIds
    ).toEqual(["large"]);
  });

  it("migrates malformed preferences to safe opt-out defaults", () => {
    expect(coerceNotificationPreferences({ version: 99, enabled: true })).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES
    );
  });
});
