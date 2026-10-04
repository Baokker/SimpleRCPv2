import type { KnowledgeCard, KnowledgeCardStatus, KnowledgeOrigin, KnowledgeSource } from './schema.js';
import { LatestSchemaVersion } from './schema.js';
import { systemClock } from './clock.js';

type LegacyCard = Record<string, any>;

export function migrateKnowledgeCard(value: unknown, now = () => systemClock.now()): KnowledgeCard {
    if (!value || typeof value !== 'object') throw new Error('Knowledge card must be an object');
    const source = value as LegacyCard;
    if (source.schemaVersion === LatestSchemaVersion) return structuredClone(source) as KnowledgeCard;
    if (source.schemaVersion !== 1 && source.schemaVersion !== 2) throw new Error(`Unsupported knowledge card schema: ${String(source.schemaVersion)}`);
    const legacySource = normalizeSource(source.source);
    const author = { kind: inferAuthorKind(source), memberId: source.metadata?.createdBy?.peerId, displayName: source.metadata?.createdBy?.name } as NonNullable<KnowledgeCard['provenance']>['author'];
    const status = normalizeStatus(source.status);
    const confirmedBy = status === 'reviewed' && author.memberId ? [author.memberId] : [];
    const createdAt = numberOr(source.createdAt, now());
    const updatedAt = numberOr(source.updatedAt, createdAt);
    const metadata = source.metadata && typeof source.metadata === 'object' ? structuredClone(source.metadata) : {};
    const card = {
        ...structuredClone(source),
        schemaVersion: LatestSchemaVersion,
        source: legacySource,
        status,
        metadata,
        provenance: {
            origin: legacySourceToOrigin(legacySource),
            author,
            evidenceRefs: {
                chatMessageIds: Array.isArray(source.relatedChatMessageIds) ? [...source.relatedChatMessageIds] : Array.isArray(metadata.relatedChatMessageIds) ? [...metadata.relatedChatMessageIds] : undefined
            }
        },
        review: { confirmedBy },
        scope: 'team',
        ownerMemberId: author.memberId,
        anchors: Array.isArray(source.anchors) ? source.anchors : [],
        relations: Array.isArray(source.relations) ? source.relations : [],
        evolution: Array.isArray(source.evolution) ? source.evolution : [{ at: createdAt, action: 'created' }]
    } as KnowledgeCard;
    card.createdAt = createdAt;
    card.updatedAt = updatedAt;
    return card;
}

export function migrateKnowledgeCards(values: unknown[], now = () => systemClock.now()): KnowledgeCard[] {
    return values.map(value => migrateKnowledgeCard(value, now));
}

function normalizeSource(value: unknown): KnowledgeSource {
    return value === 'manual' || value === 'event' || value === 'ai' ? value : 'manual';
}
function legacySourceToOrigin(source: KnowledgeSource): KnowledgeOrigin {
    if (source === 'manual') return 'manual';
    return 'human-human';
}
function inferAuthorKind(source: LegacyCard): 'human' | 'agent' {
    return source.provenance?.author?.kind === 'agent' ? 'agent' : 'human';
}
function normalizeStatus(value: unknown): KnowledgeCardStatus {
    return value === 'draft' || value === 'reviewed' || value === 'needsReview' || value === 'archived' || value === 'orphaned' || value === 'superseded' ? value : 'draft';
}
function numberOr(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
