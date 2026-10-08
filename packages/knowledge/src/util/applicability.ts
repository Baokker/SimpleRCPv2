import { minimatch } from 'minimatch';
import { normalizeWorkspaceRelativePath, type KnowledgeCard } from '../schema/card.js';

export function cardMatchesFile(card: Pick<KnowledgeCard, 'anchors' | 'appliesTo'>, file: string): boolean {
    const normalized = normalizeWorkspaceRelativePath(file);
    return card.appliesTo?.kind === 'project'
        || (card.appliesTo?.kind === 'glob' && card.appliesTo.patterns.some(pattern => minimatch(normalized, pattern, { dot: true })))
        || card.anchors.some(anchor => normalizeWorkspaceRelativePath(anchor.file.workspaceRelativePath) === normalized);
}
