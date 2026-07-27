import { describe, expect, it } from "vitest";
import { formatEstimatedRemainingTime } from "./separation";

describe("formatEstimatedRemainingTime", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatEstimatedRemainingTime(null)).toBe("残り時間を計算中");
    expect(formatEstimatedRemainingTime(18.5)).toBe("残り約19秒");
    expect(formatEstimatedRemainingTime(75)).toBe("残り約2分");
    expect(formatEstimatedRemainingTime(3_660)).toBe("残り約1時間1分");
    expect(formatEstimatedRemainingTime(0)).toBe("まもなく完了");
  });
});
