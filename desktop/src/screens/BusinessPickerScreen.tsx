import { BrandMark } from '../components/BrandMark'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'

export function BusinessPickerScreen() {
  const { user, signOut } = useAuth()
  const { businesses, selectBusiness } = useBusiness()

  return (
    <main className="picker-layout">
      <header className="top-header">
        <BrandMark />
        <div className="account-menu">
          <span className="avatar">{(user?.displayName ?? user?.email ?? 'U').slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user?.displayName ?? 'Signed in'}</strong>
            <span>{user?.email}</span>
          </div>
          <button className="text-button" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <section className="picker-content">
        <div className="eyebrow">SELECT SHOWROOM</div>
        <h1>Which business would you like to view?</h1>
        <p>Choose a showroom. You can switch businesses again from the desktop dashboard.</p>

        <div className="business-grid">
          {businesses.map((business) => (
            <button className="business-card" type="button" key={business.id} onClick={() => selectBusiness(business.id)}>
              <span className="business-icon" aria-hidden="true">⌂</span>
              <span className="business-card-copy">
                <strong>{business.name}</strong>
                <small>{business.address ?? business.phone ?? business.gstin ?? 'Showroom management workspace'}</small>
              </span>
              <span className="business-arrow" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}
