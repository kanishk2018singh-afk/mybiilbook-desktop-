import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { subscribeToBusinesses } from '../repositories/businessRepository'
import type { Business } from '../types/business'

type BusinessStatus = 'idle' | 'loading' | 'ready' | 'error'

interface BusinessContextValue {
  businesses: Business[]
  selectedBusinessId: string | null
  selectedBusiness: Business | null
  status: BusinessStatus
  error: string | null
  selectBusiness: (businessId: string) => void
  clearBusinessSelection: () => void
}

const BusinessContext = createContext<BusinessContextValue | undefined>(undefined)

function readableFirestoreError(error: Error): string {
  if (error.message.includes('permission-denied')) {
    return 'You do not have permission to read businesses for this account.'
  }
  return error.message || 'Businesses could not be loaded from Firestore.'
}

export function BusinessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null)
  const [status, setStatus] = useState<BusinessStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setBusinesses([])
    setSelectedBusinessId(null)
    setError(null)

    if (!user) {
      setStatus('idle')
      return
    }

    setStatus('loading')
    let active = true
    const unsubscribe = subscribeToBusinesses(
      user.uid,
      (nextBusinesses) => {
        if (!active) return
        setBusinesses(nextBusinesses)
        setSelectedBusinessId((currentBusinessId) => {
          if (currentBusinessId && nextBusinesses.some((business) => business.id === currentBusinessId)) {
            return currentBusinessId
          }
          // A single business needs no picker. Multiple businesses deliberately start at the picker.
          return nextBusinesses.length === 1 ? nextBusinesses[0].id : null
        })
        setStatus('ready')
      },
      (listenerError) => {
        if (!active) return
        setError(readableFirestoreError(listenerError))
        setStatus('error')
      },
    )

    return () => {
      active = false
      unsubscribe()
    }
  }, [user?.uid])

  const selectBusiness = useCallback(
    (businessId: string) => {
      if (!businesses.some((business) => business.id === businessId)) {
        throw new Error('The selected business is not available to this account.')
      }
      setSelectedBusinessId(businessId)
    },
    [businesses],
  )

  const clearBusinessSelection = useCallback(() => setSelectedBusinessId(null), [])

  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === selectedBusinessId) ?? null,
    [businesses, selectedBusinessId],
  )

  const value = useMemo<BusinessContextValue>(
    () => ({
      businesses,
      selectedBusinessId,
      selectedBusiness,
      status,
      error,
      selectBusiness,
      clearBusinessSelection,
    }),
    [businesses, clearBusinessSelection, error, selectBusiness, selectedBusiness, selectedBusinessId, status],
  )

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>
}

export function useBusiness(): BusinessContextValue {
  const context = useContext(BusinessContext)
  if (!context) throw new Error('useBusiness must be used inside BusinessProvider')
  return context
}
