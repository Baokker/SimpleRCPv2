let unhandledRejectionCount = 0;
let uncaughtExceptionCount = 0;

export function registerProcessFaultHandlers() {
  process.on("unhandledRejection", handleUnhandledRejection);
  process.on("uncaughtException", handleUncaughtException);
}

export function handleUnhandledRejection(reason: unknown) {
  unhandledRejectionCount += 1;
  console.error("Unhandled promise rejection", reason);
}

export function handleUncaughtException(error: unknown) {
  uncaughtExceptionCount += 1;
  console.error("Uncaught exception", error);
}

export function processFaultCounts() {
  return { unhandledRejectionCount, uncaughtExceptionCount };
}
