import type { GuardApproval } from "../types";
import { englishLocale } from "../guardText";

export function GuardApprovalActions({ approval, memberId, disabled, onReply, onWithdraw }: {
  approval: GuardApproval;
  memberId?: string;
  disabled: boolean;
  onReply(approve: boolean): void;
  onWithdraw(): void;
}) {
  if (approval.decision.llm?.applied) {
    return <small className="guard-llm-resolved">{englishLocale ? "Handled automatically by model" : "模型已自动处理"}</small>;
  }
  const ownRequest = approval.request.memberId === memberId;
  const canConfirmOwn = memberId !== undefined && approval.approverIds.includes(memberId);
  if (ownRequest && canConfirmOwn) {
    return <div>
      <button type="button" disabled={disabled} onClick={() => onReply(true)}>{englishLocale ? "Proceed" : "仍然执行"}</button>
      <button type="button" disabled={disabled} onClick={() => onReply(false)}>{englishLocale ? "Cancel" : "取消"}</button>
    </div>;
  }
  if (ownRequest) {
    return <button type="button" disabled={disabled} onClick={onWithdraw}>{englishLocale ? "Withdraw request" : "撤回请求"}</button>;
  }
  return <div>
    <button type="button" disabled={disabled} onClick={() => onReply(true)}>{englishLocale ? "Approve" : "批准"}</button>
    <button type="button" disabled={disabled} onClick={() => onReply(false)}>{englishLocale ? "Reject" : "拒绝"}</button>
  </div>;
}
