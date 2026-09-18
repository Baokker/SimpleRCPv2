import {
  ArrowLeft,
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
  canManageFiles,
  onOpenFile,
  onExpandDirectory,
  onCreateFile,
  onCreateFolder,
  onRenamePath,
  onDeletePath
}: {
  tree: WorkspaceNode[];
  activePath?: string;
  workspaceName: string;
  canManageFiles: boolean;
  onOpenFile(path: string): void;
  onExpandDirectory(path: string): void;
  onCreateFile(): void;
  onCreateFolder(): void;
  onRenamePath(path: string): void;
  onDeletePath(path: string): void;
}) {
  const activeAncestors = useMemo(() => getAncestorPaths(activePath), [activePath]);

  return (
    <div className="panel">
      <div className="panel-header explorer-header">
        <div className="explorer-title">
          <a
            href="/"
            aria-label="Back to projects"
            title="Projects"
            data-testid="projects-link"
          >
            <ArrowLeft size={15} />
          </a>
          <span title={workspaceName}>{workspaceName || "Workspace"}</span>
        </div>
        {canManageFiles ? <div className="icon-actions">
          <button
            aria-label="Create file by path"
            title="Create file by path"
            onClick={onCreateFile}
            data-testid="new-file"
          >
            <FilePlus2 size={15} />
          </button>
          <button
            aria-label="Create folder by path"
            title="Create folder by path"
            onClick={onCreateFolder}
            data-testid="new-folder"
          >
            <FolderPlus size={15} />
          </button>
        </div> : null}
      </div>
      <div className="tree" data-testid="workspace-tree">
        {tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            activePath={activePath}
            activeAncestors={activeAncestors}
            canManageFiles={canManageFiles}
            onOpenFile={onOpenFile}
            onExpandDirectory={onExpandDirectory}
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
  canManageFiles,
  onOpenFile,
  onExpandDirectory,
  onRenamePath,
  onDeletePath
}: {
  node: WorkspaceNode;
  activePath?: string;
  activeAncestors: Set<string>;
  canManageFiles: boolean;
  onOpenFile(path: string): void;
  onExpandDirectory(path: string): void;
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
            onClick={() => {
              if (!isOpen && node.children === undefined) {
                onExpandDirectory(node.path);
              }
              setIsOpen((value) => !value);
            }}
            data-testid={`dir-${node.path}`}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {isOpen ? <FolderOpen size={15} /> : <FolderClosed size={15} />}
            <span>{node.name}</span>
          </button>
          {canManageFiles ? <TreeActions
            path={node.path}
            onRenamePath={onRenamePath}
            onDeletePath={onDeletePath}
          /> : null}
        </div>
        {isOpen ? (
          <div className="tree-children">
            {(node.children ?? []).map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                activePath={activePath}
                activeAncestors={activeAncestors}
                canManageFiles={canManageFiles}
                onOpenFile={onOpenFile}
                onExpandDirectory={onExpandDirectory}
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
      {canManageFiles ? <TreeActions
        path={node.path}
        onRenamePath={onRenamePath}
        onDeletePath={onDeletePath}
      /> : null}
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
