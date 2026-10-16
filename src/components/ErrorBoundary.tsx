import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto mt-24 max-w-md rounded-lg border border-red-200 bg-white p-6 text-center">
          <h1 className="text-lg font-semibold text-red-700">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-600">
            The application hit an unexpected error. Reload the page to try again.
          </p>
          <button
            className="mt-4 rounded-md bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
