"use client";

export default function LoginPage() {
  function loginWithKakao() {
    window.location.href = "/api/auth/kakao/login";
  }

  return (
    <div style={{
      minHeight: "100dvh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--c-canvas)",
    }}>
      <div style={{
        width: "100%",
        maxWidth: "360px",
        padding: "40px 32px",
        borderRadius: "16px",
        border: "1px solid var(--c-hairline)",
        background: "var(--c-canvas-soft)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "24px",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "20px", fontWeight: 600, letterSpacing: "-0.3px", marginBottom: "6px" }}>
            LawTax
          </div>
          <div style={{ fontSize: "13px", fontWeight: 300, color: "var(--c-ink-mute)" }}>
            세무사 전용 법령·판례 검색
          </div>
        </div>

        <button
          onClick={loginWithKakao}
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
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <KakaoIcon />
          카카오로 시작하기
        </button>

        <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--c-ink-mute)", textAlign: "center", lineHeight: 1.6 }}>
          로그인 시 이용약관 및 개인정보처리방침에 동의하게 됩니다.
        </p>
      </div>
    </div>
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
