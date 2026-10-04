export const LatestSchemaVersion = 3 as const;

export type TextPosition = { line: number; character: number };
export type TextRange = { start: TextPosition; end: TextPosition };
export type RelativeTextPosition = { type: string; item?: string; assoc?: number };

export type KnowledgeCardType = 'decision' | 'constraint' | 'risk' | 'context' | 'negative' | 'tutorial';
export type KnowledgeSource = 'manual' | 'event' | 'ai';
export type KnowledgeCardStatus = 'draft' | 'reviewed' | 'needsReview' | 'archived' | 'orphaned' | 'superseded';
export type KnowledgeAssociationLevel = 'block' | 'symbol' | 'file';
export type KnowledgeOrigin = 'preset' | 'human-human' | 'human-agent' | 'agent-self' | 'manual';
export type KnowledgeAuthorKind = 'human' | 'agent';
export type KnowledgeScope = 'personal' | 'proposedTeam' | 'team';
export type KnowledgeEvolutionAction = 'created' | 'updated' | 'reviewed' | 'archived' | 'orphaned' | 'confirmed' | 'scopeChanged' | 'superseded' | 'recurrence';

export interface KnowledgeEvolutionEntry {
    at: number;
    action: KnowledgeEvolutionAction;
    by?: { peerId: string; name?: string };
    note?: string;
}

export interface KnowledgeAnchor {
    anchorId: string;
    file: { workspaceFolderName?: string; workspaceRelativePath: string };
    associationLevel: KnowledgeAssociationLevel;
    rangeAtCapture?: TextRange;
    yjsRelative?: { start: RelativeTextPosition; end: RelativeTextPosition };
    semantic?: { path: Array<{ name: string; kind: number }>; name: string; kind: number };
    snapshot: { text: string; truncated?: boolean; sha256?: string };
    fingerprint?: { prefix: string; suffix: string; landmarkLines: string[] };
}

export interface KnowledgeProvenance {
    origin: KnowledgeOrigin;
    author: { kind: KnowledgeAuthorKind; memberId?: string; displayName?: string; agentRunId?: string };
    trigger?: { type: string; suggestionId: string };
    evidenceRefs: { chatMessageIds?: string[]; runIds?: string[]; traceRefs?: Array<{ runId: string; seq: number }>; files?: Array<{ path: string; revision?: string }> };
}

export interface KnowledgeReview {
    confirmedBy: string[];
    confirmedAt?: number;
    editedBeforeConfirm?: boolean;
}

export type KnowledgeAppliesTo = { kind: 'project' } | { kind: 'glob'; patterns: string[] };
export type KnowledgeRelation = { kind: 'supersedes' | 'contradicts' | 'duplicates' | 'refines'; cardId: string };
export type KnowledgeCheck = { kind: 'regex-absent' | 'regex-present'; pattern: string; flags?: string; fileGlob: string };
export interface KnowledgeUsage { injectedCount: number; toolHitCount: number; lastUsedAt?: number; recurrenceCount: number; }

export interface KnowledgeCard {
    schemaVersion: typeof LatestSchemaVersion;
    id: string;
    type: KnowledgeCardType;
    title: string;
    summary: string;
    content: string;
    source?: KnowledgeSource;
    status: KnowledgeCardStatus;
    tags: string[];
    confidence?: number;
    createdAt: number;
    updatedAt: number;
    metadata: { createdBy?: { peerId: string; name?: string }; roomId?: string; relatedChatMessageIds?: string[] };
    provenance?: KnowledgeProvenance;
    review?: KnowledgeReview;
    scope?: KnowledgeScope;
    ownerMemberId?: string;
    anchors: KnowledgeAnchor[];
    appliesTo?: KnowledgeAppliesTo;
    relations?: KnowledgeRelation[];
    check?: KnowledgeCheck;
    usage?: KnowledgeUsage;
    evolution: KnowledgeEvolutionEntry[];
}

