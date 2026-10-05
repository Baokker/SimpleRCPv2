export const LatestSchemaVersion = 3 as const;

export type TextPosition = { line: number; character: number };
export type TextRange = { start: TextPosition; end: TextPosition };
export type RelativeTextPosition = {
    type: string;
    item?: string;
    assoc?: number;
};

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
    yjsRelative?: { start: RelativeTextPosition; end: RelativeTextPosition; docEpoch?: string };
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
    if (v.confidence !== undefined && (!isFiniteNumber(v.confidence) || v.confidence < 0 || v.confidence > 1)) return false;
    if (!isFiniteNumber(v.createdAt) || !isFiniteNumber(v.updatedAt) || !isKnowledgeMetadata(v.metadata)) return false;
    if (!Array.isArray(v.anchors) || !Array.isArray(v.evolution)) return false;
    if (v.evolution.some(entry => !isKnowledgeEvolutionEntry(entry))) return false;
    if (v.provenance !== undefined && !isKnowledgeProvenance(v.provenance)) return false;
    if (v.review !== undefined && !isKnowledgeReview(v.review)) return false;
    if (v.scope !== undefined && !isKnowledgeScope(v.scope)) return false;
    if (v.ownerMemberId !== undefined && typeof v.ownerMemberId !== 'string') return false;
    if (v.appliesTo !== undefined && !isKnowledgeAppliesTo(v.appliesTo)) return false;
    if (v.relations !== undefined && (!Array.isArray(v.relations) || v.relations.some(relation => !isKnowledgeRelation(relation)))) return false;
    if (v.check !== undefined && (!isKnowledgeCheck(v.check) || (v.type !== 'constraint' && v.type !== 'negative'))) return false;
    if (v.usage !== undefined && !isKnowledgeUsage(v.usage)) return false;
    for (const anchor of v.anchors) if (!isKnowledgeAnchor(anchor)) return false;
    return true;
}

