export const defaultRoutingConfig = Object.freeze({ version: "routing-ui-1", bodyUnrelatedMaxAdjacentLines: 3 });

export function validateBodyUnrelatedMaxAdjacentLines(value: number) {
  if (!Number.isInteger(value) || value < 0) throw new Error("CONFLICT_GUARD_BODY_ADJACENT_LINES 必须为非负整数");
  return value;
}
