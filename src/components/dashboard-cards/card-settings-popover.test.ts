import { describe, expect, it } from "vitest";
import { panelVerticalPlacement } from "./card-settings-popover";

describe("card settings panel placement", () => {
  it("opens below a trigger with room under it", () => {
    expect(panelVerticalPlacement({ top: 100, bottom: 130 }, 900)).toEqual({ top: 138, maxHeight: 754 });
  });

  it("opens above a trigger near the bottom of the screen", () => {
    expect(panelVerticalPlacement({ top: 820, bottom: 850 }, 900)).toEqual({ bottom: 88, maxHeight: 804 });
  });
});
