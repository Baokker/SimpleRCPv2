import { readLocalStorage, writeLocalStorage } from "./localStorage";

export function storedMemberId(projectId: string) {
  return sessionMemberId(projectId)
    ?? readLocalStorage(`simplercp.memberId.${projectId}`)
    ?? undefined;
}

export function sessionMemberId(projectId: string) {
  return window.sessionStorage.getItem(`simplercp.memberId.${projectId}`) ?? undefined;
}

export function rememberMember(projectId: string, memberId: string) {
  window.sessionStorage.setItem(`simplercp.memberId.${projectId}`, memberId);
  writeLocalStorage(`simplercp.memberId.${projectId}`, memberId);
  window.sessionStorage.setItem("simplercp.activeMemberId", memberId);
  writeLocalStorage("simplercp.activeMemberId", memberId);
}

export function activeMemberId() {
  return window.sessionStorage.getItem("simplercp.activeMemberId")
    ?? readLocalStorage("simplercp.activeMemberId")
    ?? undefined;
}
