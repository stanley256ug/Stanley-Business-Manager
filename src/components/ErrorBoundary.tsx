import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'An unexpected error occurred.' };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Application ErrorBoundary caught:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0B1D3A] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">Application Recovery</h2>
            <p className="text-sm text-slate-600">
              STANLEY BUSINESS MANAGER encountered a runtime error. Your locally saved data remains
              safe.
            </p>
            <pre className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-red-700 overflow-x-auto max-h-36">
              {this.state.message}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-10 px-4 rounded-lg bg-[#0B1D3A] text-white text-sm font-semibold cursor-pointer"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