function isKnowledgeCardType(value: unknown): value is KnowledgeCardType {
    return value === 'decision' || value === 'constraint' || value === 'risk' || value === 'context' || value === 'negative' || value === 'tutorial';
}
function isKnowledgeSource(value: unknown): value is KnowledgeSource { return value === 'manual' || value === 'event' || value === 'ai'; }
function isKnowledgeCardStatus(value: unknown): value is KnowledgeCardStatus { return value === 'draft' || value === 'reviewed' || value === 'needsReview' || value === 'archived' || value === 'orphaned' || value === 'superseded'; }
function isKnowledgeScope(value: unknown): value is KnowledgeScope { return value === 'personal' || value === 'proposedTeam' || value === 'team'; }
function isKnowledgeOrigin(value: unknown): value is KnowledgeOrigin { return value === 'preset' || value === 'human-human' || value === 'human-agent' || value === 'agent-self' || value === 'manual'; }
function isKnowledgeProvenance(value: unknown): value is KnowledgeProvenance {
    if (!value || typeof value !== 'object') return false;
    const provenance = value as KnowledgeProvenance;
    if (!isKnowledgeOrigin(provenance.origin) || !provenance.author || !['human', 'agent'].includes(provenance.author.kind)) return false;
    if (provenance.author.memberId !== undefined && typeof provenance.author.memberId !== 'string') return false;
    if (provenance.author.displayName !== undefined && typeof provenance.author.displayName !== 'string') return false;
    if (provenance.author.agentRunId !== undefined && typeof provenance.author.agentRunId !== 'string') return false;
    if (provenance.trigger !== undefined && (!provenance.trigger || typeof provenance.trigger.type !== 'string' || !provenance.trigger.suggestionId)) return false;
    return isEvidenceRefs(provenance.evidenceRefs);
}
function isEvidenceRefs(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const refs = value as KnowledgeProvenance['evidenceRefs'];
    return arraysOfStrings(refs.chatMessageIds) && arraysOfStrings(refs.runIds) && (refs.traceRefs === undefined || (Array.isArray(refs.traceRefs) && refs.traceRefs.every(ref => !!ref && typeof ref.runId === 'string' && Number.isInteger(ref.seq) && ref.seq >= 0))) && (refs.files === undefined || (Array.isArray(refs.files) && refs.files.every(file => !!file && typeof file.path === 'string' && (file.revision === undefined || typeof file.revision === 'string'))));
}
function isKnowledgeMetadata(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const metadata = value as KnowledgeCard['metadata'];
    return (metadata.createdBy === undefined || (!!metadata.createdBy && typeof metadata.createdBy.peerId === 'string' && (metadata.createdBy.name === undefined || typeof metadata.createdBy.name === 'string'))) && (metadata.roomId === undefined || typeof metadata.roomId === 'string') && arraysOfStrings(metadata.relatedChatMessageIds);
}
function isKnowledgeReview(value: unknown): value is KnowledgeReview { return !!value && typeof value === 'object' && Array.isArray((value as KnowledgeReview).confirmedBy) && (value as KnowledgeReview).confirmedBy.every(id => typeof id === 'string') && ((value as KnowledgeReview).confirmedAt === undefined || isFiniteNumber((value as KnowledgeReview).confirmedAt)) && ((value as KnowledgeReview).editedBeforeConfirm === undefined || typeof (value as KnowledgeReview).editedBeforeConfirm === 'boolean'); }
function isKnowledgeEvolutionEntry(value: unknown): value is KnowledgeEvolutionEntry {
    if (!value || typeof value !== 'object') return false;
    const entry = value as KnowledgeEvolutionEntry;
    return isFiniteNumber(entry.at)
        && ['created', 'updated', 'reviewed', 'archived', 'orphaned', 'confirmed', 'scopeChanged', 'superseded', 'recurrence'].includes(entry.action)
        && (entry.by === undefined || (!!entry.by && typeof entry.by.peerId === 'string' && (entry.by.name === undefined || typeof entry.by.name === 'string')))
        && (entry.note === undefined || typeof entry.note === 'string');
}
function isKnowledgeRelation(value: unknown): value is KnowledgeRelation { return !!value && typeof value === 'object' && ['supersedes', 'contradicts', 'duplicates', 'refines'].includes((value as KnowledgeRelation).kind) && typeof (value as KnowledgeRelation).cardId === 'string' && !!(value as KnowledgeRelation).cardId; }
function isKnowledgeCheck(value: unknown): value is KnowledgeCheck { return !!value && typeof value === 'object' && ['regex-absent', 'regex-present'].includes((value as KnowledgeCheck).kind) && typeof (value as KnowledgeCheck).pattern === 'string' && typeof (value as KnowledgeCheck).fileGlob === 'string' && ((value as KnowledgeCheck).flags === undefined || typeof (value as KnowledgeCheck).flags === 'string'); }
function isKnowledgeUsage(value: unknown): value is KnowledgeUsage { return !!value && typeof value === 'object' && Number.isInteger((value as KnowledgeUsage).injectedCount) && (value as KnowledgeUsage).injectedCount >= 0 && Number.isInteger((value as KnowledgeUsage).toolHitCount) && (value as KnowledgeUsage).toolHitCount >= 0 && Number.isInteger((value as KnowledgeUsage).recurrenceCount) && (value as KnowledgeUsage).recurrenceCount >= 0 && ((value as KnowledgeUsage).lastUsedAt === undefined || isFiniteNumber((value as KnowledgeUsage).lastUsedAt)); }
function isKnowledgeAppliesTo(value: unknown): value is KnowledgeAppliesTo {
    if (!value || typeof value !== 'object') return false;
    const appliesTo = value as KnowledgeAppliesTo;
    return appliesTo.kind === 'project' || (appliesTo.kind === 'glob' && Array.isArray(appliesTo.patterns) && appliesTo.patterns.every((pattern: unknown) => typeof pattern === 'string'));
}
function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function arraysOfStrings(value: unknown): boolean { return value === undefined || (Array.isArray(value) && value.every(item => typeof item === 'string')); }
function isKnowledgeAnchor(value: unknown): value is KnowledgeAnchor {
    if (!value || typeof value !== 'object') return false;
    const anchor = value as KnowledgeAnchor;
    if (typeof anchor.anchorId !== 'string' || !anchor.anchorId || !anchor.file || typeof anchor.file.workspaceRelativePath !== 'string') return false;
    if (!['block', 'symbol', 'file'].includes(anchor.associationLevel) || !anchor.snapshot || typeof anchor.snapshot.text !== 'string') return false;
    if (anchor.file.workspaceFolderName !== undefined && typeof anchor.file.workspaceFolderName !== 'string') return false;
    if (anchor.rangeAtCapture && (!isTextPosition(anchor.rangeAtCapture.start) || !isTextPosition(anchor.rangeAtCapture.end))) return false;
    if (anchor.yjsRelative && (!isRelativeTextPosition(anchor.yjsRelative.start) || !isRelativeTextPosition(anchor.yjsRelative.end) || (anchor.yjsRelative.docEpoch !== undefined && typeof anchor.yjsRelative.docEpoch !== 'string'))) return false;
    if (anchor.semantic && (!Array.isArray(anchor.semantic.path) || typeof anchor.semantic.name !== 'string' || typeof anchor.semantic.kind !== 'number' || anchor.semantic.path.some(item => !item || typeof item.name !== 'string' || typeof item.kind !== 'number'))) return false;
    if (anchor.snapshot.truncated !== undefined && typeof anchor.snapshot.truncated !== 'boolean') return false;
    if (anchor.snapshot.sha256 !== undefined && typeof anchor.snapshot.sha256 !== 'string') return false;
    if (anchor.fingerprint && (!Array.isArray(anchor.fingerprint.landmarkLines) || anchor.fingerprint.landmarkLines.some(line => typeof line !== 'string') || typeof anchor.fingerprint.prefix !== 'string' || typeof anchor.fingerprint.suffix !== 'string')) return false;
    return true;
}
function isTextPosition(value: unknown): value is TextPosition { return !!value && typeof value === 'object' && Number.isInteger((value as TextPosition).line) && (value as TextPosition).line >= 0 && Number.isInteger((value as TextPosition).character) && (value as TextPosition).character >= 0; }
function isRelativeTextPosition(value: unknown): value is RelativeTextPosition { return !!value && typeof value === 'object' && typeof (value as RelativeTextPosition).type === 'string' && ((value as RelativeTextPosition).item === undefined || typeof (value as RelativeTextPosition).item === 'string') && ((value as RelativeTextPosition).assoc === undefined || typeof (value as RelativeTextPosition).assoc === 'number'); }

