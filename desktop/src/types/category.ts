export interface Category {
  id: string
  name: string
  parentId: string | null
  description: string
  isActive: boolean
}

export interface CategoryInput {
  name: string
  parentId: string | null
  description: string
  isActive: boolean
}

export interface CategoryTreeNode {
  category: Category
  children: CategoryTreeNode[]
}
