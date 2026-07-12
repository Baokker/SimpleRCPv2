import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FilePlus2,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { WorkspaceNode } from "../types";

export function WorkspaceExplorer({
  tree,
  activePath,
  workspaceName,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onRenamePath,
  onDeletePath
}: {
  tree: WorkspaceNode[];
  activePath?: string;
  workspaceName: string;
  onOpenFile(path: string): void;
  onCreateFile(): void;
  onCreateFolder(): void;
  onRenamePath(path: string): void;
  onDeletePath(path: string): void;
}) {
  const activeAncestors = useMemo(() => getAncestorPaths(activePath), [activePath]);

  return (
    <div className="panel">
      <div className="panel-header explorer-header">
        <span title={workspaceName}>{workspaceName || "Workspace"}</span>
        <div className="icon-actions">
          <button
            aria-label="New file"
            title="New file"
            onClick={onCreateFile}
            data-testid="new-file"
          >
            <FilePlus2 size={15} />
          </button>
          <button
            aria-label="New folder"
            title="New folder"
            onClick={onCreateFolder}
            data-testid="new-folder"
          >
            <FolderPlus size={15} />
          </button>
        </div>
      </div>
      <div className="tree" data-testid="workspace-tree">
        {tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            activePath={activePath}
            activeAncestors={activeAncestors}
            onOpenFile={onOpenFile}
            onRenamePath={onRenamePath}
            onDeletePath={onDeletePath}
          />
        ))}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  activePath,
  activeAncestors,
  onOpenFile,
  onRenamePath,
  onDeletePath
}: {
  node: WorkspaceNode;
  activePath?: string;
  activeAncestors: Set<string>;
  onOpenFile(path: string): void;
  onRenamePath(path: string): void;
  onDeletePath(path: string): void;
}) {
  const shouldRevealActivePath = activeAncestors.has(node.path);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (shouldRevealActivePath) setIsOpen(true);
  }, [shouldRevealActivePath]);

  if (node.type === "directory") {
    return (
      <div className="tree-directory">
        <div className="tree-row directory-row">
          <button
            className="tree-entry"
            aria-expanded={isOpen}
            onClick={() => setIsOpen((value) => !value)}
            data-testid={`dir-${node.path}`}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {isOpen ? <FolderOpen size={15} /> : <FolderClosed size={15} />}
            <span>{node.name}</span>
          </button>
          <TreeActions
            path={node.path}
            onRenamePath={onRenamePath}
            onDeletePath={onDeletePath}
          />
        </div>
        {isOpen ? (
          <div className="tree-children">
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                activePath={activePath}
                activeAncestors={activeAncestors}
                onOpenFile={onOpenFile}
                onRenamePath={onRenamePath}
                onDeletePath={onDeletePath}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={node.path === activePath ? "tree-row active" : "tree-row"}>
      <button
        className="tree-entry file-entry"
        onClick={() => onOpenFile(node.path)}
        data-testid={`file-${node.path}`}
      >
        <span className="tree-indent" />
        <FileCode2 size={15} />
        <span>{node.name}</span>
      </button>
      <TreeActions
        path={node.path}
        onRenamePath={onRenamePath}
        onDeletePath={onDeletePath}
      />
    </div>
  );
}

function getAncestorPaths(path: string | undefined) {
  const ancestors = new Set<string>();
  if (!path) return ancestors;
  const parts = path.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    ancestors.add(parts.slice(0, index).join("/"));
  }
  return ancestors;
}

function TreeActions({
  path,
  onRenamePath,
  onDeletePath
}: {
  path: string;
  onRenamePath(path: string): void;
  onDeletePath(path: string): void;
}) {
  return (
    <span className="tree-actions">
      <button
        aria-label={`Rename ${path}`}
        title="Rename"
        onClick={() => onRenamePath(path)}
        data-testid={`rename-${path}`}
      >
        <Pencil size={13} />
      </button>
      <button
        aria-label={`Delete ${path}`}
        title="Delete"
        onClick={() => onDeletePath(path)}
        data-testid={`delete-${path}`}
      >
        <Trash2 size={13} />
      </button>
    </span>
  );
}
