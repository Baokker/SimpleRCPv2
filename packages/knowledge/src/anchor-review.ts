// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import { resolveKnowledgeAnchorInText } from './anchor-resolver.js';
import type { KnowledgeAnchor } from './schema/card.js';

export interface AnchorReviewHint {
    needsReview: boolean;
    reason?: string;
}

export function assessAnchorReviewHint(docText: string, anchor: KnowledgeAnchor): AnchorReviewHint {
    if (anchor.associationLevel === 'file') {
        return { needsReview: false };
    }

    const resolved = resolveKnowledgeAnchorInText(docText, anchor);
    if (resolved && resolved.confidence >= 0.35) {
        return { needsReview: false };
    }

    return {
        needsReview: true,
        reason: 'Anchor could not be resolved confidently. Please review or reselect the anchor.'
    };
}
