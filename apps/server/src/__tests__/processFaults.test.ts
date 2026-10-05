import { describe, expect, it } from "vitest";
import { handleUncaughtException, handleUnhandledRejection, processFaultCounts, registerProcessFaultHandlers } from "../processFaults.js";

describe("process fault handlers", () => {
  it("records process-level faults without terminating the process", () => {
    const before = processFaultCounts();
    registerProcessFaultHandlers();
    handleUnhandledRejection(new Error("test rejection"));
    handleUncaughtException(new Error("test exception"));
    expect(processFaultCounts()).toEqual({
      unhandledRejectionCount: before.unhandledRejectionCount + 1,
      uncaughtExceptionCount: before.uncaughtExceptionCount + 1
    });
  });
});
