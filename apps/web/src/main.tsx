import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

type StartupBoundaryState = { error: Error | null };

class StartupBoundary extends React.Component<React.PropsWithChildren, StartupBoundaryState> {
  state: StartupBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): StartupBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("FamilyHub failed to render", error, info);
  }

  private clearAppCacheAndReload = async () => {
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith("familyhub-")).map(key => caches.delete(key)));
      }
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(registration => registration.unregister()));
      }
    } finally {
      location.reload();
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main style={{ maxWidth: 640, margin: "48px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1>FamilyHub could not start</h1>
        <p>Your saved FamilyHub data has not been erased. The app hit a startup error instead of showing the normal interface.</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button onClick={() => location.reload()}>Reload</button>
          <button onClick={this.clearAppCacheAndReload}>Clear app cache and reload</button>
        </div>
      </main>
    );
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: "none" })
      .then(registration => registration.update())
      .catch(error => console.warn("FamilyHub offline support unavailable", error));
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StartupBoundary>
      <App />
    </StartupBoundary>
  </React.StrictMode>
);
