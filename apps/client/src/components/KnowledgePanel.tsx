import { useEffect, useState, useRef } from "react";
import { confirmKnowledgeTeamScope, disputeKnowledgeSuggestion, getKnowledgeInbox, getKnowledgeRelationCandidates, getKnowledgeSuggestion, getPendingKnowledgeTeamCards, markKnowledgeCardViewed, markKnowledgeSuggestionsRead, markKnowledgeWarningsRead, relateKnowledgeCards, requestKnowledgeTeamScope, resolveKnowledgeSuggestion } from "../api";
import type {
  KnowledgeCard,
  KnowledgeCardType,
  KnowledgeGuideItem,
  KnowledgeScope,
  KnowledgeTimelineItem,
  KnowledgeAnchorResolution
} from "../types";

type View = "current" | "all" | "guide" | "timeline" | "inbox" | "pending";
type Selection = { file: string; selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } };
type CardInput = import("../types").KnowledgeCardInput;

export function KnowledgePanel({
  projectId, members, refreshVersion, focusCardId, onRefresh,
  cards,
  guide,
  timeline,
  resolutions,
  activePath,
  pinSelection,
  currentSelection,
  memberId,
  onCreate,
  onUpdate,
  onConfirm,
  onArchive,
  onReanchor,
  onGenerateDemo,
  onOpenAnchor,
  onClearPinSelection
}: {
  projectId: string; members: import("../types").RoomMember[]; refreshVersion: number; onRefresh(): Promise<void>;
  focusCardId?: string;
  cards: KnowledgeCard[];
  guide: KnowledgeGuideItem[];
  timeline: KnowledgeTimelineItem[];
  resolutions: KnowledgeAnchorResolution[];
  activePath?: string;
  pinSelection?: Selection;
  currentSelection?: Selection;
  memberId?: string;
  onCreate(input: CardInput): Promise<void>;
  onUpdate(id: string, input: CardInput): Promise<void>;
  onConfirm(id: string, edited?: boolean, durationMs?: number, patch?: CardInput): Promise<void>;
  onArchive(id: string): Promise<void>;
  onReanchor(id: string, anchorIndex: number, selection: Selection["selection"]): Promise<void>;
  onGenerateDemo(): Promise<void>;
  onOpenAnchor(path: string, range?: { startLine: number; startColumn: number; endLine: number; endColumn: number }): void;
  onClearPinSelection(): void;
}) {
  const [view, setView] = useState<View>("current");
  const [expanded, setExpanded] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<KnowledgeCard>();
  const [saving, setSaving] = useState(false);
  const [actionCardId, setActionCardId] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [type, setType] = useState<KnowledgeCardType>("decision");
  const [scope, setScope] = useState<KnowledgeScope>("team");
  const [suggestions, setSuggestions] = useState<import("../types").KnowledgeSuggestion[]>([]);
  const [warnings, setWarnings] = useState<import("../types").KnowledgeRiskWarning[]>([]);
  const [pendingTeam, setPendingTeam] = useState<KnowledgeCard[]>([]);
  const [allSuggestions, setAllSuggestions] = useState(false);
  const [draftEvidence, setDraftEvidence] = useState<import("../types").KnowledgeSuggestion>();
  const [selectedAnchors, setSelectedAnchors] = useState<number[]>([]);
  const [authorMemberId, setAuthorMemberId] = useState("");
  const [mergeCardId, setMergeCardId] = useState("");
  const [disputeReason, setDisputeReason] = useState<Record<string, string>>({});
  const [relationKind, setRelationKind] = useState<Record<string, "contradicts" | "supersedes" | "duplicates" | "refines">>({});
  const [relationTarget, setRelationTarget] = useState<Record<string, string>>({});
  const [relationCandidates, setRelationCandidates] = useState<Record<string, KnowledgeCard[]>>({});
  const openedAt = useRef(0);

  useEffect(() => {
    let active = true;
    void Promise.all([getKnowledgeInbox(projectId, allSuggestions), getPendingKnowledgeTeamCards(projectId)]).then(([inbox, pending]) => { if (active) { setSuggestions(inbox.suggestions); setWarnings(inbox.warnings); setPendingTeam(pending.cards); } }).catch(error => { if (active) setFormError(String(error)); });
    return () => { active = false; };
  }, [projectId, allSuggestions, refreshVersion, cards]);

  useEffect(() => {
    if (view !== "inbox" || !memberId) return;
    const ids = suggestions.filter(item => !item.seenBy?.includes(memberId)).map(item => item.id).slice(0, 100);
    if (!ids.length) return;
    void markKnowledgeSuggestionsRead(projectId, ids).catch(error => setFormError(String(error)));
  }, [projectId, view, memberId, suggestions]);
  useEffect(() => {
    if (view !== "inbox") return;
    const ids = warnings.filter(item => !item.seen).map(item => item.id).slice(0, 100);
    if (ids.length) void markKnowledgeWarningsRead(projectId, ids).catch(error => setFormError(String(error)));
  }, [projectId, view, warnings]);

  useEffect(() => {
    const suggestionId = editingCard?.status === "draft" ? editingCard.provenance?.trigger?.suggestionId : undefined;
    if (!suggestionId) return;
    let active = true;
    void getKnowledgeSuggestion(projectId, suggestionId).then(result => { if (active) setDraftEvidence(result.suggestion); }).catch(error => { if (active) setFormError(String(error)); });
    return () => { active = false; };
  }, [projectId, editingCard?.id]);

  useEffect(() => {
    const open = (event: Event) => { const id = (event as CustomEvent<string>).detail; setExpanded(id); setView("all"); };
    window.addEventListener("knowledge-open-card", open);
    return () => window.removeEventListener("knowledge-open-card", open);
  }, []);
  useEffect(() => { if (focusCardId) { setExpanded(focusCardId); setView("all"); } }, [focusCardId]);

  useEffect(() => {
    if (!pinSelection) return;
    openCreate();
  }, [pinSelection]);

  const currentCards = activePath
    ? cards.filter((card) => card.anchors.some((anchor) => normalizeKnowledgePath(anchor.file.workspaceRelativePath) === normalizeKnowledgePath(activePath)))
    : cards;
  const visibleCards = view === "current" ? currentCards : view === "all" ? cards : [];

  function openCreate() {
    setEditingCard(undefined);
    setDraftEvidence(undefined);
    setSelectedAnchors([]);
    setTitle("");
    setSummary("");
    setContent("");
    setTags("");
    setType("decision");
    setScope("team");
    setFormError(undefined);
    setFormOpen(true);
  }

  function openEdit(card: KnowledgeCard) {
    setEditingCard(card);
    setDraftEvidence(undefined);
    setSelectedAnchors([]);
    setTitle(card.title);
    setSummary(card.summary);
    setContent(card.content);
    setTags(card.tags.join(", "));
    setType(card.type);
    setScope(card.scope ?? "team");
    setFormError(undefined);
    setFormOpen(true);
    openedAt.current = Date.now();
    setAuthorMemberId(card.provenance?.author.memberId ?? memberId ?? "");
  }

  function closeForm() {
    setFormOpen(false);
    setEditingCard(undefined);
    setDraftEvidence(undefined);
    setSelectedAnchors([]);
    onClearPinSelection();
  }

  async function submit() {
    if (!title.trim() || !summary.trim() || saving) return;
    setSaving(true);
    setFormError(undefined);
    const input: CardInput = {
      type,
      title: title.trim(),
      summary: summary.trim(),
      content,
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      scope
    };
    if (editingCard?.status === "draft") {
      input.authorMemberId = authorMemberId;
      input.authorName = members.find(member => member.id === authorMemberId)?.displayName ?? authorMemberId;
      if (draftEvidence) input.anchors = selectedAnchors.map(index => draftEvidence.suggestedAnchors![index]!);
    }
    try {
      if (editingCard) {
        if (editingCard.status === "draft") {
          const edited = input.title !== editingCard.title || input.summary !== editingCard.summary || input.content !== editingCard.content || input.type !== editingCard.type || input.scope !== editingCard.scope || input.tags.join(",") !== editingCard.tags.join(",") || selectedAnchors.length > 0 || input.authorMemberId !== editingCard.provenance?.author.memberId;
          await onConfirm(editingCard.id, edited, Date.now() - openedAt.current, input);
        } else await onUpdate(editingCard.id, input);
      }
      else await onCreate(input);
      closeForm();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function confirm(card: KnowledgeCard) {
    openEdit(card);
  }

  async function resolveSuggestion(suggestion: import("../types").KnowledgeSuggestion, action: "accept" | "ai-draft" | "discard" | "merge") {
    if (actionCardId) return;
    setActionCardId(suggestion.id); setFormError(undefined);
    try {
      const result = await resolveKnowledgeSuggestion(projectId, suggestion.id, action, mergeCardId || suggestion.dedupe?.cardId);
      setSuggestions(items => items.filter(item => item.id !== suggestion.id));
      await onRefresh();
      if (result.card && action !== "merge") { openEdit(result.card); setDraftEvidence(result.suggestion ?? suggestion); setSelectedAnchors([]); }
    } catch (error) { setFormError(error instanceof Error ? error.message : String(error)); }
    finally { setActionCardId(undefined); }
  }

  async function disputeSuggestion(suggestion: import("../types").KnowledgeSuggestion) {
    const reason = disputeReason[suggestion.id]?.trim();
    if (!reason || !memberId || actionCardId) return;
    setActionCardId(suggestion.id); setFormError(undefined);
    try {
      const result = await disputeKnowledgeSuggestion(projectId, suggestion.id, reason);
      setSuggestions(items => items.map(item => item.id === suggestion.id ? result.suggestion : item));
      setDisputeReason(items => ({ ...items, [suggestion.id]: "" }));
    } catch (error) { setFormError(error instanceof Error ? error.message : String(error)); }
    finally { setActionCardId(undefined); }
  }

  async function requestTeam(card: KnowledgeCard) {
    setActionCardId(card.id); setFormError(undefined);
    try { await requestKnowledgeTeamScope(projectId, card.id); await onRefresh(); }
    catch (error) { setFormError(error instanceof Error ? error.message : String(error)); }
    finally { setActionCardId(undefined); }
  }

  async function confirmTeam(card: KnowledgeCard) {
    setActionCardId(card.id); setFormError(undefined);
    try { await confirmKnowledgeTeamScope(projectId, card.id); await onRefresh(); }
    catch (error) { setFormError(error instanceof Error ? error.message : String(error)); }
    finally { setActionCardId(undefined); }
  }

  async function relate(card: KnowledgeCard) {
    const target = relationTarget[card.id];
    if (!target || actionCardId) return;
    setActionCardId(card.id); setFormError(undefined);
    try { await relateKnowledgeCards(projectId, card.id, { kind: relationKind[card.id] ?? "contradicts", cardId: target }); await onRefresh(); }
    catch (error) { setFormError(error instanceof Error ? error.message : String(error)); }
    finally { setActionCardId(undefined); }
  }

  function loadRelationCandidates(card: KnowledgeCard) {
    if (relationCandidates[card.id] || card.scope !== "team") return;
    void getKnowledgeRelationCandidates(projectId, card.id).then(result => setRelationCandidates(items => ({ ...items, [card.id]: result.candidates.map(candidate => candidate.card) }))).catch(error => setFormError(String(error)));
  }

  async function archive(card: KnowledgeCard) {
    setActionCardId(card.id);
    setFormError(undefined);
    try {
      await onArchive(card.id);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionCardId(undefined);
    }
  }

  async function reanchor(card: KnowledgeCard, anchorIndex: number) {
    if (!currentSelection || (currentSelection.selection.startLineNumber === currentSelection.selection.endLineNumber && currentSelection.selection.startColumn === currentSelection.selection.endColumn)) return;
    setActionCardId(card.id);
    setFormError(undefined);
    try {
      await onReanchor(card.id, anchorIndex, currentSelection.selection);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionCardId(undefined);
    }
  }

  const renderCard = (card: KnowledgeCard) => (
    <KnowledgeCardItem
      key={card.id}
      card={card}
      expanded={expanded === card.id}
      memberId={memberId}
      resolutions={resolutions.filter((resolution) => resolution.cardId === card.id)}
      currentSelection={currentSelection}
      actionPending={actionCardId === card.id}
      onToggle={() => { setExpanded(expanded === card.id ? undefined : card.id); if (expanded !== card.id) { void markKnowledgeCardViewed(projectId, card.id); loadRelationCandidates(card); } }}
      onEdit={() => openEdit(card)}
      onConfirm={() => void confirm(card)}
      onArchive={() => void archive(card)}
      onReanchor={(index) => void reanchor(card, index)}
      onRequestTeam={() => void requestTeam(card)}
      onConfirmTeam={() => void confirmTeam(card)}
      onRelate={() => void relate(card)}
      relationCandidates={relationCandidates[card.id] ?? cards.filter(candidate => candidate.id !== card.id && candidate.status === "reviewed" && candidate.scope === "team").slice(0, 5)}
      relationKind={relationKind[card.id] ?? "contradicts"}
      relationTarget={relationTarget[card.id] ?? ""}
      onRelationKindChange={(value) => setRelationKind(items => ({ ...items, [card.id]: value }))}
      onRelationTargetChange={(value) => setRelationTarget(items => ({ ...items, [card.id]: value }))}
      onOpenAnchor={onOpenAnchor}
    />
  );

  return (
    <section className="knowledge-panel" data-testid="knowledge-panel">
      <div className="knowledge-toolbar">
        {(["inbox", "pending", "current", "all", "guide", "timeline"] as View[]).map((candidate) => (
          <button type="button" key={candidate} className={view === candidate ? "active" : ""} onClick={() => setView(candidate)}>
            {candidate === "inbox" ? "Inbox" : candidate === "pending" ? "待确认" : candidate === "current" ? "当前文件" : candidate === "all" ? "全部卡片" : candidate === "guide" ? "导览" : "时间线"}
          </button>
        ))}
      </div>
      <div className="knowledge-actions">
        <button type="button" onClick={openCreate}>新建卡片</button>
        <button type="button" onClick={() => void onGenerateDemo()}>生成 Demo</button>
      </div>
      {formError ? <p className="knowledge-error" role="alert">{formError}</p> : null}
      {view === "inbox" ? <div data-testid="knowledge-inbox">
        {warnings.map(warning => <article className="knowledge-suggestion" key={warning.id} data-testid="knowledge-inbox-warning">
          <strong>风险提醒 · {warning.file}</strong><time>{new Date(warning.createdAt).toLocaleString()}</time>
          <p>{cards.find(card => card.id === warning.cardId)?.title}</p>
          <button onClick={() => { setExpanded(warning.cardId); setView("all"); }}>打开卡片</button>
        </article>)}
        <label><input type="checkbox" checked={allSuggestions} onChange={event => setAllSuggestions(event.target.checked)} />全部建议</label>
        <select aria-label="合并到已有卡片" value={mergeCardId} onChange={event => setMergeCardId(event.target.value)}><option value="">选择已确认卡片</option>{cards.filter(card => card.status === "reviewed").map(card => <option key={card.id} value={card.id}>{card.title}</option>)}</select>
        <ol className="knowledge-list">{suggestions.length === 0 ? <li>暂无捕获建议</li> : suggestions.map(suggestion => <li className="knowledge-suggestion" key={suggestion.id} data-testid={`suggestion-${suggestion.triggerType}`}>
          <strong>{suggestion.triggerType}</strong><time>{new Date(suggestion.createdAt).toLocaleString()}</time>
          <p>{suggestion.actors.memberIds.map(id => members.find(member => member.id === id)?.displayName ?? id).join("、")}</p>
          <p>{suggestion.suggestedSummary}</p>
          {suggestion.dedupe ? <p>可能是已有卡片的补充或复现</p> : null}
          {suggestion.suggestedAnchors?.map((anchor, index) => <button key={index} onClick={() => onOpenAnchor(anchor.file, { startLine: anchor.startLine, startColumn: 1, endLine: anchor.endLine, endColumn: 1 })}>{anchor.file}:{anchor.startLine}–{anchor.endLine}</button>)}
          <details><summary>原始证据</summary><pre>{JSON.stringify(suggestion.evidence, null, 2)}</pre></details>
          <div className="knowledge-actions">
            <button disabled={Boolean(actionCardId)} onClick={() => void resolveSuggestion(suggestion, "accept")}>接受</button>
            <button disabled={Boolean(actionCardId)} onClick={() => void resolveSuggestion(suggestion, "ai-draft")}>AI 草稿</button>
            <button disabled={Boolean(actionCardId) || (!mergeCardId && !suggestion.dedupe)} onClick={() => void resolveSuggestion(suggestion, "merge")}>合并到已有卡片</button>
            <button disabled={Boolean(actionCardId)} onClick={() => void resolveSuggestion(suggestion, "discard")}>丢弃</button>
          </div>
          {memberId && suggestion.actors.memberIds.includes(memberId) ? <div className="knowledge-dispute">
            <input value={disputeReason[suggestion.id] ?? ""} onChange={event => setDisputeReason(items => ({ ...items, [suggestion.id]: event.target.value }))} placeholder="异议理由" aria-label="异议理由" />
            <button disabled={Boolean(actionCardId) || !disputeReason[suggestion.id]?.trim()} onClick={() => void disputeSuggestion(suggestion)}>我有不同意见</button>
          </div> : null}
        </li>)}</ol>
      </div> : view === "pending" ? (
        <ol className="knowledge-list">
          {pendingTeam.length === 0 ? <li>暂无待确认卡片</li> : pendingTeam.map(renderCard)}
        </ol>
      ) : view === "guide" ? (
        <ol className="knowledge-list">
          {guide.map((item) => renderCard(item.card))}
        </ol>
      ) : view === "timeline" ? (
        <ol className="knowledge-list">
          {timeline.map((item, index) => <li key={`${item.card.id}-${item.kind}-${item.at}-${index}`} className="knowledge-timeline-item"><time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleString()}</time><span>{item.label}</span></li>)}
        </ol>
      ) : (
        <ol className="knowledge-list">
          {visibleCards.length === 0 ? <li className="empty-panel-state">暂无知识卡片</li> : visibleCards.map(renderCard)}
        </ol>
      )}
      {formOpen ? (
        <div className="knowledge-editor" role="dialog" aria-label="知识卡片编辑器">
          <h3>{editingCard ? "编辑知识卡片" : "知识卡片"}</h3>
          {draftEvidence ? <aside className="knowledge-draft-evidence">
            <details open><summary>原始证据</summary><pre>{JSON.stringify(draftEvidence.evidence, null, 2)}</pre></details>
            <strong>建议锚点</strong>{draftEvidence.suggestedAnchors?.map((anchor, index) => <label key={index}><input type="checkbox" checked={selectedAnchors.includes(index)} onChange={event => setSelectedAnchors(items => event.target.checked ? [...items, index] : items.filter(item => item !== index))} />{anchor.file}:{anchor.startLine}–{anchor.endLine} · {anchor.reasons.join("、")}</label>)}
          </aside> : null}
          {editingCard?.status === "draft" ? <select value={authorMemberId} onChange={event => setAuthorMemberId(event.target.value)} aria-label="卡片作者">{members.map(member => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select> : null}
          {editingCard ? (
            <div className="knowledge-editor-anchors">
              <small>锚点列表</small>
              <ul>
                {editingCard.anchors.length === 0 ? <li>无代码锚点</li> : editingCard.anchors.map((anchor) => <li key={anchor.anchorId}>{anchor.file.workspaceRelativePath}</li>)}
              </ul>
              <small>锚点需要在卡片展开后单独重选。</small>
            </div>
          ) : null}
          <select value={type} onChange={(event) => setType(event.target.value as KnowledgeCardType)} aria-label="卡片类型">
            <option value="decision">decision</option><option value="constraint">constraint</option><option value="risk">risk</option><option value="context">context</option><option value="negative">negative</option><option value="tutorial">tutorial</option>
          </select>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="标题" />
          <input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="摘要" />
          <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="正文 Markdown" />
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="标签，用逗号分隔" />
          <select value={scope} onChange={(event) => setScope(event.target.value as KnowledgeScope)} aria-label="作用域"><option value="team">团队</option><option value="personal">个人</option>{editingCard?.scope === "proposedTeam" ? <option value="proposedTeam">待确认</option> : null}</select>
          <div><button type="button" onClick={closeForm}>取消</button><button type="button" disabled={saving || !title.trim() || !summary.trim()} onClick={() => void submit()}>{editingCard?.status === "draft" ? "确认并保存" : "保存"}</button></div>
        </div>
      ) : null}
    </section>
  );
}

function KnowledgeCardItem({
  card,
  expanded,
  memberId,
  resolutions,
  currentSelection,
  actionPending,
  onToggle,
  onEdit,
  onConfirm,
  onArchive,
  onReanchor,
  onRequestTeam,
  onConfirmTeam,
  onRelate,
  relationCandidates,
  relationKind,
  relationTarget,
  onRelationKindChange,
  onRelationTargetChange,
  onOpenAnchor
}: {
  card: KnowledgeCard;
  expanded: boolean;
  memberId?: string;
  resolutions: KnowledgeAnchorResolution[];
  currentSelection?: Selection;
  actionPending: boolean;
  onToggle(): void;
  onEdit(): void;
  onConfirm(): void;
  onArchive(): void;
  onReanchor(index: number): void;
  onRequestTeam?(): void;
  onConfirmTeam?(): void;
  onRelate?(): void;
  relationCandidates?: KnowledgeCard[];
  relationKind?: "contradicts" | "supersedes" | "duplicates" | "refines";
  relationTarget?: string;
  onRelationKindChange?(value: "contradicts" | "supersedes" | "duplicates" | "refines"): void;
  onRelationTargetChange?(value: string): void;
  onOpenAnchor(path: string, range?: { startLine: number; startColumn: number; endLine: number; endColumn: number }): void;
}) {
  const canManage = Boolean(memberId && (card.ownerMemberId === memberId || card.review?.confirmedBy.includes(memberId)));
  return (
    <li className={`knowledge-card knowledge-card-${card.type}`}>
      <button type="button" className="knowledge-card-summary" onClick={onToggle}>
        <strong>{card.type} · {card.title}</strong>
        <span>{card.summary}</span>
        <small>{card.scope ?? "team"} · {card.status}</small>
        <small>{card.provenance?.author.displayName ?? "未知成员"}</small>
      </button>
      {expanded ? (
        <div className="knowledge-card-content">
          <p>{card.content}</p>
          {card.anchors.length === 0 ? <small>无代码锚点</small> : card.anchors.map((anchor, index) => {
            const resolution = resolutions.find((candidate) => candidate.anchorIndex === index);
            const canReanchor = currentSelection && normalizeKnowledgePath(currentSelection.file) === normalizeKnowledgePath(anchor.file.workspaceRelativePath) && resolution?.status === "needsReview" && canManage;
            return (
              <div className="knowledge-anchor-row" key={anchor.anchorId}>
                <button type="button" onClick={() => onOpenAnchor(anchor.file.workspaceRelativePath, resolution?.range)}>⌖ {anchor.file.workspaceRelativePath}</button>
                <small>{resolution?.status ?? "未解析"}</small>
                {canReanchor ? <button type="button" disabled={actionPending} onClick={() => onReanchor(index)}>用当前选区重新锚定</button> : null}
              </div>
            );
          })}
          <div className="knowledge-card-actions">
            {canManage ? <button type="button" onClick={onEdit}>编辑</button> : null}
            {card.status === "draft" ? <button type="button" disabled={actionPending} onClick={onConfirm}>确认</button> : null}
            {card.scope === "personal" && card.status === "reviewed" && card.ownerMemberId === memberId && onRequestTeam ? <button type="button" disabled={actionPending} onClick={onRequestTeam}>申请团队确认</button> : null}
            {card.scope === "proposedTeam" && card.ownerMemberId !== memberId && onConfirmTeam ? <button type="button" disabled={actionPending} onClick={onConfirmTeam}>确认升级为团队卡片</button> : null}
            {canManage && card.status !== "archived" ? <button type="button" disabled={actionPending} onClick={onArchive}>归档</button> : null}
          </div>
          {card.scope === "team" && card.status === "reviewed" && relationCandidates?.length && onRelate && onRelationKindChange && onRelationTargetChange ? <div className="knowledge-card-relations">
            <select value={relationKind} onChange={event => onRelationKindChange(event.target.value as "contradicts" | "supersedes" | "duplicates" | "refines")} aria-label="知识关系">
              <option value="contradicts">矛盾</option><option value="supersedes">替代</option><option value="duplicates">重复</option><option value="refines">细化</option>
            </select>
            <select value={relationTarget} onChange={event => onRelationTargetChange(event.target.value)} aria-label="关系目标">
              <option value="">选择相关团队卡片</option>{relationCandidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
            </select>
            <button type="button" disabled={actionPending || !relationTarget} onClick={onRelate}>建立关系</button>
          </div> : null}
        </div>
      ) : null}
    </li>
  );
}

function normalizeKnowledgePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}
