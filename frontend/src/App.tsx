import React, { useState, useEffect } from 'react'
import { Activity, Database, RefreshCw, CheckCircle2, AlertTriangle, Server } from 'lucide-react'

interface HealthResponse {
  status: string;
  db: string;
}

function App() {
  const [healthData, setHealthData] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = async () => {
    setLoading(true)
    setError(null)
    try {
      // In local dev, Vite proxies /api/* to http://backend:8000/*
      const response = await fetch('/api/health')
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data: HealthResponse = await response.json()
      setHealthData(data)
    } catch (e: any) {
      console.error("Failed to fetch health check", e)
      setError(e.message || "Backend server is unreachable")
      setHealthData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHealth()
  }, [])

  const apiStatus = healthData?.status === 'healthy' ? 'healthy' : error ? 'unreachable' : 'loading'
  const dbStatus = healthData ? healthData.db : error ? 'disconnected' : 'loading'

  return (
    <div>
      <header style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <span style={{ fontSize: '2.5rem' }}>⚡</span>
          <h1 style={{ margin: 0, fontSize: '3rem', fontWeight: 800 }}>CodePulse</h1>
        </div>
        <div className="subtitle">
          Phase 1: Multi-tenant scaffolding & system health verification skeleton.
        </div>
      </header>

      <main>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
            <Server size={24} style={{ color: '#6366f1' }} />
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>System Control Panel</h2>
          </div>

          <div className="status-grid">
            {/* Backend API Box */}
            <div className={`status-item ${apiStatus === 'healthy' ? 'connected' : 'disconnected'}`}>
              <div className="status-label">API Service Status</div>
              <div className="status-value-wrapper">
                <span className={`dot ${
                  apiStatus === 'healthy' ? 'green' : 
                  apiStatus === 'unreachable' ? 'red' : 'yellow'
                }`} />
                <span className="status-value">
                  {apiStatus === 'healthy' && 'ONLINE'}
                  {apiStatus === 'unreachable' && 'UNREACHABLE'}
                  {apiStatus === 'loading' && 'CHECKING...'}
                </span>
              </div>
              <div style={{ marginTop: '1rem', color: '#64748b', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Activity size={14} />
                <span>FastAPI Service (Port 8000)</span>
              </div>
            </div>

            {/* PostgreSQL DB Box */}
            <div className={`status-item ${dbStatus === 'connected' ? 'connected' : 'disconnected'}`}>
              <div className="status-label">Database Connection</div>
              <div className="status-value-wrapper">
                <span className={`dot ${
                  dbStatus === 'connected' ? 'green' : 
                  dbStatus === 'disconnected' ? 'red' : 'yellow'
                }`} />
                <span className="status-value">
                  {dbStatus === 'connected' && 'CONNECTED'}
                  {dbStatus === 'disconnected' && 'OFFLINE'}
                  {dbStatus === 'loading' && 'CHECKING...'}
                </span>
              </div>
              <div style={{ marginTop: '1rem', color: '#64748b', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Database size={14} />
                <span>PostgreSQL DB (Port 5432)</span>
              </div>
            </div>
          </div>

          {/* Details / Logs section */}
          <div style={{ 
            marginTop: '2rem', 
            padding: '1.25rem', 
            borderRadius: '0.75rem', 
            background: 'rgba(0, 0, 0, 0.25)', 
            border: '1px solid rgba(255, 255, 255, 0.05)',
            textAlign: 'left'
          }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#94a3b8', marginBottom: '0.5rem' }}>
              System Response Payload
            </div>
            <pre style={{ 
              margin: 0, 
              fontFamily: 'monospace', 
              fontSize: '0.85rem', 
              color: error ? '#f87171' : '#34d399',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}>
              {loading ? (
                'Fetching latest telemetry...'
              ) : error ? (
                `Connection Error:\n${error}`
              ) : (
                JSON.stringify(healthData, null, 2)
              )}
            </pre>
          </div>

          {/* Information Alerts */}
          {dbStatus === 'disconnected' && apiStatus === 'healthy' && (
            <div style={{ 
              marginTop: '1.5rem', 
              padding: '1rem', 
              borderRadius: '0.75rem', 
              background: 'rgba(245, 158, 11, 0.1)', 
              border: '1px solid rgba(245, 158, 11, 0.2)',
              color: '#fbbf24',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              textAlign: 'left'
            }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>App partially healthy:</strong> FastAPI backend booted successfully, but could not connect to PostgreSQL. Verify that your DB credentials are correct and database container is running.
              </div>
            </div>
          )}

          {apiStatus === 'healthy' && dbStatus === 'connected' && (
            <div style={{ 
              marginTop: '1.5rem', 
              padding: '1rem', 
              borderRadius: '0.75rem', 
              background: 'rgba(20, 184, 166, 0.1)', 
              border: '1px solid rgba(20, 184, 166, 0.2)',
              color: '#2dd4bf',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              textAlign: 'left'
            }}>
              <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>All systems operational:</strong> Full connectivity established. Ready to begin Phase 2 (Tenant & Auth model).
              </div>
            </div>
          )}

          <button 
            className="btn-refresh" 
            onClick={fetchHealth} 
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spin-animation' : ''} style={{
              animation: loading ? 'spin 1s linear infinite' : 'none'
            }} />
            <span>{loading ? 'Refreshing...' : 'Refresh Status'}</span>
          </button>
        </div>
      </main>

      <footer className="footer">
        <p>CodePulse Control Plane • Built with FastAPI, React, TypeScript, and Docker</p>
      </footer>

      {/* Inject custom spin animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export default App
