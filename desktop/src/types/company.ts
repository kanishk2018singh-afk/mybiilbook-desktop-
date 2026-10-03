export interface Company {
  id: string
  name: string
  description: string
  isDefault: boolean
}

export interface CompanyInput {
  name: string
  description: string
  isDefault: boolean
}
