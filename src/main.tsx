import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'

// 全局错误边界 — 捕获 React 渲染崩溃，避免空白页面
class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[MeetingRoom] 渲染崩溃:', error.message, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#f5f0e8', padding: 20,
        }}>
          <div style={{
            background: 'white', borderRadius: 8, padding: 32, maxWidth: 500,
            boxShadow: '0 2px 16px rgba(0,0,0,0.1)',
          }}>
            <h2 style={{ color: '#c0392b', marginBottom: 12 }}>⚠ 页面崩溃</h2>
            <p style={{ color: '#666', marginBottom: 16, fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' }}>
              {this.state.error.message}
            </p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload() }}
              style={{
                background: '#2c5f6e', color: 'white', border: 'none',
                padding: '10px 24px', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem',
              }}
            >
              重新加载
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