function isCaptureTriggerType(value: unknown): value is CaptureTriggerType {
    return value === 'chat.dense' || value === 'todo.cleared' || value === 'magicNumber.added' || value === 'packageJson.dependencySwitch' || value === 'dependency.changed' || value === 'diagnostics.fixed' || value === 'rollback.detected' || value === 'edit.overwritten' || value === 'agent.interrupted' || value === 'agent.revised' || value === 'agent.corrected' || value === 'agent.retried' || value === 'agent.toolRecovered';
}

export type CaptureTriggerType = 'chat.dense' | 'todo.cleared' | 'magicNumber.added' | 'packageJson.dependencySwitch' | 'dependency.changed' | 'diagnostics.fixed' | 'rollback.detected' | 'edit.overwritten' | 'agent.interrupted' | 'agent.revised' | 'agent.corrected' | 'agent.retried' | 'agent.toolRecovered';

export interface SuggestedAnchor { file: string; startLine: number; endLine: number; score: number; reasons: string[]; }
function isSuggestedAnchor(value: unknown): value is SuggestedAnchor {
    if (!value || typeof value !== 'object') return false;
    const anchor = value as SuggestedAnchor;
    return typeof anchor.file === 'string' && !!anchor.file && Number.isInteger(anchor.startLine) && anchor.startLine >= 1 && Number.isInteger(anchor.endLine) && anchor.endLine >= anchor.startLine && isFiniteNumber(anchor.score) && anchor.score >= 0 && Array.isArray(anchor.reasons) && anchor.reasons.every(reason => typeof reason === 'string');
}

export interface CaptureSuggestion {
    id: string;
    triggerType: CaptureTriggerType;
    createdAt: number;
    origin: KnowledgeOrigin;
    actors: { memberIds: string[]; runIds: string[] };
    suggestedType?: KnowledgeCardType;
    suggestedTitle?: string;
    suggestedSummary?: string;
    suggestedAnchors?: Array<KnowledgeAnchor | SuggestedAnchor>;
    evidence: Record<string, unknown>;
    confidence?: number;
    dedupe?: { cardId: string; score: number };
    state?: 'open' | 'accepted' | 'discarded' | 'merged' | 'disputed';
    resolvedAt?: number;
    resolvedBy?: string;
    draftCardId?: string;
    seenBy?: string[];
    ai?: { model?: string; durationMs?: number; totalTokens?: number; fallback: boolean };
}

export function isCaptureSuggestion(value: unknown): value is CaptureSuggestion {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<CaptureSuggestion>;
    const validType = v.suggestedType === undefined || ['decision', 'constraint', 'risk', 'context', 'negative', 'tutorial'].includes(v.suggestedType);
    if (v.state !== undefined && !['open', 'accepted', 'discarded', 'merged', 'disputed'].includes(v.state)) return false;
    if (v.seenBy !== undefined && (!Array.isArray(v.seenBy) || v.seenBy.some(id => typeof id !== 'string'))) return false;
    return typeof v.id === 'string' && !!v.id && isCaptureTriggerType(v.triggerType) && isFiniteNumber(v.createdAt) && isKnowledgeOrigin(v.origin) && !!v.actors && Array.isArray(v.actors.memberIds) && v.actors.memberIds.every(id => typeof id === 'string') && Array.isArray(v.actors.runIds) && v.actors.runIds.every(id => typeof id === 'string') && !!v.evidence && typeof v.evidence === 'object' && !Array.isArray(v.evidence) && validType && (v.suggestedTitle === undefined || typeof v.suggestedTitle === 'string') && (v.suggestedSummary === undefined || typeof v.suggestedSummary === 'string') && (v.suggestedAnchors === undefined || (Array.isArray(v.suggestedAnchors) && v.suggestedAnchors.every(anchor => isKnowledgeAnchor(anchor) || isSuggestedAnchor(anchor)))) && (v.confidence === undefined || (isFiniteNumber(v.confidence) && v.confidence >= 0 && v.confidence <= 1)) && (v.dedupe === undefined || (!!v.dedupe && typeof v.dedupe.cardId === 'string' && !!v.dedupe.cardId && isFiniteNumber(v.dedupe.score) && v.dedupe.score >= 0 && v.dedupe.score <= 1));
}
