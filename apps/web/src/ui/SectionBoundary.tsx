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
      <h1 id="section-load-error-title">Section indisponible</h1>
      <p>Impossible d’ouvrir {this.props.label}. Vérifiez votre connexion et réessayez.</p>
      <p>Vos données enregistrées sont conservées.</p>
      <div className="section-load-actions">
        <button type="button" className="button" onClick={() => location.reload()}><RefreshCw size={17} aria-hidden="true" />Réessayer</button>
        <button type="button" className="button secondary" onClick={this.props.onHome}><ArrowLeft size={17} aria-hidden="true" />Retour à l’accueil</button>
      </div>
    </section>;
  }
}
