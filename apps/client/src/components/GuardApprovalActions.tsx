import type { GuardApproval } from "../types";

export function GuardApprovalActions({ approval, memberId, disabled, onReply, onWithdraw }: {
  approval: GuardApproval;
  memberId?: string;
  disabled: boolean;
  onReply(approve: boolean): void;
  onWithdraw(): void;
}) {
  if (approval.decision.llm?.applied) {
    return <small className="guard-llm-resolved">Resolved automatically by the model</small>;
  }
  const ownRequest = approval.request.memberId === memberId;
  if (ownRequest && (approval.decision.approvers === "self" || approval.decision.approvers === "initiator")) {
    return <div>
      <button type="button" disabled={disabled} onClick={() => onReply(true)}>Run anyway</button>
      <button type="button" disabled={disabled} onClick={() => onReply(false)}>Cancel</button>
    </div>;
  }
  if (ownRequest) {
    return <button type="button" disabled={disabled} onClick={onWithdraw}>Withdraw request</button>;
  }
  return <div>
    <button type="button" disabled={disabled} onClick={() => onReply(true)}>Approve</button>
    <button type="button" disabled={disabled} onClick={() => onReply(false)}>Reject</button>
  </div>;
}
