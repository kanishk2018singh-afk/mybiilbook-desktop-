import { describe, expect, it } from 'vitest'
import { buildCategoryTree, flattenCategoryTree, getDescendantIds } from './categoryTree'
import type { Category } from '../types/category'

const categories: Category[] = [
  { id: 'sanitary', name: 'Sanitary', parentId: null, description: '', isActive: true },
  { id: 'western', name: 'Western WC', parentId: 'sanitary', description: '', isActive: true },
  { id: 'wall-hung', name: 'Wall Hung WC', parentId: 'western', description: '', isActive: true },
  { id: 'faucets', name: 'Faucets', parentId: null, description: '', isActive: true },
]

describe('category hierarchy helpers', () => {
  it('builds and flattens a nested category tree', () => {
    const tree = buildCategoryTree(categories)
    expect(tree.map((node) => node.category.id)).toEqual(['faucets', 'sanitary'])
    expect(tree[1].children[0].category.id).toBe('western')
    expect(tree[1].children[0].children[0].category.id).toBe('wall-hung')
    expect(flattenCategoryTree(tree).map(({ category, depth }) => `${depth}:${category.id}`)).toEqual([
      '0:faucets',
      '0:sanitary',
      '1:western',
      '2:wall-hung',
    ])
  })

  it('finds descendants so a category cannot become its own parent or child', () => {
    expect([...getDescendantIds(categories, 'sanitary')].sort()).toEqual(['wall-hung', 'western'])
  })

  it('keeps orphaned categories visible as roots', () => {
    const tree = buildCategoryTree([
      ...categories,
      { id: 'orphan', name: 'Orphan', parentId: 'does-not-exist', description: '', isActive: true },
    ])
    expect(tree.map((node) => node.category.id)).toContain('orphan')
  })
})
