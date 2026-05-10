import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "LawTax — 세무 법령 검색";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          color: "#f1f5f9",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              fontSize: "44px",
              fontWeight: 700,
              letterSpacing: "-1.5px",
              color: "#f1f5f9",
            }}
          >
            LawTax
          </div>
          <div
            style={{
              fontSize: "18px",
              fontWeight: 500,
              padding: "6px 14px",
              borderRadius: "999px",
              border: "1px solid #60a5fa",
              color: "#60a5fa",
            }}
          >
            BETA
          </div>
        </div>

        <div
          style={{
            fontSize: "76px",
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: "-2.4px",
            color: "#f1f5f9",
            marginBottom: "28px",
          }}
        >
          세무 쟁점,
          <br />
          법령 근거로 즉시 확인
        </div>

        <div
          style={{
            fontSize: "26px",
            fontWeight: 300,
            color: "#94a3b8",
            lineHeight: 1.4,
          }}
        >
          세무사를 위한 AI 법령 검색 도구
        </div>
      </div>
    ),
    { ...size },
  );
}
