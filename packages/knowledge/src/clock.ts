export interface Clock {
    now(): number;
}

export const systemClock: Clock = {
    now: () => new Date().getTime()
};

export function resolveNow(now?: (() => number) | number): number {
    if (typeof now === 'function') return now();
    if (typeof now === 'number') return now;
    return systemClock.now();
}
