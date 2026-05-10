"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          padding: "24px",
        }}>
          <h2 style={{ fontSize: "18px", marginBottom: "8px" }}>오류가 발생했습니다</h2>
          <p style={{ fontSize: "14px", color: "#64748d", marginBottom: "16px" }}>
            잠시 후 다시 시도해 주세요.
          </p>
          <button
            onClick={() => location.reload()}
            style={{
              padding: "10px 20px",
              borderRadius: "8px",
              background: "#1a56db",
              color: "white",
              border: "none",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            새로고침
          </button>
        </div>
      </body>
    </html>
  );
}
