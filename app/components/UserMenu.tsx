"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Profile = { nickname: string; picture: string };

export default function UserMenu() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted || !data.user) return;
      const meta = data.user.user_metadata as Record<string, unknown>;
      setProfile({
        nickname: String(meta?.nickname || "사용자"),
        picture: String(meta?.picture || ""),
      });
    });
    return () => { mounted = false; };
  }, [supabase]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (!profile) return null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "4px 10px 4px 4px",
          borderRadius: "999px",
          border: "1px solid var(--c-hairline)",
          background: "var(--c-canvas-soft)",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {profile.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.picture} alt="" width={24} height={24}
            style={{ borderRadius: "50%", objectFit: "cover" }} />
        ) : (
          <div style={{
            width: 24, height: 24, borderRadius: "50%",
            background: "var(--c-primary)", color: "white",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "11px", fontWeight: 500,
          }}>
            {profile.nickname[0] ?? "?"}
          </div>
        )}
        <span style={{ fontSize: "13px", fontWeight: 400, color: "var(--c-ink)" }}>
          {profile.nickname}
        </span>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          right: 0,
          minWidth: "160px",
          padding: "6px",
          borderRadius: "10px",
          border: "1px solid var(--c-hairline)",
          background: "var(--c-canvas)",
          boxShadow: "var(--shadow-2)",
          zIndex: 50,
        }}>
          <button
            onClick={logout}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "none",
              background: "transparent",
              color: "var(--c-ink)",
              fontSize: "13px",
              fontWeight: 300,
              textAlign: "left",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--c-canvas-soft)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
