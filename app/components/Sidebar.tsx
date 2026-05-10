"use client";

import { useEffect, useState } from "react";
import { listConversations, deleteConversation, type ConversationRow } from "@/lib/conversations";

type Props = {
  open: boolean;
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
  refreshKey: number;
};

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export default function Sidebar({ open, currentId, onSelect, onNew, onClose, refreshKey }: Props) {
  const [items, setItems] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    listConversations().then((data) => {
      if (mounted) {
        setItems(data);
        setLoading(false);
      }
    });
    return () => { mounted = false; };
  }, [refreshKey]);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm("이 대화를 삭제할까요?")) return;
    const ok = await deleteConversation(id);
    if (ok) {
      setItems((prev) => prev.filter((c) => c.id !== id));
      if (id === currentId) onNew();
    }
  }

  function handleSelect(id: string) {
    onSelect(id);
    if (window.matchMedia("(max-width: 767px)").matches) onClose();
  }

  function handleNew() {
    onNew();
    if (window.matchMedia("(max-width: 767px)").matches) onClose();
  }

  return (
    <>
      {/* Mobile backdrop */}
      <div
        onClick={onClose}
        className="lawtax-backdrop"
        data-open={open}
      />

      <aside className="lawtax-sidebar" data-open={open}>
        <div className="lawtax-sidebar-inner">
          {/* New chat */}
          <div style={{ padding: "16px 12px 8px" }}>
            <button
              onClick={handleNew}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 12px",
                borderRadius: "8px",
                border: "1px solid var(--c-hairline)",
                background: "var(--c-canvas)",
                color: "var(--c-ink)",
                fontSize: "13px",
                fontWeight: 400,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--c-canvas-soft)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--c-canvas)")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              새 대화
            </button>
          </div>

          {/* Conversation list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 16px" }}>
            {loading ? (
              <div style={{ padding: "12px", fontSize: "12px", color: "var(--c-ink-mute)" }}>
                불러오는 중...
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: "12px", fontSize: "12px", color: "var(--c-ink-mute)", lineHeight: 1.6 }}>
                아직 대화가 없습니다.
              </div>
            ) : (
              items.map((c) => {
                const active = c.id === currentId;
                return (
                  <div
                    key={c.id}
                    onClick={() => handleSelect(c.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "6px",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      background: active ? "var(--c-primary-subtle)" : "transparent",
                      transition: "background 0.1s",
                      marginBottom: "2px",
                    }}
                    onMouseEnter={(e) => {
                      if (!active) e.currentTarget.style.background = "var(--c-canvas)";
                      const btn = e.currentTarget.querySelector(".del-btn") as HTMLElement;
                      if (btn) btn.style.opacity = "1";
                    }}
                    onMouseLeave={(e) => {
                      if (!active) e.currentTarget.style.background = "transparent";
                      const btn = e.currentTarget.querySelector(".del-btn") as HTMLElement;
                      if (btn) btn.style.opacity = "0";
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: "12.5px",
                        fontWeight: active ? 500 : 400,
                        color: "var(--c-ink)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        lineHeight: 1.4,
                      }}>
                        {c.title || "새 대화"}
                      </div>
                      <div style={{
                        fontSize: "10.5px",
                        fontWeight: 300,
                        color: "var(--c-ink-mute)",
                        marginTop: "2px",
                      }}>
                        {relativeTime(c.updated_at)}
                      </div>
                    </div>
                    <button
                      className="del-btn"
                      onClick={(e) => handleDelete(e, c.id)}
                      style={{
                        flexShrink: 0,
                        width: "22px", height: "22px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        border: "none",
                        background: "transparent",
                        color: "var(--c-ink-mute)",
                        cursor: "pointer",
                        borderRadius: "4px",
                        opacity: 0,
                        transition: "opacity 0.15s",
                      }}
                      aria-label="삭제"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
                      </svg>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
