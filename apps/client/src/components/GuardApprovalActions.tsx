import type { GuardApproval } from "../types";

export function GuardApprovalActions({ approval, memberId, disabled, onReply, onWithdraw }: {
  approval: GuardApproval;
  memberId?: string;
  disabled: boolean;
  onReply(approve: boolean): void;
  onWithdraw(): void;
}) {
  if (approval.decision.llm?.applied) {
    return <small className="guard-llm-resolved">模型已自动处理</small>;
  }
  const ownRequest = approval.request.memberId === memberId;
  // An owner may answer an owners-level request raised by their own Agent; the server already accepts it.
  const canConfirmOwn = approval.decision.approvers === "self" || approval.decision.approvers === "initiator" || (memberId !== undefined && approval.approverIds.includes(memberId));
  if (ownRequest && canConfirmOwn) {
    return <div>
      <button type="button" disabled={disabled} onClick={() => onReply(true)}>仍然执行</button>
      <button type="button" disabled={disabled} onClick={() => onReply(false)}>取消</button>
    </div>;
  }
  if (ownRequest) {
    return <button type="button" disabled={disabled} onClick={onWithdraw}>撤回请求</button>;
  }
  return <div>
    <button type="button" disabled={disabled} onClick={() => onReply(true)}>批准</button>
    <button type="button" disabled={disabled} onClick={() => onReply(false)}>拒绝</button>
  </div>;
}
