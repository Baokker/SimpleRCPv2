export function storedMemberId(projectId: string) {
  return sessionMemberId(projectId)
    ?? window.localStorage.getItem(`simplercp.memberId.${projectId}`)
    ?? undefined;
}

export function sessionMemberId(projectId: string) {
  return window.sessionStorage.getItem(`simplercp.memberId.${projectId}`) ?? undefined;
}

export function rememberMember(projectId: string, memberId: string) {
  window.sessionStorage.setItem(`simplercp.memberId.${projectId}`, memberId);
  window.localStorage.setItem(`simplercp.memberId.${projectId}`, memberId);
  window.sessionStorage.setItem("simplercp.activeMemberId", memberId);
  window.localStorage.setItem("simplercp.activeMemberId", memberId);
}

export function activeMemberId() {
  return window.sessionStorage.getItem("simplercp.activeMemberId")
    ?? window.localStorage.getItem("simplercp.activeMemberId")
    ?? undefined;
}
