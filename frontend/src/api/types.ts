import type { components, operations, paths } from './schema.d.ts'

export type { components, operations, paths }

export type Schemas = components['schemas']

// Comunes (docs/04-api-interfaces.md / openapi.yaml)
export type Money = Schemas['Money']
export type Decimal = Schemas['Decimal']
export type Unit = Schemas['Unit']
export type Page = Schemas['Page']
export type ProblemCode = Schemas['ProblemCode']
export type Problem = Schemas['Problem']
export type FieldError = Schemas['FieldError']
export type Ref = Schemas['Ref']

// Auth & Members
export type RegisterOwnerRequest = Schemas['RegisterOwnerRequest']
export type LoginRequest = Schemas['LoginRequest']
export type RefreshRequest = Schemas['RefreshRequest']
export type AuthTokens = Schemas['AuthTokens']
export type Role = Schemas['Role']
export type Member = Schemas['Member']
export type MemberRef = Schemas['MemberRef']
export type CreateMemberRequest = Schemas['CreateMemberRequest']
export type UpdateMemberRequest = Schemas['UpdateMemberRequest']
export type Household = Schemas['Household']
export type UpdateHouseholdRequest = Schemas['UpdateHouseholdRequest']
export type Me = Schemas['Me']

// Catalog
export type Category = Schemas['Category']
export type CategoryInput = Schemas['CategoryInput']
export type Product = Schemas['Product']
export type ProductInput = Schemas['ProductInput']
export type ProductPage = Omit<Schemas['ProductPage'], 'content'> & { content: Product[] }

// Shopping lists
export type ShoppingListStatus = Schemas['ShoppingListStatus']
export type ShoppingList = Schemas['ShoppingList']
export type ShoppingListItem = Schemas['ShoppingListItem']
export type CompleteListRequest = Schemas['CompleteListRequest']
export type CompleteListItem = Schemas['CompleteListItem']
export type LeftoverAction = Schemas['LeftoverAction']
export type Purchase = Schemas['Purchase']
export type ShoppingListItemInput = Schemas['ShoppingListItemInput']
export type UpdateShoppingListItemRequest = Schemas['UpdateShoppingListItemRequest']
export type Suggestion = Schemas['Suggestion']
export type ShoppingListSummary = Schemas['ShoppingListSummary']
export type ShoppingListSummaryPage = Omit<Schemas['ShoppingListSummaryPage'], 'content'> & {
  content: ShoppingListSummary[]
}

// Stock
export type StockItem = Schemas['StockItem']
export type StockItemPage = Omit<Schemas['StockItemPage'], 'content'> & { content: StockItem[] }
export type StockAlerts = Schemas['StockAlerts']
export type ExpiryStatus = Schemas['ExpiryStatus']
export type CreateStockItemRequest = Schemas['CreateStockItemRequest']
