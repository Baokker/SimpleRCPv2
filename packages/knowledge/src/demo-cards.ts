// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import { LatestSchemaVersion, normalizeWorkspaceRelativePath } from './schema.js';
import type { KnowledgeCard, KnowledgeCardType } from './schema.js';
import { resolveNow } from './clock.js';

export interface CreateDemoKnowledgeCardsArgs {
    workspaceFolderName?: string;
    workspaceRelativePath: string;
    selectedText: string;
    now?: number | (() => number);
}

interface DemoTemplate {
    suffix: string;
    type: KnowledgeCardType;
    title: string;
    summary: string;
    content: string;
    tags: string[];
    createdOffsetMinutes: number;
    updatedOffsetMinutes?: number;
    reviewedOffsetMinutes?: number;
    updateNote?: string;
}

const demoTemplates: DemoTemplate[] = [
    {
        suffix: 'decision',
        type: 'decision',
        title: 'Use an explicit timeout around this code path',
        summary: 'This region keeps an explicit timeout because earlier collaborative debugging found timing-sensitive behavior.',
        content: 'The team chose to keep an explicit timeout here after comparing a cleaner immediate path with a guarded delayed path. The delay should be revisited only after the underlying timing dependency is removed.',
        tags: ['demo', 'decision', 'timing'],
        createdOffsetMinutes: 55,
        updatedOffsetMinutes: 82,
        reviewedOffsetMinutes: 86,
        updateNote: 'Expanded after reviewing the timeout guard discussion.'
    },
    {
        suffix: 'constraint',
        type: 'constraint',
        title: 'Preserve compatibility with the current collaboration protocol',
        summary: 'Changes around this region should avoid requiring a new mandatory protocol namespace.',
        content: 'The current prototype stores process knowledge as workspace JSON files so older collaboration sessions can continue to run. Prefer additive metadata and narrow optional requests when extending this code.',
        tags: ['demo', 'constraint', 'compatibility'],
        createdOffsetMinutes: 72,
        updatedOffsetMinutes: 96,
        reviewedOffsetMinutes: 101,
        updateNote: 'Linked the constraint to the current workspace JSON persistence strategy.'
    },
    {
        suffix: 'risk',
        type: 'risk',
        title: 'Risk: removing this guard can reintroduce intermittent failures',
        summary: 'This code is connected to a previously observed intermittent failure mode.',
        content: 'Before deleting or simplifying this guard, reproduce the original failure scenario and check whether the timing dependency has been eliminated. Treat quick cleanup changes here as risky.',
        tags: ['demo', 'risk', 'regression'],
        createdOffsetMinutes: 118,
        updatedOffsetMinutes: 143,
        reviewedOffsetMinutes: 148,
        updateNote: 'Added regression context after comparing the rejected eager synchronization alternative.'
    },
    {
        suffix: 'negative',
        type: 'negative',
        title: 'Rejected alternative: eager synchronization',
        summary: 'The team tried an eager synchronization approach and rejected it because it produced noisy updates.',
        content: 'A previous experiment pushed every intermediate update through the collaboration channel. It made the UI feel busier without improving correctness, so the current design batches knowledge updates around explicit save events.',
        tags: ['demo', 'negative', 'alternative'],
        createdOffsetMinutes: 104,
        updatedOffsetMinutes: 132,
        reviewedOffsetMinutes: 136,
        updateNote: 'Recorded why the eager synchronization experiment was rejected.'
    },
    {
        suffix: 'tutorial',
        type: 'tutorial',
        title: 'Newcomer reading note for this file',
        summary: 'Start by reading the surrounding function, then inspect cards tagged decision and risk.',
        content: 'For onboarding, read the enclosing function first, then follow the decision card to understand the intended behavior and the risk card to understand what should not be simplified casually.',
        tags: ['demo', 'tutorial', 'onboarding'],
        createdOffsetMinutes: 14,
        updatedOffsetMinutes: 39,
        reviewedOffsetMinutes: 44,
        updateNote: 'Refined after a newcomer asked where to start reading.'
    },
    {
        suffix: 'context',
        type: 'context',
        title: 'Context: demo card generated for walkthroughs',
        summary: 'This card was generated as seed data for screenshots, RAG retrieval, and pilot usability tasks.',
        content: 'Use this generated card set to demonstrate the knowledge sidebar, editor hover, guide ordering, timeline entries, and risk-warning retrieval without relying on a live collaborative session.',
        tags: ['demo', 'context', 'walkthrough'],
        createdOffsetMinutes: 0,
        reviewedOffsetMinutes: 8
    }
];

export function createDemoKnowledgeCards(args: CreateDemoKnowledgeCardsArgs): KnowledgeCard[] {
    const now = resolveNow(args.now);
    const workspaceRelativePath = normalizeWorkspaceRelativePath(args.workspaceRelativePath);
    const snapshotText = args.selectedText || 'No active selection. Demo card is anchored to the active file.';
    const landmarkLines = snapshotText
        .split(/\r?\n/g)
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 5);

    return demoTemplates.map(template => {
        const id = `demo-${template.suffix}`;
        const createdAt = now + minutes(template.createdOffsetMinutes);
        const evolution = [
            { at: createdAt, action: 'created' as const, note: 'Generated demo knowledge card.' },
            ...(template.updatedOffsetMinutes !== undefined ? [{
                at: now + minutes(template.updatedOffsetMinutes),
                action: 'updated' as const,
                note: template.updateNote ?? 'Updated demo knowledge card during the walkthrough.'
            }] : []),
            ...(template.reviewedOffsetMinutes !== undefined ? [{
                at: now + minutes(template.reviewedOffsetMinutes),
                action: 'reviewed' as const,
                note: 'Marked as reviewed for the demo knowledge base.'
            }] : [])
        ];
        const updatedAt = Math.max(...evolution.map(entry => entry.at));
        return {
            schemaVersion: LatestSchemaVersion,
            id,
            type: template.type,
            title: template.title,
            summary: template.summary,
            content: template.content,
            source: 'manual',
            status: 'reviewed',
            tags: template.tags,
            confidence: 0.95,
            createdAt,
            updatedAt,
            metadata: {},
            provenance: {
                origin: 'manual',
                author: { kind: 'human', memberId: 'demo' },
                evidenceRefs: {}
            },
            review: { confirmedBy: ['demo'], confirmedAt: now + minutes(template.reviewedOffsetMinutes ?? 0) },
            scope: 'team',
            ownerMemberId: 'demo',
            anchors: [
                {
                    anchorId: `${id}-a1`,
                    file: {
                        workspaceFolderName: args.workspaceFolderName,
                        workspaceRelativePath
                    },
                    associationLevel: template.type === 'tutorial' || template.type === 'context' ? 'file' : 'block',
                    snapshot: { text: snapshotText },
                    fingerprint: {
                        prefix: '',
                        suffix: '',
                        landmarkLines
                    }
                }
            ],
            evolution
        };
    });
}

function minutes(value: number): number {
    return value * 60 * 1000;
}
