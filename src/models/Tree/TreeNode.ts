export class TreeNode {
  public id: string;
  public name: string;
  public children: TreeNode[] = [];
  public parent: TreeNode | null = null;
  public componentId: string; // Reference to the actual component
  public type?: string; // Equipment, Port, etc.

  constructor(
    id: string,
    name: string,
    componentId: string,
    type?: string
  ) {
    this.id = id;
    this.name = name;
    this.componentId = componentId;
    this.type = type;
  }

  // Add a child node
  addChild(child: TreeNode): void {
    if (!this.children.includes(child)) {
      this.children.push(child);
      child.parent = this;
    }
  }

  // Remove a child node
  removeChild(child: TreeNode): void {
    const index = this.children.indexOf(child);
    if (index > -1) {
      this.children.splice(index, 1);
      child.parent = null;
    }
  }

  // Check if this node has children
  get hasChildren(): boolean {
    return this.children.length > 0;
  }

  // Get all descendant nodes
  getAllDescendants(): TreeNode[] {
    const descendants: TreeNode[] = [];
    for (const child of this.children) {
      descendants.push(child);
      descendants.push(...child.getAllDescendants());
    }
    return descendants;
  }

  // Find a node by component ID in this subtree
  findByComponentId(componentId: string): TreeNode | null {
    if (this.componentId === componentId) return this;
    
    for (const child of this.children) {
      const found = child.findByComponentId(componentId);
      if (found) return found;
    }
    return null;
  }
}