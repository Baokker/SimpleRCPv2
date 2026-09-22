import type { WorkspaceNode } from "./types";

export function activeDirectoryPrefix(path: string | undefined) {
  if (!path?.includes("/")) return "";
  return `${path.slice(0, path.lastIndexOf("/") + 1)}`;
}

export function setDirectoryChildren(
  nodes: WorkspaceNode[],
  path: string,
  children: WorkspaceNode[]
): WorkspaceNode[] {
  if (!path) return children;
  return nodes.map((node) => {
    if (node.type !== "directory") return node;
    if (node.path === path) return { ...node, children };
    if (!node.children) return node;
    return {
      ...node,
      children: setDirectoryChildren(node.children, path, children)
    };
  });
}

export function composeWorkspaceTree(
  nodes: WorkspaceNode[],
  directories: Map<string, WorkspaceNode[]>
): WorkspaceNode[] {
  return nodes.map((node) => {
    if (node.type !== "directory") return node;
    const children = directories.get(node.path);
    return children
      ? { ...node, children: composeWorkspaceTree(children, directories) }
      : node;
  });
}

export function addAncestorDirectories(
  directories: Set<string>,
  path: string
) {
  const parts = path.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    directories.add(parts.slice(0, index).join("/"));
  }
}

export function remapLoadedDirectories(
  directories: Set<string>,
  fromPath: string,
  toPath: string
) {
  return new Set(
    [...directories].map((directory) =>
      directory === fromPath || directory.startsWith(`${fromPath}/`)
        ? `${toPath}${directory.slice(fromPath.length)}`
        : directory
    )
  );
}
