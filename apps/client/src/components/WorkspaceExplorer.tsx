import type { WorkspaceNode } from "../types";

export function WorkspaceExplorer({
  tree,
  activePath,
  onOpenFile
}: {
  tree: WorkspaceNode[];
  activePath?: string;
  onOpenFile(path: string): void;
}) {
  return (
    <div className="panel">
      <div className="panel-header">Workspace</div>
      <div className="tree" data-testid="workspace-tree">
        {tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            activePath={activePath}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  activePath,
  onOpenFile
}: {
  node: WorkspaceNode;
  activePath?: string;
  onOpenFile(path: string): void;
}) {
  if (node.type === "directory") {
    return (
      <details open className="tree-directory">
        <summary>{node.name}</summary>
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              activePath={activePath}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      </details>
    );
  }

  return (
    <button
      className={node.path === activePath ? "tree-file active" : "tree-file"}
      onClick={() => onOpenFile(node.path)}
      data-testid={`file-${node.path}`}
    >
      {node.name}
    </button>
  );
}
