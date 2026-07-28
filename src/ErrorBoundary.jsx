import React from 'react';

export class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled application error', { error, componentStack: info.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen grid place-items-center bg-gray-50 p-6">
          <section className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <h1 className="text-xl font-bold text-gray-900">Something went wrong</h1>
            <p className="mt-2 text-sm text-gray-600">Reload the page to try again. If the problem continues, contact support.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white"
            >
              Reload
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
