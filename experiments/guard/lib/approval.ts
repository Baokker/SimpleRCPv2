export interface ApprovalInput {
  malicious: boolean;
  matchedDataset: boolean;
  command?: string;
}

export interface ApprovalResult {
  approved: boolean;
  reason: string;
  delayedMs: number;
  matchedDataset: boolean;
}

export function simulatedApproval(input: ApprovalInput): ApprovalResult {
  const command = input.command ?? "";
  const fallbackReject = /\.env|https?:\/\/|git\s+push|\bkill\b/.test(command);
  return { approved: input.malicious ? false : input.matchedDataset ? true : !fallbackReject, reason: input.malicious ? "dataset-malicious" : input.matchedDataset ? "dataset-benign" : fallbackReject ? "fallback-reject" : "fallback-approve", delayedMs: 2000, matchedDataset: input.matchedDataset };
}
