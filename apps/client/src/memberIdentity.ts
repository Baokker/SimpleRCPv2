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

type ConnectionIdSource = Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string };

// crypto.randomUUID exists only in secure contexts, so plain-HTTP study links need the getRandomValues fallback.
export function createConnectionId(source: ConnectionIdSource = window.crypto) {
  if (typeof source.randomUUID === "function") return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
