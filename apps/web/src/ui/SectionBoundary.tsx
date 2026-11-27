import { Component, type ReactNode } from "react";
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";

type Props = { children: ReactNode; label: string; onHome: () => void };

/** A failed domain chunk must leave household navigation and saved state available. */
export default class SectionBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="today-empty section-load-error" role="alert" aria-labelledby="section-load-error-title">
      <AlertCircle size={28} aria-hidden="true" />
      <h1 id="section-load-error-title">Section unavailable</h1>
      <p>Could not open {this.props.label}. Check your connection and try again.</p>
      <p>Your saved data is preserved.</p>
      <div className="section-load-actions">
        <button type="button" className="button" onClick={() => location.reload()}><RefreshCw size={17} aria-hidden="true" />Try again</button>
        <button type="button" className="button secondary" onClick={this.props.onHome}><ArrowLeft size={17} aria-hidden="true" />Back to Today</button>
      </div>
    </section>;
  }
}
