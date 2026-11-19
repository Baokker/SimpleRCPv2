// An Agent run lists every file that changed while it ran. Files that a person or another Agent also
// changed in that window are marked "ambiguous" by the server and are shown apart from the Agent's own.
export function splitAgentChanges<T extends { attribution?: string }>(changes: T[] | undefined) {
  const all = changes ?? [];
  return {
    own: all.filter((change) => change.attribution !== "ambiguous"),
    others: all.filter((change) => change.attribution === "ambiguous")
  };
}

export const OTHERS_CHANGED_NOTE = "这段时间他人也改过以下文件，不一定是这个 Agent 改的";
