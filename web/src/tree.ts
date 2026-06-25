import type { ObjectInfo } from "./api";

export interface TreeNode {
  name: string; // display name (last path segment)
  path: string; // full key; dirs end with "/"
  isDir: boolean;
  children: TreeNode[];
}

// buildTree turns the backend's flat object list into a nested folder tree.
// Directories are inferred both from explicit dir entries and from note paths.
export function buildTree(items: ObjectInfo[]): TreeNode {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  const dirIndex = new Map<string, TreeNode>();
  dirIndex.set("", root);

  const ensureDir = (dirPath: string): TreeNode => {
    if (dirIndex.has(dirPath)) return dirIndex.get(dirPath)!;
    const trimmed = dirPath.replace(/\/$/, "");
    const slash = trimmed.lastIndexOf("/");
    const parentPath = slash >= 0 ? trimmed.slice(0, slash + 1) : "";
    const name = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
    const parent = ensureDir(parentPath);
    const node: TreeNode = {
      name,
      path: trimmed + "/",
      isDir: true,
      children: [],
    };
    parent.children.push(node);
    dirIndex.set(dirPath, node);
    return node;
  };

  for (const item of items) {
    if (item.isDir) {
      ensureDir(item.path.endsWith("/") ? item.path : item.path + "/");
      continue;
    }
    const slash = item.path.lastIndexOf("/");
    const parentPath = slash >= 0 ? item.path.slice(0, slash + 1) : "";
    const name = slash >= 0 ? item.path.slice(slash + 1) : item.path;
    const parent = ensureDir(parentPath);
    parent.children.push({
      name,
      path: item.path,
      isDir: false,
      children: [],
    });
  }

  sortNode(root);
  return root;
}

function sortNode(node: TreeNode) {
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; // dirs first
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
  node.children.forEach(sortNode);
}
