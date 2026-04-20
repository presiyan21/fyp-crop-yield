import { describe, it, expect } from "vitest";
import {
  getFeatureLabel,
  getFeatureMeta,
  isUserControllable,
  getConfidenceTier,
} from "../featureLabels";

describe("getFeatureLabel", () => {
  it("returns label for a known simple key", () => {
    expect(getFeatureLabel("YIELD_LAG_1")).toBe("Previous year's yield");
  });

  it("returns label for a key with spaces and parentheses", () => {
    expect(getFeatureLabel("ANNUAL RAINFALL (Millimeters)")).toBe("Annual rainfall");
  });

  it("matches STATE_PRICE substring for any crop prefix", () => {
    expect(getFeatureLabel("RICE STATE_PRICE (Rupees/Quintal)")).toBe("State market price");
    expect(getFeatureLabel("WHEAT STATE_PRICE (Rupees/Quintal)")).toBe("State market price");
  });

  it("matches IRRIGATED AREA substring for any crop prefix", () => {
    expect(getFeatureLabel("WHEAT IRRIGATED AREA (1000 ha)")).toBe("Crop irrigated area");
    expect(getFeatureLabel("COTTON IRRIGATED AREA (1000 ha)")).toBe("Crop irrigated area");
  });

  it("replaces underscores with spaces for unknown keys", () => {
    expect(getFeatureLabel("some_unknown_key")).toBe("Some Unknown Key");
  });

  it("strips parenthesised content in fallback", () => {
    expect(getFeatureLabel("weird_field (extra info)")).toBe("Weird Field");
  });

  it("capitalises single-word unknown keys", () => {
    expect(getFeatureLabel("foo")).toBe("Foo");
  });
});

describe("getFeatureMeta", () => {
  it("returns full metadata for a known key", () => {
    expect(getFeatureMeta("IRRIGATION_RATIO")).toEqual({
      label: "Irrigation coverage",
      unit: "ratio",
      category: "Water & Irrigation",
      userField: true,
    });
  });

  it("tags STATE_PRICE as Economic", () => {
    const meta = getFeatureMeta("RICE STATE_PRICE (Rupees/Quintal)");
    expect(meta.category).toBe("Economic");
    expect(meta.userField).toBe(false);
  });

  it("tags IRRIGATED AREA as Water & Irrigation", () => {
    expect(getFeatureMeta("COTTON IRRIGATED AREA (1000 ha)").category).toBe("Water & Irrigation");
  });

  it("falls back to Other for unknown keys", () => {
    const meta = getFeatureMeta("COMPLETELY_UNKNOWN");
    expect(meta.category).toBe("Other");
    expect(meta.userField).toBe(false);
    expect(meta.unit).toBe("");
  });
});

describe("isUserControllable", () => {
  it.each([
    "YIELD_LAG_1",
    "IRRIGATION_RATIO",
    "NPK_TOTAL_KG_PER_HA",
    "ANNUAL RAINFALL (Millimeters)",
    "KHARIF_TMAX",
    "RABI_TMIN",
  ])("returns true for user field %s", (key) => {
    expect(isUserControllable(key)).toBe(true);
  });

  it.each(["YIELD_LAG_3", "N_SHARE", "SOIL_LOAMY", "DOES_NOT_EXIST"])(
    "returns false for non-user field %s",
    (key) => {
      expect(isUserControllable(key)).toBe(false);
    }
  );
});

describe("getConfidenceTier — Boundary Value Analysis", () => {
  it("r² = 0.75 exactly → high", () => {
    expect(getConfidenceTier(0.75).tier).toBe("high");
  });

  it("r² = 0.7499 → moderate", () => {
    expect(getConfidenceTier(0.7499).tier).toBe("moderate");
  });

  it("r² = 0.7501 → high", () => {
    expect(getConfidenceTier(0.7501).tier).toBe("high");
  });

  it("r² = 0.55 exactly → moderate", () => {
    expect(getConfidenceTier(0.55).tier).toBe("moderate");
  });

  it("r² = 0.5499 → low", () => {
    expect(getConfidenceTier(0.5499).tier).toBe("low");
  });

  it("r² = 0.5501 → moderate", () => {
    expect(getConfidenceTier(0.5501).tier).toBe("moderate");
  });

  it("r² = 0 → low", () => {
    expect(getConfidenceTier(0).tier).toBe("low");
  });

  it("r² = 1 → high", () => {
    expect(getConfidenceTier(1).tier).toBe("high");
  });

  it("negative r² → low", () => {
    expect(getConfidenceTier(-0.5).tier).toBe("low");
  });

  it("returns tier, label, description, colour for any r²", () => {
    for (const r2 of [0.1, 0.6, 0.9]) {
      const t = getConfidenceTier(r2);
      expect(t).toHaveProperty("tier");
      expect(t).toHaveProperty("label");
      expect(t).toHaveProperty("description");
      expect(t).toHaveProperty("colour");
    }
  });

  it("maps colours by tier", () => {
    expect(getConfidenceTier(0.9).colour).toBe("emerald");
    expect(getConfidenceTier(0.6).colour).toBe("amber");
    expect(getConfidenceTier(0.1).colour).toBe("red");
  });
});
