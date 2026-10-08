import { useEffect, useLayoutEffect, useMemo, useState, useRef } from "react";
import { BookOpen, FileText, Link2, LoaderCircle, Plus, Search, Upload, X } from "lucide-react";
import { removeKnowledgeEvidenceBlocks } from "@simplercp/knowledge/util/content";
import { distinctTimeline, knowledgeScopes, knowledgeStatuses, knowledgeTriggers, knowledgeTypes, markPendingKnowledgeSeen, timelineDescription } from "../knowledgePresentation";
import { confirmKnowledgeTeamScope, disputeKnowledgeSuggestion, getKnowledgeInbox, getKnowledgeRelationCandidates, getKnowledgeSuggestion, getPendingKnowledgeTeamCards, markKnowledgeCardViewed, markKnowledgeSuggestionsRead, markKnowledgeWarningsRead, relateKnowledgeCards, requestKnowledgeTeamScope, resolveKnowledgeSuggestion } from "../api";
import { importKnowledgeDocuments, exportKnowledgeToWorkspace } from "../api";
import type {
  KnowledgeCard,
  KnowledgeCardType,
  KnowledgeGuideItem,
  KnowledgeScope,
  KnowledgeTimelineItem,
  KnowledgeAnchorResolution
} from "../types";

type View = "current" | "all" | "guide" | "timeline" | "inbox";
type Selection = { file: string; selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } };
type CardInput = import("../types").KnowledgeCardInput;
type SuggestionAction = "accept" | "ai-draft" | "discard" | "merge";

