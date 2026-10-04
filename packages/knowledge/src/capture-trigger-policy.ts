// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type { CaptureTriggerType } from './schema.js';

export const CAPTURE_TRIGGER_TYPES = [
    'chat.dense',
    'todo.cleared',
    'magicNumber.added',
    'packageJson.dependencySwitch',
    'diagnostics.fixed',
    'rollback.detected'
] as const satisfies readonly CaptureTriggerType[];

export interface CaptureTriggerSignal {
    triggerType: CaptureTriggerType;
    messageCount?: number;
    windowMs?: number;
    beforeTodos?: number;
    afterTodos?: number;
    addedMagicNumbers?: number;
    dependencyChanges?: number;
    dependencyAgeMs?: number;
    previousErrors?: number;
    currentErrors?: number;
    errorAgeMs?: number;
    editChars?: number;
    lastEditAgeMs?: number;
    netDeletedChars?: number;
    deletedLines?: number;
    restoredOriginalHash?: boolean;
    intermediateHashChanged?: boolean;
    rollbackAgeMs?: number;
}

export function shouldTriggerCapture(signal: CaptureTriggerSignal): boolean {
    switch (signal.triggerType) {
        case 'chat.dense':
            return (signal.messageCount ?? 0) >= 11 && (signal.windowMs ?? Infinity) <= 5 * 60_000;
        case 'todo.cleared':
            return (signal.beforeTodos ?? 0) > 0 && (signal.afterTodos ?? 0) === 0;
        case 'magicNumber.added':
            return (signal.addedMagicNumbers ?? 0) > 0;
        case 'packageJson.dependencySwitch':
            return (signal.dependencyChanges ?? 0) > 0 && (signal.dependencyAgeMs ?? Infinity) <= 10 * 60_000;
        case 'diagnostics.fixed':
            return (signal.previousErrors ?? 0) > 0
                && (signal.currentErrors ?? 0) === 0
                && (signal.errorAgeMs ?? 0) >= 60_000
                && (signal.editChars ?? 0) > 0
                && (signal.lastEditAgeMs ?? Infinity) <= 5 * 60_000;
        case 'rollback.detected':
            return ((signal.netDeletedChars ?? 0) > 500 || (signal.deletedLines ?? 0) > 20)
                && signal.restoredOriginalHash === true
                && signal.intermediateHashChanged === true
                && (signal.rollbackAgeMs ?? Infinity) <= 5 * 60_000;
    }
}
