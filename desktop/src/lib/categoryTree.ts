import type { Category, CategoryTreeNode } from '../types/category'

/**
 * Builds a stable category tree without losing malformed/orphaned data. Cycles
 * and missing parents are surfaced as roots so an administrator can repair them.
 */
export function buildCategoryTree(categories: Category[]): CategoryTreeNode[] {
  const nodes = new Map<string, CategoryTreeNode>()
  const linkedIds = new Set<string>()

  for (const category of categories) {
    nodes.set(category.id, { category, children: [] })
  }

  const roots: CategoryTreeNode[] = []
  for (const category of categories) {
    const node = nodes.get(category.id)
    const parentId = category.parentId
    const parent = parentId ? nodes.get(parentId) : undefined

    // Linking an item to itself or to an already-linked chain would hide it in a cycle.
    if (!node || !parent || !parentId || parentId === category.id || wouldCreateCycle(nodes, category.id, parentId)) {
      roots.push(node!)
      continue
    }

    parent.children.push(node)
    linkedIds.add(category.id)
  }

  // A fully cyclic group has no natural root. Keep it visible and editable.
  for (const category of categories) {
    const node = nodes.get(category.id)!
    if (!linkedIds.has(category.id) && !roots.includes(node)) roots.push(node)
  }

  sortTree(roots)
  return roots
}

function wouldCreateCycle(nodes: Map<string, CategoryTreeNode>, childId: string, parentId: string): boolean {
  let currentId: string | null = parentId
  const visited = new Set<string>()

  while (currentId && !visited.has(currentId)) {
    if (currentId === childId) return true
    visited.add(currentId)
    currentId = nodes.get(currentId)?.category.parentId ?? null
  }

  return false
}

function sortTree(nodes: CategoryTreeNode[]): void {
  nodes.sort((left, right) => left.category.name.localeCompare(right.category.name, undefined, { sensitivity: 'base' }))
  nodes.forEach((node) => sortTree(node.children))
}

export interface FlattenedCategory {
  category: Category
  depth: number
}

export function flattenCategoryTree(nodes: CategoryTreeNode[], depth = 0): FlattenedCategory[] {
  return nodes.flatMap((node) => [
    { category: node.category, depth },
    ...flattenCategoryTree(node.children, depth + 1),
  ])
}

/** Returns all descendants; useful for excluding invalid parents while editing a category. */
export function getDescendantIds(categories: Category[], categoryId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>()
  for (const category of categories) {
    if (!category.parentId) continue
    const children = childrenByParent.get(category.parentId) ?? []
    children.push(category.id)
    childrenByParent.set(category.parentId, children)
  }

  const descendants = new Set<string>()
  const visit = (parentId: string) => {
    for (const childId of childrenByParent.get(parentId) ?? []) {
      if (descendants.has(childId)) continue
      descendants.add(childId)
      visit(childId)
    }
  }
  visit(categoryId)
  return descendants
}
