"use client";

import { useState } from "react";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  function loginWithKakao() {
    setLoading(true);
    window.location.href = "/api/auth/kakao/login";
  }

  return (
    <div style={{
      minHeight: "100dvh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 24px",
      background: "var(--c-canvas)",
    }}>
      <div style={{
        width: "100%",
        maxWidth: "440px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "32px",
      }}>
        {/* ── Hero ── */}
        <div style={{ textAlign: "center" }}>
          <div style={{
            display: "inline-block",
            fontSize: "11px", fontWeight: 500,
            padding: "4px 10px",
            borderRadius: "20px",
            border: "1px solid var(--c-primary)",
            color: "var(--c-primary)",
            letterSpacing: "0.04em",
            marginBottom: "20px",
          }}>
            세무사 전용 BETA
          </div>
          <h1 style={{
            fontSize: "26px", fontWeight: 700,
            letterSpacing: "-0.4px",
            lineHeight: 1.25,
            color: "var(--c-ink)",
            marginBottom: "12px",
          }}>
            세무 쟁점,<br/>법령 근거로 즉시 확인
          </h1>
          <p style={{
            fontSize: "14px", fontWeight: 300,
            color: "var(--c-ink-mute)",
            lineHeight: 1.55,
          }}>
            세무사의 실무 질문에 결론·근거 조문·유의사항을<br/>
            구조화하여 즉시 답합니다.
          </p>
        </div>

        {/* ── Feature highlights ── */}
        <div style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          padding: "16px 20px",
          borderRadius: "12px",
          background: "var(--c-canvas-soft)",
          border: "1px solid var(--c-hairline)",
        }}>
          <Feature text="복잡한 세무 쟁점, 1분 안에 결론" />
          <Feature text="근거 명확한 답변으로 자신있는 고객 응대" />
          <Feature text="검토 누락 방지, 정확한 의사결정" />
        </div>

        {/* ── Login card ── */}
        <div style={{
          width: "100%",
          padding: "28px 24px",
          borderRadius: "14px",
          border: "1px solid var(--c-hairline)",
          background: "var(--c-canvas-soft)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}>
          <button
            onClick={loginWithKakao}
            disabled={loading}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              padding: "13px 20px",
              borderRadius: "10px",
              border: "none",
              background: "#FEE500",
              color: "#191919",
              fontSize: "14px",
              fontWeight: 500,
              cursor: loading ? "wait" : "pointer",
              fontFamily: "inherit",
              opacity: loading ? 0.7 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {loading ? <Spinner /> : <KakaoIcon />}
            {loading ? "이동 중..." : "카카오로 시작하기"}
          </button>

          <p style={{
            fontSize: "11px", fontWeight: 300,
            color: "var(--c-ink-mute)",
            textAlign: "center",
            lineHeight: 1.6,
          }}>
            로그인 시 이용약관 및 개인정보처리방침에 동의하게 됩니다.
          </p>
        </div>

        {/* ── Guides link ── */}
        <a href="/posts" style={{
          fontSize: "13px",
          fontWeight: 400,
          color: "var(--c-primary)",
          textDecoration: "none",
        }}>
          세무사 실무 가이드 보기 →
        </a>

        {/* ── Footer note ── */}
        <p style={{
          fontSize: "11px", fontWeight: 300,
          color: "var(--c-ink-mute)",
          textAlign: "center",
          lineHeight: 1.6,
        }}>
          공개 법령·판례 기반 참고 자료입니다.<br/>
          최종 판단은 담당 세무사가 합니다.
        </p>
      </div>
    </div>
  );
}

function Feature({ text }: { text: string }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "10px",
      fontSize: "13px",
      fontWeight: 300,
      color: "var(--c-ink)",
    }}>
      <CheckIcon />
      <span>{text}</span>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="var(--c-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function KakaoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9 1C4.582 1 1 3.896 1 7.455c0 2.268 1.49 4.254 3.74 5.388l-.95 3.538c-.085.313.283.565.548.373L8.49 14.06c.166.013.337.02.51.02 4.418 0 8-2.896 8-6.545C17 3.896 13.418 1 9 1z"
        fill="#191919"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <span
      style={{
        width: 14,
        height: 14,
        border: "2px solid rgba(25,25,25,0.2)",
        borderTopColor: "#191919",
        borderRadius: "50%",
        display: "inline-block",
        animation: "spin 0.7s linear infinite",
      }}
    >
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </span>
  );
}
