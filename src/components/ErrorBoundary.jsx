import * as Sentry from "@sentry/react";

function getSafePathname() {
  if (typeof window === "undefined") return "unknown";
  return window.location.pathname || "/";
}

function MinimalFallback({ resetErrorBoundary }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#0a0c0f",
        color: "#e8eaed",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          border: "1px solid #1e2329",
          borderRadius: 12,
          background: "#111418",
          padding: 20,
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          Something went wrong.
        </div>
        <div style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.5 }}>
          Reload the page to try again.
        </div>
        <button
          type="button"
          onClick={() => {
            resetErrorBoundary();
            window.location.reload();
          }}
          style={{
            marginTop: 16,
            border: "1px solid #2d3440",
            borderRadius: 8,
            background: "#0a0c0f",
            color: "#e8eaed",
            padding: "10px 14px",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

export default function ErrorBoundary({ children }) {
  return (
    <Sentry.ErrorBoundary
      fallback={({ resetErrorBoundary }) => (
        <MinimalFallback resetErrorBoundary={resetErrorBoundary} />
      )}
      beforeCapture={(scope, error, componentStack) => {
        const pathname = getSafePathname();
        scope.setTag("error_boundary", "global");
        scope.setTag("pathname", pathname);
        scope.setContext("route", { pathname });
        scope.setContext("react", {
          componentStack: componentStack || undefined,
        });
        scope.setContext("error_boundary", {
          pathname,
          hasComponentStack: Boolean(componentStack),
          errorType: error instanceof Error ? error.name : typeof error,
        });
      }}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