export function KnowledgePanel({
  projectId, members, refreshVersion, focusCardId, onRefresh,
  isActive,
  inboxRequestVersion,
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
  isActive: boolean;
  focusCardId?: string;
  inboxRequestVersion?: number;
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
  const [actionName, setActionName] = useState("");
  const [slowAction, setSlowAction] = useState(false);
  const [suggestionErrors, setSuggestionErrors] = useState<Record<string, { message: string; action: SuggestionAction; targetCardId?: string }>>({});
  const [editorNotice, setEditorNotice] = useState("");
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
  const anchorSelectionChangedRef = useRef(false);
  const [authorMemberId, setAuthorMemberId] = useState("");
  const [mergeCardId, setMergeCardId] = useState("");
  const [disputeReason, setDisputeReason] = useState<Record<string, string>>({});
  const [relationKind, setRelationKind] = useState<Record<string, "contradicts" | "supersedes" | "duplicates" | "refines">>({});
  const [relationTarget, setRelationTarget] = useState<Record<string, string>>({});
  const [relationCandidates, setRelationCandidates] = useState<Record<string, KnowledgeCard[]>>({});
  const openedAt = useRef(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importPaths, setImportPaths] = useState("");
  const [imported, setImported] = useState<import("../types").KnowledgeSuggestion[]>([]);
  const [importSelected, setImportSelected] = useState<string[]>([]);
  const [importEdits, setImportEdits] = useState<Record<string, string>>({});
  const importDrafts = useRef(new Map<string, KnowledgeCard>());
  const importOpenedAt = useRef(0);
  const [documentNotice, setDocumentNotice] = useState("");
  const [documentAction, setDocumentAction] = useState("");
  const [query, setQuery] = useState("");
  const [filterTypes, setFilterTypes] = useState<KnowledgeCardType[]>([]);
  const [filterScope, setFilterScope] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterAuthor, setFilterAuthor] = useState("");
  const [sort, setSort] = useState("updatedAt");
  const [timelineCard, setTimelineCard] = useState("");
  const [deferredTeam, setDeferredTeam] = useState<string[]>([]);
  const [showDeferred, setShowDeferred] = useState(false);
  const deferredKey = `simplercp.knowledge.deferred.${projectId}.${memberId ?? ""}`;
  const viewContentRef = useRef<HTMLDivElement>(null);
  const revealedCardRef = useRef<string>();
  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const editorBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setDeferredTeam(JSON.parse(sessionStorage.getItem(deferredKey) ?? "[]") as string[]); }, [deferredKey]);
  useEffect(() => { if (inboxRequestVersion) setView("inbox"); }, [inboxRequestVersion]);
  useEffect(() => { setTimelineCard(""); }, [activePath]);

  useLayoutEffect(() => {
    if (!formOpen || !isActive) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    backgroundRef.current?.setAttribute("inert", "");
    editorBodyRef.current?.scrollTo(0, 0);
    titleRef.current?.focus({ preventScroll: true });
    titleRef.current?.scrollIntoView({ block: "nearest" });
    return () => { backgroundRef.current?.removeAttribute("inert"); previousFocus?.focus({ preventScroll: true }); };
  }, [formOpen, editingCard?.id, pinSelection, isActive]);

  useEffect(() => {
    setSlowAction(false);
    if (actionName !== "ai-draft") return;
    const timer = window.setTimeout(() => setSlowAction(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [actionCardId, actionName]);

  async function importDocuments() {
    setSaving(true); setDocumentAction("import"); setFormError(undefined);
    try {
      const files = importPaths.split(/[\n,]/).map((file) => file.trim()).filter(Boolean);
      const result = await importKnowledgeDocuments(projectId, files.length ? files : undefined);
      const suggestions = result.drafts.map((draft) => draft.suggestion);
      setImported(suggestions); setImportSelected(suggestions.map((suggestion) => suggestion.id));
      setImportEdits({}); importDrafts.current.clear(); importOpenedAt.current = Date.now();
      setDocumentNotice(`已生成 ${suggestions.length} 条规范草稿`);
      await onRefresh();
    } catch (error) { setFormError(String(error)); }
    finally { setSaving(false); setDocumentAction(""); }
  }

  async function confirmImported() {
    setSaving(true); setDocumentAction("confirm"); setFormError(undefined);
    try {
      for (const suggestion of imported.filter((item) => importSelected.includes(item.id))) {
        let card = importDrafts.current.get(suggestion.id);
        if (!card) {
          const result = await resolveKnowledgeSuggestion(projectId, suggestion.id, "accept");
          if (!result.card) throw new Error("导入草稿没有生成卡片");
          card = result.card; importDrafts.current.set(suggestion.id, card);
        }
        await onConfirm(card.id, importEdits[suggestion.id] !== undefined, Date.now() - importOpenedAt.current, { type: card.type, title: card.title, summary: card.summary, content: importEdits[suggestion.id] ?? card.content, tags: card.tags, scope: "team", appliesTo: card.appliesTo });
        importDrafts.current.delete(suggestion.id);
        setImported((items) => items.filter((item) => item.id !== suggestion.id));
      }
      await onRefresh();
    } catch (error) { setFormError(String(error)); }
    finally { setSaving(false); setDocumentAction(""); }
  }

  async function exportDocuments() {
    setSaving(true); setDocumentAction("export"); setFormError(undefined);
    try { const result = await exportKnowledgeToWorkspace(projectId); setDocumentNotice(`团队知识已写入 ${result.path}`); }
    catch (error) { setFormError(String(error)); }
    finally { setSaving(false); setDocumentAction(""); }
  }

  useEffect(() => {
    let active = true;
    void Promise.all([getKnowledgeInbox(projectId, allSuggestions), getPendingKnowledgeTeamCards(projectId)]).then(([inbox, pending]) => { if (active) { setSuggestions(inbox.suggestions); setWarnings(inbox.warnings); setPendingTeam(pending.cards); } }).catch(error => { if (active) setFormError(String(error)); });
    return () => { active = false; };
  }, [projectId, allSuggestions, refreshVersion, cards]);

  useEffect(() => {
    if (!isActive || formOpen || view !== "inbox" || !memberId) return;
    markPendingKnowledgeSeen(projectId, memberId, pendingTeam);
  }, [projectId, view, memberId, pendingTeam, isActive, formOpen]);
  useEffect(() => {
    if (!isActive || formOpen || view !== "inbox" || !memberId) return;
    const ids = suggestions.filter(item => !item.seenBy?.includes(memberId)).map(item => item.id).slice(0, 100);
    if (!ids.length) return;
    void markKnowledgeSuggestionsRead(projectId, ids).catch(error => setFormError(String(error)));
  }, [projectId, view, memberId, suggestions, isActive, formOpen]);
  useEffect(() => {
    if (!isActive || formOpen || view !== "inbox") return;
    const ids = warnings.filter(item => !item.seen).map(item => item.id).slice(0, 100);
    if (ids.length) void markKnowledgeWarningsRead(projectId, ids).catch(error => setFormError(String(error)));
  }, [projectId, view, warnings, isActive, formOpen]);

  useEffect(() => {
    const suggestionId = editingCard?.provenance?.trigger?.suggestionId;
    if (!suggestionId) return;
    let active = true;
    void getKnowledgeSuggestion(projectId, suggestionId).then(result => {
      if (!active) return;
      setDraftEvidence(result.suggestion);
      if (!anchorSelectionChangedRef.current) {
        setSelectedAnchors((result.suggestion.suggestedAnchors ?? []).flatMap((suggestion, index) => editingCard.anchors.some(anchor => matchesSuggestedAnchor(anchor, suggestion)) ? [index] : []));
      }
    }).catch(error => { if (active) setFormError(String(error)); });
    return () => { active = false; };
  }, [projectId, editingCard?.id]);

  useEffect(() => {
    const open = (event: Event) => revealCard((event as CustomEvent<string>).detail);
    window.addEventListener("knowledge-open-card", open);
    return () => window.removeEventListener("knowledge-open-card", open);
  }, []);
  useEffect(() => { if (focusCardId) revealCard(focusCardId); }, [focusCardId]);
  useLayoutEffect(() => {
    if (!isActive || !expanded || view !== "all" || revealedCardRef.current === expanded) return;
    const entry = [...(viewContentRef.current?.querySelectorAll<HTMLElement>("[data-card-id]") ?? [])].find(element => element.dataset.cardId === expanded);
    entry?.scrollIntoView({ block: "nearest" });
    if (entry) revealedCardRef.current = expanded;
  }, [expanded, view, cards, isActive]);

  function revealCard(id: string) {
    revealedCardRef.current = undefined;
    setQuery(""); setFilterTypes([]); setFilterScope(""); setFilterStatus(""); setFilterAuthor("");
    setExpanded(id); setView("all");
  }

  useEffect(() => {
    if (!pinSelection) return;
    openCreate();
  }, [pinSelection]);

  const currentCards = activePath
    ? cards.filter((card) => card.anchors.some((anchor) => normalizeKnowledgePath(anchor.file.workspaceRelativePath) === normalizeKnowledgePath(activePath)))
    : [];
  const filteredCards = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    const selected = cards.filter(card => (!text || [card.title, card.summary, card.content, ...card.tags].join("\n").toLocaleLowerCase().includes(text))
      && (!filterTypes.length || filterTypes.includes(card.type)) && (!filterScope || card.scope === filterScope)
      && (!filterStatus || card.status === filterStatus) && (!filterAuthor || (card.provenance?.author.memberId ?? card.metadata?.createdBy?.peerId) === filterAuthor));
    return selected.sort((left, right) => sort === "type" ? Object.keys(knowledgeTypes).indexOf(left.type) - Object.keys(knowledgeTypes).indexOf(right.type) || right.updatedAt - left.updatedAt : sort === "createdAt" ? right.createdAt - left.createdAt : right.updatedAt - left.updatedAt);
  }, [cards, query, filterTypes, filterScope, filterStatus, filterAuthor, sort]);
  const visibleCards = view === "current" ? currentCards : view === "all" ? filteredCards : [];
  const history = distinctTimeline(timeline).filter(item => !timelineCard || item.card.id === timelineCard);
  const historyDays = [...new Set(history.map(item => new Date(item.at).toLocaleDateString("zh-CN")))];
  const expandedIsVisible = view === "guide" ? guide.some(item => item.card.id === expanded) : visibleCards.some(card => card.id === expanded);
  useEffect(() => {
    if (isActive && !formOpen && expanded && expandedIsVisible) void markKnowledgeCardViewed(projectId, expanded).catch(error => setFormError(String(error)));
  }, [projectId, expanded, expandedIsVisible, isActive, formOpen]);

  function openCreate() {
    setEditorNotice("");
    setEditingCard(undefined);
    setDraftEvidence(undefined);
    setSelectedAnchors([]);
    anchorSelectionChangedRef.current = false;
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
    setEditorNotice("");
    setEditingCard(card);
    setDraftEvidence(undefined);
    setSelectedAnchors([]);
    anchorSelectionChangedRef.current = false;
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
      if (draftEvidence && anchorSelectionChangedRef.current) {
        const candidates = draftEvidence.suggestedAnchors ?? [];
        input.retainAnchorIds = editingCard.anchors.filter(anchor => {
          const index = candidates.findIndex(candidate => matchesSuggestedAnchor(anchor, candidate));
          return index < 0 || selectedAnchors.includes(index);
        }).map(anchor => anchor.anchorId);
        input.anchors = selectedAnchors.map(index => candidates[index]!).filter(candidate => !editingCard.anchors.some(anchor => matchesSuggestedAnchor(anchor, candidate)));
      }
    }
    try {
      if (editingCard) {
        if (editingCard.status === "draft") {
          const edited = input.title !== editingCard.title || input.summary !== editingCard.summary || input.content !== editingCard.content || input.type !== editingCard.type || input.scope !== editingCard.scope || input.tags.join(",") !== editingCard.tags.join(",") || anchorSelectionChangedRef.current || input.authorMemberId !== editingCard.provenance?.author.memberId;
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

  async function resolveSuggestion(suggestion: import("../types").KnowledgeSuggestion, action: SuggestionAction, targetCardId = mergeCardId || suggestion.dedupe?.cardId) {
    if (actionCardId) return;
    setActionCardId(suggestion.id); setActionName(action); setFormError(undefined);
    setSuggestionErrors(errors => { const next = { ...errors }; delete next[suggestion.id]; return next; });
    try {
      const result = await resolveKnowledgeSuggestion(projectId, suggestion.id, action, targetCardId);
      setSuggestions(items => items.filter(item => item.id !== suggestion.id));
      await onRefresh();
      if (result.card && action !== "merge") { openEdit(result.card); setEditorNotice("草案已生成，请核对后确认"); setDraftEvidence(result.suggestion ?? suggestion); setSelectedAnchors(suggestion.origin === "preset" ? (suggestion.suggestedAnchors ?? []).map((_, index) => index) : []); }
    } catch (error) { setSuggestionErrors(errors => ({ ...errors, [suggestion.id]: { message: error instanceof Error ? error.message : String(error), action, targetCardId } })); }
    finally { setActionCardId(undefined); setActionName(""); }
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
      members={members}
      resolutions={resolutions.filter((resolution) => resolution.cardId === card.id)}
      currentSelection={currentSelection}
      actionPending={actionCardId === card.id}
      onToggle={() => { setExpanded(expanded === card.id ? undefined : card.id); if (expanded !== card.id) loadRelationCandidates(card); }}
      onEdit={() => openEdit(card)}
      onConfirm={() => void confirm(card)}
      onArchive={() => void archive(card)}
      onReanchor={(index) => void reanchor(card, index)}
      onRequestTeam={() => void requestTeam(card)}
      onConfirmTeam={() => void confirmTeam(card)}
      onDeferTeam={() => { const ids = [...new Set([...deferredTeam, card.id])]; setDeferredTeam(ids); sessionStorage.setItem(deferredKey, JSON.stringify(ids)); setDocumentNotice("已暂不确认这条申请，申请仍然保留，可随时重新查看。"); }}
      onCopyLink={() => void navigator.clipboard.writeText(`${window.location.origin}/projects/${encodeURIComponent(projectId)}?knowledge=${encodeURIComponent(card.id)}`).then(() => setDocumentNotice("知识链接已复制")).catch(error => setFormError(String(error)))}
      onRelate={() => void relate(card)}
      relatedCards={cards}
      onOpenRelatedCard={revealCard}
      relationCandidates={relationCandidates[card.id] ?? cards.filter(candidate => candidate.id !== card.id && candidate.status === "reviewed" && candidate.scope === "team").slice(0, 5)}
      relationKind={relationKind[card.id] ?? "contradicts"}
      relationTarget={relationTarget[card.id] ?? ""}
      onRelationKindChange={(value) => setRelationKind(items => ({ ...items, [card.id]: value }))}
      onRelationTargetChange={(value) => setRelationTarget(items => ({ ...items, [card.id]: value }))}
      onOpenAnchor={onOpenAnchor}
    />
  );

  return (
    <section className="knowledge-panel" data-testid="knowledge-panel" hidden={!isActive}>
      <div ref={backgroundRef} className="knowledge-panel-background">
        <nav className="knowledge-toolbar" aria-label="知识视图">
          {(["inbox", "current", "all", "guide", "timeline"] as View[]).map(candidate => (
            <button type="button" key={candidate} className={view === candidate ? "active" : ""} aria-pressed={view === candidate} onClick={() => setView(candidate)}>
              {{ inbox: "待处理", current: "本文件相关", all: "全部知识", guide: "导览", timeline: "时间线" }[candidate]}
            </button>
          ))}
        </nav>
        <div className="knowledge-actions workspace-dialog-actions">
          <button type="button" className="primary" disabled={saving} onClick={openCreate}><Plus size={14} />新建卡片</button>
          <button type="button" disabled={saving} onClick={async () => { setSaving(true); setDocumentAction("demo"); try { await onGenerateDemo(); } catch (error) { setFormError(String(error)); } finally { setSaving(false); setDocumentAction(""); } }}>{documentAction === "demo" ? <LoaderCircle className="loading-icon" size={14} /> : <BookOpen size={14} />}{documentAction === "demo" ? "生成中" : "生成示例卡片"}</button>
          <button type="button" disabled={saving} onClick={() => setImportOpen(open => !open)}><Upload size={14} />导入规范文档</button>
          <button type="button" disabled={saving} onClick={() => void exportDocuments()}>{documentAction === "export" ? "导出中" : "导出团队 AGENTS.md"}</button>
        </div>
        <p className="knowledge-hint">导出已确认的团队知识，供 Agent 读取</p>
        {documentNotice ? <p className="knowledge-notice" role="status">{documentNotice}</p> : null}
        {formError ? <p className="knowledge-error" role="alert">{formError}</p> : null}
        <div ref={viewContentRef} className="knowledge-view-content" key={view} data-testid={`knowledge-content-${view}`}>
          {importOpen ? <section className="knowledge-document-import workspace-dialog" data-testid="knowledge-import" aria-busy={saving}>
            <h3>导入规范文档</h3>
            <label>工作区文档路径<textarea aria-label="规范文档路径" value={importPaths} onChange={event => setImportPaths(event.target.value)} placeholder="留空读取默认规范文件；多个路径使用换行" /></label>
            <p className="knowledge-hint">默认查找 AGENTS.md、CLAUDE.md、CONTRIBUTING.md、README.md 和 .cursor/rules 中的文件。</p>
            <div className="workspace-dialog-actions"><button disabled={saving} onClick={() => void importDocuments()}>{documentAction === "import" ? <><LoaderCircle className="loading-icon" size={14} />生成中</> : "生成导入草稿"}</button></div>
            <ol className="knowledge-list">{imported.map(suggestion => <li className="knowledge-suggestion" key={suggestion.id}>
              <label className="knowledge-check-label"><input type="checkbox" checked={importSelected.includes(suggestion.id)} onChange={event => setImportSelected(ids => event.target.checked ? [...ids, suggestion.id] : ids.filter(id => id !== suggestion.id))} />{suggestion.suggestedTitle}</label>
              <details open><summary>原文与行号</summary><pre>{String(suggestion.evidence.file)}:{JSON.stringify(suggestion.evidence.lineRange)}{"\n"}{String(suggestion.evidence.sourceText ?? "")}</pre></details>
              <textarea aria-label={`导入草稿 ${suggestion.suggestedTitle}`} value={importEdits[suggestion.id] ?? String((suggestion.evidence.draft as { content?: string })?.content ?? "")} onChange={event => setImportEdits(edits => ({ ...edits, [suggestion.id]: event.target.value }))} />
              <div className="workspace-dialog-actions"><button disabled={saving} onClick={async () => { setSaving(true); setDocumentAction(suggestion.id); try { await resolveKnowledgeSuggestion(projectId, suggestion.id, "discard"); setImported(items => items.filter(item => item.id !== suggestion.id)); await onRefresh(); } catch (error) { setFormError(String(error)); } finally { setSaving(false); setDocumentAction(""); } }}>{documentAction === suggestion.id ? "处理中" : "丢弃这条"}</button></div>
            </li>)}</ol>
            <div className="workspace-dialog-actions"><button className="primary" disabled={saving || !importSelected.some(id => imported.some(item => item.id === id))} onClick={() => void confirmImported()}>{documentAction === "confirm" ? "确认中" : "确认选中的草稿"}</button></div>
          </section> : null}
          {view === "all" ? <div className="knowledge-filters">
            <label className="knowledge-search"><Search size={15} /><input type="search" aria-label="搜索知识" placeholder="搜索标题、摘要、正文或标签" value={query} onChange={event => setQuery(event.target.value)} /></label>
            <details><summary>筛选与排序</summary>
              <fieldset className="knowledge-type-filters"><legend>类型，可选择多项</legend>{Object.entries(knowledgeTypes).map(([value, entry]) => <label key={value} title={value}><input type="checkbox" checked={filterTypes.includes(value as KnowledgeCardType)} onChange={event => setFilterTypes(types => event.target.checked ? [...types, value as KnowledgeCardType] : types.filter(type => type !== value))} />{entry.label}</label>)}</fieldset>
              <div className="knowledge-filter-grid">
                <label>作用域<select aria-label="筛选作用域" value={filterScope} onChange={event => setFilterScope(event.target.value)}><option value="">全部作用域</option>{Object.entries(knowledgeScopes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label>状态<select aria-label="筛选状态" value={filterStatus} onChange={event => setFilterStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(knowledgeStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label>作者<select aria-label="筛选作者" value={filterAuthor} onChange={event => setFilterAuthor(event.target.value)}><option value="">全部作者</option>{[...new Map([...members.map(member => [member.id, member.displayName] as const), ...cards.filter(card => card.provenance?.author.memberId).map(card => [card.provenance!.author.memberId!, card.provenance!.author.displayName ?? "成员"] as const)]).entries()].map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
                <label>排序<select aria-label="知识排序" value={sort} onChange={event => setSort(event.target.value)}><option value="updatedAt">更新时间</option><option value="createdAt">创建时间</option><option value="type">类型</option></select></label>
              </div>
              <div className="workspace-dialog-actions"><button onClick={() => { setQuery(""); setFilterTypes([]); setFilterScope(""); setFilterStatus(""); setFilterAuthor(""); }}>清除筛选</button></div>
            </details>
            <p className="knowledge-hint" role="status">共 {cards.length} 条，符合筛选 {filteredCards.length} 条</p>
          </div> : null}
          {view === "inbox" ? <div data-testid="knowledge-inbox">
            <h3>知识建议</h3>
            {warnings.map(warning => <article className="knowledge-suggestion" key={warning.id} data-testid="knowledge-inbox-warning">
              <strong>风险提醒</strong><p>{warning.file}</p><time>{new Date(warning.createdAt).toLocaleString()}</time>
              <p>{cards.find(card => card.id === warning.cardId)?.title}</p>
              <div className="workspace-dialog-actions"><button onClick={() => revealCard(warning.cardId)}>打开卡片</button></div>
            </article>)}
            <label className="knowledge-check-label"><input type="checkbox" checked={allSuggestions} onChange={event => setAllSuggestions(event.target.checked)} />查看所有成员的建议</label>
            <select aria-label="合并到已有卡片" value={mergeCardId} onChange={event => setMergeCardId(event.target.value)}><option value="">选择合并目标</option>{cards.filter(card => card.status === "reviewed").map(card => <option key={card.id} value={card.id}>{card.title}</option>)}</select>
            <ol className="knowledge-list">{suggestions.length === 0 ? <li className="empty-panel-state">还没有需要你处理的知识建议。系统在讨论、调试和修改配置等时机自动收集。</li> : suggestions.map(suggestion => <li className="knowledge-suggestion" key={suggestion.id} data-testid={`suggestion-${suggestion.triggerType}`} aria-busy={actionCardId === suggestion.id}>
              <header className="knowledge-suggestion-heading"><strong title={suggestion.triggerType}>{knowledgeTriggers[suggestion.triggerType] ?? suggestion.suggestedTitle}</strong><time dateTime={new Date(suggestion.createdAt).toISOString()}>{new Date(suggestion.createdAt).toLocaleString("zh-CN")}</time></header>
              <dl className="knowledge-card-facts knowledge-suggestion-facts"><div><dt>参与成员</dt><dd>{suggestion.actors.memberIds.map(id => <span className="ui-badge" key={id}>{members.find(member => member.id === id)?.displayName ?? "成员"}</span>)}</dd></div></dl>
              <p>{suggestion.suggestedSummary}</p>
              {suggestion.state === "disputed" ? <span className="knowledge-badge">有不同意见</span> : null}
              {readDispute(suggestion.evidence) ? <p>{members.find(member => member.id === readDispute(suggestion.evidence)?.memberId)?.displayName ?? "成员"}：{readDispute(suggestion.evidence)?.reason}</p> : null}
              {suggestion.dedupe ? <p className="knowledge-hint">可能是已有卡片的补充或复现</p> : null}
              <div className="knowledge-anchor-links">{suggestion.suggestedAnchors?.map((anchor, index) => <button key={index} onClick={() => onOpenAnchor(anchor.file, { startLine: anchor.startLine, startColumn: 1, endLine: anchor.endLine, endColumn: 1 })}><FileText size={13} />{anchor.file}:{anchor.startLine}–{anchor.endLine}</button>)}</div>
              <details><summary>原始证据</summary><pre>{JSON.stringify(suggestion.evidence, null, 2)}</pre></details>
              {actionCardId === suggestion.id ? <p className="knowledge-notice" role="status"><LoaderCircle size={14} className="loading-icon" />{actionName === "ai-draft" ? "正在根据证据生成草稿…" : "正在处理这条建议…"}{slowAction ? <span>模型整理较慢，请稍候</span> : null}</p> : null}
              {suggestionErrors[suggestion.id] ? <div role="alert" className="knowledge-error"><p>{suggestionErrors[suggestion.id]!.message}</p><div className="workspace-dialog-actions"><button disabled={Boolean(actionCardId)} onClick={() => { const failed = suggestionErrors[suggestion.id]!; void resolveSuggestion(suggestion, failed.action, failed.targetCardId); }}>重试</button></div></div> : null}
              <div className="knowledge-actions workspace-dialog-actions">
                <button disabled={Boolean(actionCardId)} onClick={() => void resolveSuggestion(suggestion, "accept")}>{actionCardId === suggestion.id && actionName === "accept" ? "接受中" : "接受"}</button>
                <button className="primary" disabled={Boolean(actionCardId)} onClick={() => void resolveSuggestion(suggestion, "ai-draft")}>{actionCardId === suggestion.id && actionName === "ai-draft" ? <><LoaderCircle size={14} className="loading-icon" />生成中</> : "AI 草稿"}</button>
                <button disabled={Boolean(actionCardId) || (!mergeCardId && !suggestion.dedupe)} onClick={() => void resolveSuggestion(suggestion, "merge")}>{actionCardId === suggestion.id && actionName === "merge" ? "合并中" : "合并到已有卡片"}</button>
                <button disabled={Boolean(actionCardId)} onClick={() => void resolveSuggestion(suggestion, "discard")}>{actionCardId === suggestion.id && actionName === "discard" ? "处理中" : "丢弃"}</button>
              </div>
              {memberId && suggestion.actors.memberIds.includes(memberId) ? <div className="knowledge-dispute workspace-dialog-actions">
                <input value={disputeReason[suggestion.id] ?? ""} onChange={event => setDisputeReason(items => ({ ...items, [suggestion.id]: event.target.value }))} placeholder="异议理由" aria-label="异议理由" />
                <button disabled={Boolean(actionCardId) || !disputeReason[suggestion.id]?.trim()} onClick={() => void disputeSuggestion(suggestion)}>我有不同意见</button>
              </div> : null}
            </li>)}</ol>
            <h3>待确认升级</h3>
            <p className="knowledge-hint">其他成员申请把个人知识提供给团队，请阅读后确认。</p>
            {deferredTeam.length ? <label className="knowledge-check-label"><input type="checkbox" checked={showDeferred} onChange={event => setShowDeferred(event.target.checked)} />显示暂不确认的申请</label> : null}
            <ol className="knowledge-list">{pendingTeam.filter(card => showDeferred || !deferredTeam.includes(card.id)).length ? pendingTeam.filter(card => showDeferred || !deferredTeam.includes(card.id)).map(renderCard) : <li className="empty-panel-state">目前没有需要你确认的团队升级申请。</li>}</ol>
          </div> : view === "guide" ? <>
            <p className="knowledge-hint">按当前文件组织的阅读顺序，适合新成员快速了解这段代码。</p>
            <ol className="knowledge-list">{guide.length ? guide.map((item, index) => <li className={`knowledge-guide-entry${index === 0 ? " first" : ""}`} key={item.card.id}>
              <div className="knowledge-guide-reason">{index === 0 ? <strong><BookOpen size={14} aria-hidden="true" />推荐从这里阅读</strong> : null}<span className="ui-badge">{item.isCurrentFile ? "与当前文件相关" : "补充项目背景"}</span><span className="ui-badge">{item.card.type === "tutorial" ? "教程类优先" : `${knowledgeTypes[item.card.type].label}帮助理解代码`}</span></div>
              <ol className="knowledge-list">{renderCard(item.card)}</ol>
            </li>) : <li className="empty-panel-state">还没有可用于导览的知识。可以关联当前文件的卡片，建立阅读顺序。</li>}</ol>
          </> : view === "timeline" ? <>
            <p className="knowledge-hint">查看知识的创建、修改、确认与复核记录。</p>
            <label>查看卡片<select aria-label="时间线卡片" value={timelineCard} onChange={event => setTimelineCard(event.target.value)}><option value="">这个文件的全部卡片</option>{[...new Map(timeline.map(item => [item.card.id, item.card])).values()].map(card => <option key={card.id} value={card.id}>{card.title}</option>)}</select></label>
            {history.length ? historyDays.map(day => <section className="knowledge-history-day" key={day}><h3>{day}</h3><ol className="knowledge-list">{history.filter(item => new Date(item.at).toLocaleDateString("zh-CN") === day).map((item, index) => <li key={`${item.card.id}-${item.kind}-${item.at}-${index}`} className="knowledge-timeline-item"><time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleTimeString("zh-CN")}</time><strong>{timelineDescription(item, members)}</strong><button className="knowledge-text-button" onClick={() => revealCard(item.card.id)}>{item.card.title}</button></li>)}</ol></section>) : <p className="empty-panel-state">这张卡片或这个文件还没有历史记录。</p>}
          </> : <>
            {view === "current" ? <p className="knowledge-hint">当前打开文件上有关联的知识卡片。</p> : null}
            <ol className="knowledge-list">{visibleCards.length === 0 ? <li className="empty-panel-state">{view === "current" ? "当前打开文件上还没有关联的知识卡片。选择代码后，可以创建关联知识。" : "没有符合筛选的知识。可以调整搜索条件，或新建一张卡片。"}</li> : visibleCards.map(renderCard)}</ol>
          </>}
        </div>
      </div>
      {formOpen ? <div className="knowledge-editor-backdrop">
        <div ref={editorRef} className="workspace-dialog knowledge-editor" role="dialog" aria-modal="true" aria-label="知识卡片编辑器" onKeyDown={event => {
          if (event.key === "Escape" && !saving) { event.stopPropagation(); closeForm(); }
          if (event.key === "Tab") {
            const controls = editorRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary');
            if (!controls?.length) return;
            const first = controls[0]!; const last = controls[controls.length - 1]!;
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}>
          <header className="workspace-dialog-heading"><h2>{editingCard ? "编辑知识卡片" : "新建知识卡片"}</h2><button type="button" aria-label="关闭卡片编辑器" disabled={saving} onClick={closeForm}><X size={16} /></button></header>
          <div ref={editorBodyRef} className="knowledge-editor-body">
            {pinSelection && !editingCard ? <div className="knowledge-editor-context"><p>这段知识关联到你刚才选中的代码</p><button className="knowledge-text-button" onClick={() => onOpenAnchor(pinSelection.file, { startLine: pinSelection.selection.startLineNumber, startColumn: pinSelection.selection.startColumn, endLine: pinSelection.selection.endLineNumber, endColumn: pinSelection.selection.endColumn })}>{pinSelection.file}:{pinSelection.selection.startLineNumber}–{pinSelection.selection.endLineNumber}</button></div> : null}
            {editorNotice ? <p className="knowledge-notice" role="status">{editorNotice}</p> : null}
            {formError ? <p className="knowledge-error" role="alert">{formError}</p> : null}
            {editingCard?.fallback || draftEvidence?.ai?.fallback ? <p className="knowledge-error" role="alert">模型未能生成规则，请人工填写</p> : null}
            <fieldset disabled={saving} className="knowledge-editor-fields">
              <label>标题<input ref={titleRef} value={title} onChange={event => setTitle(event.target.value)} placeholder="标题" /></label>
              <label>摘要<input value={summary} onChange={event => setSummary(event.target.value)} placeholder="摘要" /></label>
              <label>正文<textarea value={content} onChange={event => setContent(event.target.value)} placeholder="正文 Markdown" /></label>
              {removeKnowledgeEvidenceBlocks(content) !== content.trim() ? <div className="knowledge-clean-content"><p>正文包含证据章节。可以清理正文，并在保存前核对保留的知识。</p><div className="workspace-dialog-actions"><button type="button" onClick={() => setContent(removeKnowledgeEvidenceBlocks(content))}>清理正文中的证据块</button></div></div> : null}
              <label>类型<select value={type} onChange={event => setType(event.target.value as KnowledgeCardType)} aria-label="卡片类型">{Object.entries(knowledgeTypes).map(([value, entry]) => <option key={value} value={value}>{entry.label}</option>)}</select></label>
              <label>标签<input value={tags} onChange={event => setTags(event.target.value)} placeholder="标签，用逗号分隔" /></label>
              <label>作用域<select value={scope} onChange={event => setScope(event.target.value as KnowledgeScope)} aria-label="作用域"><option value="personal">个人</option><option value="team" disabled={Boolean(editingCard && editingCard.scope !== "team")}>团队</option>{editingCard?.scope === "proposedTeam" ? <option value="proposedTeam">待确认</option> : null}</select></label>
              {editingCard?.status === "draft" ? <label>卡片作者<select value={authorMemberId} onChange={event => setAuthorMemberId(event.target.value)} aria-label="卡片作者">{members.map(member => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label> : null}
            </fieldset>
            {editingCard ? <section className="knowledge-editor-anchors"><strong>关联代码</strong>{editingCard.anchors.length ? editingCard.anchors.map(anchor => <button className="knowledge-text-button" key={anchor.anchorId} onClick={() => onOpenAnchor(anchor.file.workspaceRelativePath)}>{anchor.file.workspaceRelativePath}</button>) : <p>这张卡片没有代码锚点。</p>}<p className="knowledge-hint">需要重新关联时，请在卡片详情中使用当前选区。</p></section> : null}
            {draftEvidence ? <aside className="knowledge-draft-evidence">
              <details><summary>原始证据</summary><pre>{JSON.stringify(draftEvidence.evidence, null, 2)}</pre></details>
              <strong>建议锚点</strong>{draftEvidence.suggestedAnchors?.map((anchor, index) => <label className="knowledge-check-label" key={index}><input type="checkbox" disabled={saving} checked={selectedAnchors.includes(index)} onChange={event => { anchorSelectionChangedRef.current = true; setSelectedAnchors(items => event.target.checked ? [...items, index] : items.filter(item => item !== index)); }} />{anchor.file}:{anchor.startLine}–{anchor.endLine}<span>{anchor.reasons.join("、")}</span></label>)}
              {readDispute(draftEvidence.evidence) ? <p>{members.find(member => member.id === readDispute(draftEvidence.evidence)?.memberId)?.displayName ?? "成员"}的意见：{readDispute(draftEvidence.evidence)?.reason}</p> : null}
            </aside> : null}
          </div>
          <footer className="workspace-dialog-actions"><button type="button" disabled={saving} onClick={closeForm}>取消</button><button className="primary" type="button" disabled={saving || !title.trim() || !summary.trim()} onClick={() => void submit()}>{saving ? <><LoaderCircle className="loading-icon" size={14} />保存中</> : editingCard?.status === "draft" ? "确认并保存" : "保存"}</button></footer>
        </div>
      </div> : null}
    </section>
  );
}

function KnowledgeCardItem({
  card,
  expanded,
  memberId,
  members,
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
  onDeferTeam,
  onCopyLink,
  onRelate,
  relatedCards,
  onOpenRelatedCard,
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
  members: import("../types").RoomMember[];
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
  onDeferTeam(): void;
  onCopyLink(): void;
  onRelate?(): void;
  relatedCards: KnowledgeCard[];
  onOpenRelatedCard(id: string): void;
  relationCandidates?: KnowledgeCard[];
  relationKind?: "contradicts" | "supersedes" | "duplicates" | "refines";
  relationTarget?: string;
  onRelationKindChange?(value: "contradicts" | "supersedes" | "duplicates" | "refines"): void;
  onRelationTargetChange?(value: string): void;
  onOpenAnchor(path: string, range?: { startLine: number; startColumn: number; endLine: number; endColumn: number }): void;
}) {
  const canManage = Boolean(memberId && (card.ownerMemberId === memberId || card.review?.confirmedBy.includes(memberId)));
  const TypeIcon = knowledgeTypes[card.type].icon;
  return (
    <li className={`knowledge-card knowledge-card-${card.type}`} data-card-id={card.id}>
      <button type="button" className="knowledge-card-summary" onClick={onToggle} aria-expanded={expanded}>
        <span className="knowledge-card-title"><span className="knowledge-type-icon" title={`${knowledgeTypes[card.type].label} (${card.type})`}><TypeIcon size={16} /></span><strong>{card.title}</strong></span>
        <span className="knowledge-card-description">{card.summary}</span>
      </button>
      <div className="knowledge-card-metadata">
        <div className="knowledge-card-badges"><span className="knowledge-badge knowledge-type-badge" title={card.type}>{knowledgeTypes[card.type].label}</span><span className="knowledge-badge">{knowledgeScopes[card.scope ?? "team"]}</span><span className={`knowledge-badge status-${card.status}`}>{knowledgeStatuses[card.status]}</span></div>
        <dl className="knowledge-card-facts">
          <div><dt>作者</dt><dd>{card.provenance?.author.displayName ?? card.metadata?.createdBy?.name ?? "未知成员"}</dd></div>
          <div><dt>确认人</dt><dd>{card.review?.confirmedBy.length ? card.review.confirmedBy.map(id => members.find(member => member.id === id)?.displayName ?? "成员").join("、") : "尚未确认"}</dd></div>
          <div><dt>更新时间</dt><dd><time dateTime={new Date(card.updatedAt).toISOString()}>{new Date(card.updatedAt).toLocaleString("zh-CN")}</time></dd></div>
        </dl>
      </div>
      <div className="knowledge-card-actions workspace-dialog-actions">
        {canManage ? <button type="button" disabled={actionPending} onClick={onEdit}>编辑</button> : null}
        {canManage && card.status !== "archived" ? <button type="button" disabled={actionPending} onClick={onArchive}>{actionPending ? "处理中" : "归档"}</button> : null}
        <button type="button" onClick={onCopyLink}><Link2 size={13} />复制链接</button>
        <button type="button" onClick={onToggle}>{expanded ? "收起详情" : "查看锚点"}</button>
      </div>
      {expanded ? (
        <div className="knowledge-card-content">
          <p className="knowledge-card-body">{card.content}</p>
          {card.appliesTo ? <p className="knowledge-hint">适用范围：{card.appliesTo.kind === "project" ? "整个项目" : card.appliesTo.patterns.join("、")}</p> : null}
          {card.relations?.length ? <section aria-label="已建立的知识关系"><strong>已建立的知识关系</strong><ul>{card.relations.map(relation => {
            const target = relatedCards.find(candidate => candidate.id === relation.cardId);
            return <li key={`${relation.kind}-${relation.cardId}`}><span>{{ contradicts: "存在矛盾，尚未裁决", supersedes: "替代以下知识", duplicates: "内容重复", refines: "补充以下知识" }[relation.kind]}：</span><button className="knowledge-text-button" disabled={!target} onClick={() => onOpenRelatedCard(relation.cardId)}>{target?.title ?? relation.cardId}</button></li>;
          })}</ul></section> : null}
          {card.provenance ? <details><summary>来源记录</summary><pre>{JSON.stringify(card.provenance.evidenceRefs, null, 2)}</pre></details> : null}
          {card.anchors.length === 0 ? <small>无代码锚点</small> : card.anchors.map((anchor, index) => {
            const resolution = resolutions.find((candidate) => candidate.anchorIndex === index);
            const canReanchor = currentSelection && normalizeKnowledgePath(currentSelection.file) === normalizeKnowledgePath(anchor.file.workspaceRelativePath) && resolution?.status === "needsReview" && canManage;
            return (
              <div className="knowledge-anchor-row" key={anchor.anchorId}>
                <button type="button" onClick={() => onOpenAnchor(anchor.file.workspaceRelativePath, resolution?.range)}><FileText size={13} aria-hidden="true" />{anchor.file.workspaceRelativePath}</button>
                <small>{resolution?.status === "needsReview" ? "需要重新关联" : resolution?.status === "moved" ? "已跟随代码移动" : resolution?.status === "ok" ? "已定位" : "尚未解析"}</small>
                {canReanchor ? <button type="button" disabled={actionPending} onClick={() => onReanchor(index)}>用当前选区重新锚定</button> : null}
              </div>
            );
          })}
          <div className="knowledge-card-actions workspace-dialog-actions">
            {card.status === "draft" ? <button type="button" disabled={actionPending} onClick={onConfirm}>确认</button> : null}
            {card.scope === "personal" && card.status === "reviewed" && card.ownerMemberId === memberId && onRequestTeam ? <button type="button" disabled={actionPending} onClick={onRequestTeam}>{actionPending ? "申请中" : "申请团队确认"}</button> : null}
            {card.scope === "proposedTeam" && card.ownerMemberId !== memberId && onConfirmTeam ? <><button className="primary" type="button" disabled={actionPending} onClick={onConfirmTeam}>{actionPending ? "确认中" : "确认升级为团队卡片"}</button><button type="button" disabled={actionPending} onClick={onDeferTeam}>暂不确认</button></> : null}
          </div>
          {card.scope === "team" && card.status === "reviewed" && relationCandidates?.length && onRelate && onRelationKindChange && onRelationTargetChange ? <div className="knowledge-card-relations workspace-dialog-actions">
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

function matchesSuggestedAnchor(anchor: KnowledgeCard["anchors"][number], suggestion: import("../types").SuggestedKnowledgeAnchor) {
  return normalizeKnowledgePath(anchor.file.workspaceRelativePath) === normalizeKnowledgePath(suggestion.file)
    && anchor.rangeAtCapture?.start.line === suggestion.startLine - 1
    && anchor.rangeAtCapture?.end.line === suggestion.endLine - 1;
}

function readDispute(evidence: Record<string, unknown>) {
  const dispute = evidence.dispute as { memberId?: string; reason?: string } | undefined;
  return dispute && typeof dispute.memberId === "string" && typeof dispute.reason === "string" ? dispute : undefined;
}
