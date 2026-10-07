export interface SessionState {
  name: string;
}

export function sharedHelper(state: SessionState, name?: string): SessionState {
  if (name !== undefined) state.name = name;
  return state;
}

export function setup(state: SessionState): SessionState {
  return sharedHelper(state);
}

export function renameSession(state: SessionState, name: string): SessionState {
  return sharedHelper(state, name);
}