export function normalizeWorkspaceRelativePath(p: string): string {
    return String(p ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
}

export const REUSABLE_KNOWLEDGE_CARD_STATUSES: readonly KnowledgeCardStatus[] = ['reviewed'];

export function isKnowledgeCard(value: unknown): value is KnowledgeCard {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<KnowledgeCard>;
    if (v.schemaVersion !== LatestSchemaVersion || typeof v.id !== 'string' || !v.id) return false;
    if (!isKnowledgeCardType(v.type) || typeof v.title !== 'string' || !v.title || typeof v.summary !== 'string' || typeof v.content !== 'string') return false;
    if (v.source !== undefined && !isKnowledgeSource(v.source)) return false;
    if (!isKnowledgeCardStatus(v.status) || !Array.isArray(v.tags) || v.tags.some(t => typeof t !== 'string')) return false;
    if (typeof v.createdAt !== 'number' || typeof v.updatedAt !== 'number' || !v.metadata || typeof v.metadata !== 'object') return false;
    if (!Array.isArray(v.anchors) || !Array.isArray(v.evolution)) return false;
    if (v.provenance !== undefined && !isKnowledgeProvenance(v.provenance)) return false;
    if (v.review !== undefined && (!Array.isArray(v.review.confirmedBy) || v.review.confirmedBy.some(id => typeof id !== 'string'))) return false;
    if (v.scope !== undefined && !isKnowledgeScope(v.scope)) return false;
    if (v.ownerMemberId !== undefined && typeof v.ownerMemberId !== 'string') return false;
    if (v.appliesTo !== undefined && !isKnowledgeAppliesTo(v.appliesTo)) return false;
    if (v.relations !== undefined && (!Array.isArray(v.relations) || v.relations.some(relation => !relation || typeof relation.cardId !== 'string'))) return false;
    if (v.check !== undefined && (!v.check || typeof v.check.pattern !== 'string' || typeof v.check.fileGlob !== 'string' || !['regex-absent', 'regex-present'].includes(v.check.kind))) return false;
    for (const anchor of v.anchors) if (!isKnowledgeAnchor(anchor)) return false;
    return true;
}

function isKnowledgeCardType(value: unknown): value is KnowledgeCardType {
    return value === 'decision' || value === 'constraint' || value === 'risk' || value === 'context' || value === 'negative' || value === 'tutorial';
}
function isKnowledgeSource(value: unknown): value is KnowledgeSource { return value === 'manual' || value === 'event' || value === 'ai'; }
function isKnowledgeCardStatus(value: unknown): value is KnowledgeCardStatus { return value === 'draft' || value === 'reviewed' || value === 'needsReview' || value === 'archived' || value === 'orphaned' || value === 'superseded'; }
function isKnowledgeScope(value: unknown): value is KnowledgeScope { return value === 'personal' || value === 'proposedTeam' || value === 'team'; }
function isKnowledgeProvenance(value: KnowledgeProvenance): boolean { return !!value && ['preset', 'human-human', 'human-agent', 'agent-self', 'manual'].includes(value.origin) && !!value.author && ['human', 'agent'].includes(value.author.kind) && !!value.evidenceRefs && typeof value.evidenceRefs === 'object'; }
function isKnowledgeAppliesTo(value: KnowledgeAppliesTo): boolean { return value.kind === 'project' || (value.kind === 'glob' && Array.isArray(value.patterns) && value.patterns.every(pattern => typeof pattern === 'string')); }
function isKnowledgeAnchor(value: unknown): value is KnowledgeAnchor {
    if (!value || typeof value !== 'object') return false;
    const anchor = value as KnowledgeAnchor;
    if (typeof anchor.anchorId !== 'string' || !anchor.anchorId || !anchor.file || typeof anchor.file.workspaceRelativePath !== 'string') return false;
    if (!['block', 'symbol', 'file'].includes(anchor.associationLevel) || !anchor.snapshot || typeof anchor.snapshot.text !== 'string') return false;
    if (anchor.fingerprint && (!Array.isArray(anchor.fingerprint.landmarkLines) || typeof anchor.fingerprint.prefix !== 'string' || typeof anchor.fingerprint.suffix !== 'string')) return false;
    if (anchor.rangeAtCapture && (!anchor.rangeAtCapture.start || !anchor.rangeAtCapture.end)) return false;
    return true;
}

export type CaptureTriggerType = 'chat.dense' | 'todo.cleared' | 'magicNumber.added' | 'packageJson.dependencySwitch' | 'diagnostics.fixed' | 'rollback.detected';

export interface CaptureSuggestion {
    id: string;
    triggerType: CaptureTriggerType;
    createdAt: number;
    origin: KnowledgeOrigin;
    actors: { memberIds: string[]; runIds: string[] };
    suggestedType?: KnowledgeCardType;
    suggestedTitle?: string;
    suggestedSummary?: string;
    suggestedAnchors?: KnowledgeAnchor[];
    evidence: Record<string, unknown>;
    confidence?: number;
    dedupe?: { cardId: string; score: number };
}

export function isCaptureSuggestion(value: unknown): value is CaptureSuggestion {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<CaptureSuggestion>;
    const validType = v.suggestedType === undefined || ['decision', 'constraint', 'risk', 'context', 'negative', 'tutorial'].includes(v.suggestedType);
    return typeof v.id === 'string' && !!v.id && typeof v.triggerType === 'string' && typeof v.createdAt === 'number' && !!v.evidence && typeof v.evidence === 'object' && validType && (v.origin === undefined || typeof v.origin === 'string') && (v.actors === undefined || (Array.isArray(v.actors.memberIds) && Array.isArray(v.actors.runIds)));
}
