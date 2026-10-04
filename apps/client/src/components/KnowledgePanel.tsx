import { useEffect, useState } from "react";
import type {
  KnowledgeCard,
  KnowledgeCardType,
  KnowledgeGuideItem,
  KnowledgeScope,
  KnowledgeTimelineItem,
  KnowledgeAnchorResolution
} from "../types";

type View = "current" | "all" | "guide" | "timeline";
type Selection = { file: string; selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } };
type CardInput = { type: KnowledgeCardType; title: string; summary: string; content: string; tags: string[]; scope: KnowledgeScope };

export function KnowledgePanel({
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
  onConfirm(id: string): Promise<void>;
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

  useEffect(() => {
    if (!pinSelection) return;
    openCreate();
  }, [pinSelection]);

  const currentCards = activePath
    ? cards.filter((card) => card.anchors.some((anchor) => anchor.file.workspaceRelativePath === activePath))
    : cards;
  const visibleCards = view === "current" ? currentCards : view === "all" ? cards : [];

  function openCreate() {
    setEditingCard(undefined);
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
    setTitle(card.title);
    setSummary(card.summary);
    setContent(card.content);
    setTags(card.tags.join(", "));
    setType(card.type);
    setScope(card.scope === "personal" ? "personal" : "team");
    setFormError(undefined);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingCard(undefined);
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
      scope: scope === "personal" ? "personal" : "team"
    };
    try {
      if (editingCard) await onUpdate(editingCard.id, input);
      else await onCreate(input);
      closeForm();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function confirm(card: KnowledgeCard) {
    setActionCardId(card.id);
    setFormError(undefined);
    try {
      await onConfirm(card.id);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionCardId(undefined);
    }
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
      onToggle={() => setExpanded(expanded === card.id ? undefined : card.id)}
      onEdit={() => openEdit(card)}
      onConfirm={() => void confirm(card)}
      onArchive={() => void archive(card)}
      onReanchor={(index) => void reanchor(card, index)}
      onOpenAnchor={onOpenAnchor}
    />
  );

  return (
    <section className="knowledge-panel" data-testid="knowledge-panel">
      <div className="knowledge-toolbar">
        {(["current", "all", "guide", "timeline"] as View[]).map((candidate) => (
          <button type="button" key={candidate} className={view === candidate ? "active" : ""} onClick={() => setView(candidate)}>
            {candidate === "current" ? "当前文件" : candidate === "all" ? "全部卡片" : candidate === "guide" ? "导览" : "时间线"}
          </button>
        ))}
      </div>
      <div className="knowledge-actions">
        <button type="button" onClick={openCreate}>新建卡片</button>
        <button type="button" onClick={() => void onGenerateDemo()}>生成 Demo</button>
      </div>
      {formError ? <p className="knowledge-error" role="alert">{formError}</p> : null}
      {view === "guide" ? (
        <ol className="knowledge-list">
          {guide.map((item) => renderCard(item.card))}
        </ol>
      ) : view === "timeline" ? (
        <ol className="knowledge-list">
          {timeline.map((item, index) => <li key={`${item.card.id}-${item.kind}-${item.at}-${index}`} className="knowledge-timeline-item"><time>{new Date(item.at).toLocaleString()}</time><span>{item.label}</span></li>)}
        </ol>
      ) : (
        <ol className="knowledge-list">
          {visibleCards.length === 0 ? <li className="empty-panel-state">暂无知识卡片</li> : visibleCards.map(renderCard)}
        </ol>
      )}
      {formOpen ? (
        <div className="knowledge-editor" role="dialog" aria-label="知识卡片编辑器">
          <h3>{editingCard ? "编辑知识卡片" : "知识卡片"}</h3>
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
          <select value={scope === "personal" ? "personal" : "team"} onChange={(event) => setScope(event.target.value as KnowledgeScope)} aria-label="作用域"><option value="team">团队</option><option value="personal">个人</option></select>
          <div><button type="button" onClick={closeForm}>取消</button><button type="button" disabled={saving || !title.trim() || !summary.trim()} onClick={() => void submit()}>保存</button></div>
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
            const canReanchor = currentSelection?.file === anchor.file.workspaceRelativePath && resolution?.status === "needsReview" && canManage;
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
            {canManage && card.status !== "archived" ? <button type="button" disabled={actionPending} onClick={onArchive}>归档</button> : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
