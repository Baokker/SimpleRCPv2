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
            +
          </button>
          <button
            aria-label="New folder"
            title="New folder"
            onClick={onCreateFolder}
            data-testid="new-folder"
          >
            /
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
    if (shouldRevealActivePath) {
      setIsOpen(true);
    }
  }, [shouldRevealActivePath]);

  if (node.type === "directory") {
    return (
      <details
        open={isOpen}
        className="tree-directory"
        onToggle={(event) => setIsOpen(event.currentTarget.open)}
      >
        <summary data-testid={`dir-${node.path}`}>
          <span>{node.name}</span>
          <TreeActions
            path={node.path}
            onRenamePath={onRenamePath}
            onDeletePath={onDeletePath}
          />
        </summary>
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
      </details>
    );
  }

  return (
    <div className={node.path === activePath ? "tree-row active" : "tree-row"}>
      <button
        className="tree-file"
        onClick={() => onOpenFile(node.path)}
        data-testid={`file-${node.path}`}
      >
        {node.name}
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
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRenamePath(path);
        }}
        data-testid={`rename-${path}`}
      >
        r
      </button>
      <button
        aria-label={`Delete ${path}`}
        title="Delete"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDeletePath(path);
        }}
        data-testid={`delete-${path}`}
      >
        x
      </button>
    </span>
  );
}
