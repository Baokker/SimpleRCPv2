import { describe, expect, it } from "vitest";
import { createTimelineStore } from "../timeline.js";

describe("timeline store", () => {
  it("records readable timeline items", () => {
    const timeline = createTimelineStore();
    const item = timeline.append({
      roomId: "room-1",
      actorName: "bob",
      actorKind: "human",
      type: "chat",
      label: "bob asked MockAgent for help",
      status: "completed"
    });

    expect(timeline.list("room-1")).toEqual([item]);
  });
});
