import { describe, expect, it } from "vitest";
import { whereIsGcId, type GcIdStores } from "../gcIdWhereabouts";

/** Where a pasted GameChanger id is when no club in Find a team carries it. Invented names. */
const stores = (extra: Partial<GcIdStores> = {}): GcIdStores => ({
  ageless: [{ teamId: "gcWAIT000001", name: "Example Hurricanes" }],
  dropped: new Set(["gcGONE000001"]),
  tooYoung: new Set(["gcTINY000001"]),
  ...extra,
});

describe("where a GameChanger id is", () => {
  it("says a team waiting on an age is on no page yet, by its name", () => {
    expect(whereIsGcId("gcWAIT000001", stores())).toMatch(
      /^Example Hurricanes is waiting on an age: .* Teams waiting on an age in Setup\.$/
    );
  });

  it("says a thrown-out team is refused, ahead of anything else known of it", () => {
    const both = stores({ dropped: new Set(["gcWAIT000001"]) });
    expect(whereIsGcId("gcWAIT000001", both)).toMatch(/^That team was thrown out/);
  });

  it("says a team GameChanger ages below the youngest level is skipped", () => {
    expect(whereIsGcId("gcTINY000001", stores())).toBe(
      "GameChanger says that team is younger than 8U, so pulls skip it."
    );
  });

  it("says a club filed during a running pull is added when it ends", () => {
    const live = stores({
      liveTeams: [
        {
          id: "S-NEW",
          name: "Example Cyclones",
          gcTeams: [{ teamId: "gcNEWS000001", name: "Example Cyclones", ageGroupId: "ag" }],
        },
      ],
    });
    expect(whereIsGcId("gcNEWS000001", live)).toBe(
      "Example Cyclones was filed during the pull that is running. Find a team adds it when the pull ends."
    );
  });

  it("knows nothing of an id it has no record of", () => {
    expect(whereIsGcId("gcNONE000001", stores())).toBeUndefined();
  });
});
