import { describe, it, expect, beforeEach } from "vitest";
import {
  generateNotifications,
  generateDriftNotifications,
  getReadIds,
  markAsRead,
} from "../notifications";

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

describe("generateNotifications — pending harvest", () => {
  it("fires for accepted recommendation aged 30+ days with no yield reported", () => {
    const recs = [
      { id: "rec1", crop: "rice", status: "accepted", accepted_at: daysAgo(35), actual_yield: null },
    ];
    const pending = generateNotifications(recs).filter((n) => n.type === "pending_harvest");
    expect(pending).toHaveLength(1);
    expect(pending[0].title).toContain("Rice");
    expect(pending[0].link).toBe("/history");
  });

  it("does not fire for pending status", () => {
    const recs = [
      { id: "r2", crop: "rice", status: "pending", created_at: daysAgo(60), actual_yield: null },
    ];
    expect(generateNotifications(recs).filter((n) => n.type === "pending_harvest")).toHaveLength(0);
  });

  it("does not fire when actual_yield is already reported", () => {
    const recs = [
      { id: "r3", crop: "wheat", status: "accepted", accepted_at: daysAgo(45), actual_yield: 3200 },
    ];
    expect(generateNotifications(recs).filter((n) => n.type === "pending_harvest")).toHaveLength(0);
  });

  describe("30-day boundary (BVA)", () => {
    it("29 days → no notification", () => {
      const recs = [{ id: "a", crop: "rice", status: "accepted", accepted_at: daysAgo(29), actual_yield: null }];
      expect(generateNotifications(recs).filter((n) => n.type === "pending_harvest")).toHaveLength(0);
    });

    it("31 days → notification generated", () => {
      const recs = [{ id: "c", crop: "rice", status: "accepted", accepted_at: daysAgo(31), actual_yield: null }];
      expect(generateNotifications(recs).filter((n) => n.type === "pending_harvest")).toHaveLength(1);
    });
  });

  it("caps at 3 notifications", () => {
    const recs = Array.from({ length: 7 }, (_, i) => ({
      id: `rec${i}`,
      crop: "rice",
      status: "accepted",
      accepted_at: daysAgo(40 + i),
      actual_yield: null,
    }));
    expect(generateNotifications(recs).filter((n) => n.type === "pending_harvest")).toHaveLength(3);
  });
});

describe("generateNotifications — planting window", () => {
  it("links to crop-prefilled dashboard for known crops", () => {
    const recs = [{ id: "r1", crop: "rice", status: "pending", created_at: daysAgo(5), actual_yield: null }];
    const planting = generateNotifications(recs).filter((n) => n.type === "planting_window");
    planting.forEach((n) => {
      expect(n.link).toContain("crop=rice");
    });
  });

  it("ignores unknown crops", () => {
    const recs = [{ id: "r1", crop: "unknown_crop", status: "pending", created_at: daysAgo(1), actual_yield: null }];
    expect(generateNotifications(recs).filter((n) => n.type === "planting_window")).toHaveLength(0);
  });

  it("handles empty recommendations", () => {
    expect(generateNotifications([])).toEqual([]);
  });
});

describe("generateDriftNotifications", () => {
  it("fires only for crops with drift_detected=true", () => {
    const data = {
      cusum: {
        rice:  { drift_detected: true,  drift_direction: "underestimating", n_errors: 12 },
        wheat: { drift_detected: false, drift_direction: null,              n_errors: 8 },
        maize: { drift_detected: true,  drift_direction: "overestimating",  n_errors: 5 },
      },
    };
    const notifs = generateDriftNotifications(data);
    expect(notifs).toHaveLength(2);
    expect(notifs.map((n) => n.id).sort()).toEqual(["drift_maize", "drift_rice"]);
  });

  it("reflects direction in body text", () => {
    const data = { cusum: { rice: { drift_detected: true, drift_direction: "underestimating", n_errors: 10 } } };
    expect(generateDriftNotifications(data)[0].body).toContain("underestimating");
  });

  it("handles singular and plural n_errors", () => {
    const one = generateDriftNotifications({
      cusum: { rice: { drift_detected: true, drift_direction: "overestimating", n_errors: 1 } },
    });
    expect(one[0].body).toMatch(/1 harvest report /);

    const many = generateDriftNotifications({
      cusum: { wheat: { drift_detected: true, drift_direction: "overestimating", n_errors: 12 } },
    });
    expect(many[0].body).toMatch(/12 harvest reports/);
  });

  it("handles missing cusum field", () => {
    expect(generateDriftNotifications({})).toEqual([]);
    expect(generateDriftNotifications(null)).toEqual([]);
    expect(generateDriftNotifications(undefined)).toEqual([]);
  });
});

describe("getReadIds / markAsRead", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns empty Set when storage empty", () => {
    expect(getReadIds("user-1")).toEqual(new Set());
  });

  it("persists ids across calls", () => {
    markAsRead("user-1", ["notif_a", "notif_b"]);
    const ids = getReadIds("user-1");
    expect(ids.has("notif_a")).toBe(true);
    expect(ids.has("notif_b")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("scopes storage per user", () => {
    markAsRead("user-1", ["notif_a"]);
    markAsRead("user-2", ["notif_z"]);
    expect(getReadIds("user-1").has("notif_z")).toBe(false);
    expect(getReadIds("user-2").has("notif_a")).toBe(false);
  });

  it("deduplicates on repeated writes", () => {
    markAsRead("user-1", ["n1"]);
    markAsRead("user-1", ["n1", "n2"]);
    expect(getReadIds("user-1").size).toBe(2);
  });

  it("recovers from corrupt JSON in storage", () => {
    localStorage.setItem("cropAdvisor_notif_read_user-x", "{not-valid-json");
    expect(getReadIds("user-x")).toEqual(new Set());
  });
});
