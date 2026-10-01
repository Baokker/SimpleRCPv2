export function storedMemberId(projectId: string) {
  return window.localStorage.getItem(`simplercp.memberId.${projectId}`) ?? undefined;
}

export function rememberMember(projectId: string, memberId: string) {
  window.localStorage.setItem(`simplercp.memberId.${projectId}`, memberId);
  window.localStorage.setItem("simplercp.activeMemberId", memberId);
}

export function activeMemberId() {
  return window.localStorage.getItem("simplercp.activeMemberId") ?? undefined;
}
