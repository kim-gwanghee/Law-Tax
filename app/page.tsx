"use client";

import { useState, useRef, useEffect } from "react";
import UserMenu from "./components/UserMenu";
import Sidebar from "./components/Sidebar";
import { createConversation, loadMessages, saveMessage, saveFeedback, logEvent } from "@/lib/conversations";

// ─── Design tokens — CSS variable references (values live in globals.css) ─
const C = {
  primary:       "var(--c-primary)",
  primaryDeep:   "var(--c-primary-deep)",
  primaryPress:  "var(--c-primary-press)",
  primarySubtle: "var(--c-primary-subtle)",
  ink:           "var(--c-ink)",
  ink2:          "var(--c-ink2)",
  inkMute:       "var(--c-ink-mute)",
  canvas:        "var(--c-canvas)",
  canvasSoft:    "var(--c-canvas-soft)",
  hairline:      "var(--c-hairline)",
  hairlineInput: "var(--c-hairline-input)",
} as const;

const SHADOW_1 = "var(--shadow-1)";
const SHADOW_2 = "var(--shadow-2)";

type Citation = { title: string; url?: string };
type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  retryQuery?: string;
  feedback?: 1 | -1;
};

const EXAMPLE_QUERIES = [
  "네이버페이 결제 50만원, 사업 관련 구매인데 영수증 없음 — 경비 처리 가능한가요?",
  "프리랜서 디자이너에게 외주비 300만원 지급 시 원천징수 의무가 있나요?",
  "집에서 일하는 개인사업자의 주거비(월세)를 사업 경비로 처리할 수 있나요?",
];

// ─── Spinner ──────────────────────────────────────────────────────────────
function SpinnerIcon() {
  return (
    <svg className="animate-spin w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none"
      style={{ color: C.primary }}>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

type LawClickHandler = (law: string, article: string) => void;

// ─── Law article linkifier ────────────────────────────────────────────────
// Group 1 = law name (소득세법 | 소득세법 시행령 etc.)
// Group 2 = article reference (제127조 제1항 제3호 etc.)
const LAW_RE = /([가-힣]+(?:법|령|칙)(?:\s+(?:시행령|시행규칙))?)\s+(제\d+조(?:의\d+)?(?:\s*제\d+항)?(?:\s*제\d+호)?)/g;
// Bare article reference without a law name prefix (e.g. "제127조 제8항")
const BARE_RE = /제\d+조(?:의\d+)?(?:\s*제\d+항)?(?:\s*제\d+호)?/g;

const LAW_BTN_STYLE: React.CSSProperties = {
  color: C.primary,
  textDecoration: "underline",
  textDecorationColor: C.primarySubtle,
  textUnderlineOffset: "2px",
  cursor: "pointer",
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
};

function makeLawButton(display: string, law: string, article: string, onLawClick: LawClickHandler, key: number) {
  const baseArticle = article.match(/제\d+조(?:의\d+)?/)?.[0] ?? article;
  return (
    <button key={key} onClick={() => onLawClick(law, baseArticle)} style={LAW_BTN_STYLE}>
      {display}
    </button>
  );
}

// Linkify a plain text segment. Full "소득세법 제N조" refs take priority;
// bare "제N조" refs fall back to fallbackLaw if provided.
function linkifyLaw(text: string, parts: React.ReactNode[], onLawClick: LawClickHandler, fallbackLaw?: string | null) {
  LAW_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;

  const addSegment = (seg: string) => {
    if (!seg) return;
    if (!fallbackLaw) { parts.push(<span key={parts.length}>{seg}</span>); return; }
    // Second pass: linkify bare 제N조 refs using fallbackLaw
    BARE_RE.lastIndex = 0;
    let bLast = 0, bm: RegExpExecArray | null;
    while ((bm = BARE_RE.exec(seg)) !== null) {
      if (bm.index > bLast) parts.push(<span key={parts.length}>{seg.slice(bLast, bm.index)}</span>);
      parts.push(makeLawButton(bm[0], fallbackLaw, bm[0], onLawClick, parts.length));
      bLast = bm.index + bm[0].length;
    }
    if (bLast < seg.length) parts.push(<span key={parts.length}>{seg.slice(bLast)}</span>);
  };

  while ((m = LAW_RE.exec(text)) !== null) {
    if (m.index > last) addSegment(text.slice(last, m.index));
    parts.push(makeLawButton(m[0], m[1], m[2], onLawClick, parts.length));
    last = m.index + m[0].length;
  }
  addSegment(text.slice(last));
}

// ─── Inline markdown: **bold** + law links ────────────────────────────────
function renderInline(str: string, onLawClick: LawClickHandler, fallbackLaw?: string | null): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const boldRe = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(str)) !== null) {
    if (m.index > last) linkifyLaw(str.slice(last, m.index), parts, onLawClick, fallbackLaw);
    // Also linkify inside bold so "**소득세법 제127조**" becomes a clickable bold link
    const innerParts: React.ReactNode[] = [];
    linkifyLaw(m[1], innerParts, onLawClick, fallbackLaw);
    parts.push(
      <strong key={parts.length} style={{ fontWeight: 600, color: C.ink }}>
        {innerParts}
      </strong>
    );
    last = m.index + m[0].length;
  }
  if (last < str.length) linkifyLaw(str.slice(last), parts, onLawClick, fallbackLaw);
  return <>{parts}</>;
}

// ─── Block markdown renderer ──────────────────────────────────────────────
function MarkdownContent({ text, onLawClick }: { text: string; onLawClick: LawClickHandler }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  // Primary law = first law name that appears with a full article reference.
  // Used as fallback for bare "제N조" mentions that lack a law name prefix.
  const primaryLaw = text.match(/([가-힣]+(?:법|령|칙)(?:\s+(?:시행령|시행규칙))?)\s+제\d+조/)?.[1] ?? null;
  let listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let paraLines: string[] = [];
  let olCount = 0; // tracks ol item count across ul interruptions

  const flushPara = () => {
    if (!paraLines.length) return;
    const joined = paraLines.join(" ").trim();
    if (joined)
      blocks.push(
        <p key={blocks.length} style={{ lineHeight: 1.6, fontWeight: 300 }}>
          {renderInline(joined, onLawClick, primaryLaw)}
        </p>
      );
    paraLines = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems.slice();
    const type = listType;
    const olStart = type === "ol" ? olCount - items.length + 1 : 1;
    listItems = [];
    listType = null;
    const liStyle: React.CSSProperties = { lineHeight: 1.6, fontWeight: 300 };
    if (type === "ol") {
      blocks.push(
        <ol key={blocks.length} start={olStart} className="list-decimal pl-5 space-y-1">
          {items.map((item, i) => <li key={i} style={liStyle}>{renderInline(item, onLawClick, primaryLaw)}</li>)}
        </ol>
      );
    } else {
      blocks.push(
        <ul key={blocks.length} className="list-disc pl-5 space-y-1">
          {items.map((item, i) => <li key={i} style={liStyle}>{renderInline(item, onLawClick, primaryLaw)}</li>)}
        </ul>
      );
    }
  };

  for (let li = 0; li < lines.length; li++) {
    const t = lines[li].trim();
    if (/^#{1,3} /.test(t)) {
      flushPara();
      flushList();
      olCount = 0;
      const heading = t.replace(/^#{1,3} /, "");
      blocks.push(
        <p key={blocks.length} style={{
          fontWeight: 700,
          fontSize: "14px",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: C.ink,
          marginTop: blocks.length > 0 ? "18px" : "0",
          paddingBottom: "6px",
          borderBottom: `1px solid ${C.hairline}`,
        }}>
          {renderInline(heading, onLawClick, primaryLaw)}
        </p>
      );
    } else if (/^> /.test(t)) {
      flushPara();
      flushList();
      blocks.push(
        <blockquote key={blocks.length} style={{
          borderLeft: `2px solid ${C.primary}`,
          paddingLeft: "12px",
          color: C.ink2,
          fontWeight: 300,
        }}>
          {renderInline(t.replace(/^> /, ""), onLawClick, primaryLaw)}
        </blockquote>
      );
    } else if (/^[-*] /.test(t)) {
      flushPara();
      if (listType !== "ul") flushList();
      listType = "ul";
      listItems.push(t.replace(/^[-*] /, ""));
    } else if (/^\d+\. /.test(t)) {
      flushPara();
      if (listType !== "ol") flushList();
      listType = "ol";
      olCount++;
      listItems.push(t.replace(/^\d+\. /, ""));
    } else if (t === "" || t === "---") {
      flushPara();
      // If next non-blank line continues the same list type, don't flush
      let nextItem = "";
      for (let j = li + 1; j < lines.length; j++) {
        if (lines[j].trim() !== "") { nextItem = lines[j].trim(); break; }
      }
      const continueOl = listType === "ol" && /^\d+\. /.test(nextItem);
      const continueUl = listType === "ul" && /^[-*] /.test(nextItem);
      if (!continueOl && !continueUl) flushList();
    } else {
      flushList();
      paraLines.push(t);
    }
  }
  flushPara();
  flushList();

  return (
    <div className="space-y-2" style={{ fontSize: "14px", color: C.ink2, lineHeight: 1.6 }}>
      {blocks}
    </div>
  );
}

// ─── Law article drawer ───────────────────────────────────────────────────
type LawArticle = {
  article: string; title: string; content: string;
  clauses: { num: string; text: string; items: { num: string; text: string }[] }[];
};
type LawPaneData = { lawName: string; article: string; effDate: string; articles: LawArticle[] };

function LawPane({ law, article, onClose }: { law: string; article: string; onClose: () => void }) {
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [data, setData] = useState<LawPaneData | null>(null);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    setStatus("loading");
    setData(null);
    fetch(`/api/law-article?law=${encodeURIComponent(law)}&article=${encodeURIComponent(article)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setErrMsg(d.error); setStatus("error"); }
        else { setData(d); setStatus("done"); }
      })
      .catch((e) => { setErrMsg(e.message); setStatus("error"); });
  }, [law, article]);

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.18)", zIndex: 40,
      }} />

      {/* Drawer */}
      <div style={{
        position: "fixed", right: 0, top: 0, bottom: 0, width: "min(480px,92vw)",
        background: C.canvas, borderLeft: `1px solid ${C.hairline}`,
        boxShadow: "-4px 0 32px rgba(0,55,112,0.10)",
        zIndex: 50, display: "flex", flexDirection: "column",
        fontFamily: "inherit",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 20px", borderBottom: `1px solid ${C.hairline}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <div>
            <span style={{ fontSize: "13px", fontWeight: 600, color: C.ink }}>{law}</span>
            <span style={{ fontSize: "13px", fontWeight: 400, color: C.inkMute, marginLeft: "6px" }}>{article}</span>
          </div>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: "50%", border: "none",
            background: C.canvasSoft, cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center", color: C.inkMute,
            fontSize: "14px",
          }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {status === "loading" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.inkMute, fontSize: "13px" }}>
              <SpinnerIcon />조문 불러오는 중...
            </div>
          )}
          {status === "error" && (
            <p style={{ color: "#dc2626", fontSize: "13px" }}>{errMsg}</p>
          )}
          {status === "done" && data && (
            <div style={{ fontSize: "13px", lineHeight: 1.7, color: C.ink }}>
              {data.effDate && (
                <p style={{ fontSize: "11px", color: C.inkMute, marginBottom: "16px", fontWeight: 400 }}>
                  {data.lawName} · 시행 {data.effDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1.$2.$3.")}
                </p>
              )}
              {data.articles.map((a, ai) => (
                <div key={ai} style={{ marginBottom: "20px" }}>
                  <p style={{ fontWeight: 700, marginBottom: "6px" }}>
                    {a.article}{a.title ? ` (${a.title})` : ""}
                  </p>
                  {a.content && <p style={{ marginBottom: "8px", fontWeight: 300 }}>{a.content}</p>}
                  {a.clauses.map((cl, ci) => (
                    <div key={ci} style={{ marginLeft: "12px", marginBottom: "6px" }}>
                      <p style={{ fontWeight: 300 }}>
                        <span style={{ fontWeight: 500, marginRight: "4px" }}>
                          {cl.num ? `제${cl.num}항` : "①"}
                        </span>
                        {cl.text}
                      </p>
                      {cl.items.map((ho, hi) => (
                        <p key={hi} style={{ marginLeft: "16px", fontWeight: 300, color: C.ink2 }}>
                          <span style={{ fontWeight: 500, marginRight: "4px" }}>
                            {ho.num ? `제${ho.num}호` : ""}
                          </span>
                          {ho.text}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
              <a href={`https://www.law.go.kr/lsSc.do?menuId=1&query=${encodeURIComponent(law + " " + article)}`}
                target="_blank" rel="noopener noreferrer"
                style={{ fontSize: "11px", color: C.primary, display: "inline-block", marginTop: "8px" }}>
                법제처에서 전문 보기 →
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────
export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [lawPane, setLawPane] = useState<{ law: string; article: string } | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentConvoId, setCurrentConvoId] = useState<string | null>(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function handleNewConversation() {
    setCurrentConvoId(null);
    setMessages([]);
  }

  async function handleSelectConversation(id: string) {
    setCurrentConvoId(id);
    const rows = await loadMessages(id);
    setMessages(rows.map((r) => ({ id: r.id, role: r.role, content: r.content })));
  }

  async function handleFeedback(messageIdx: number, rating: 1 | -1) {
    const target = messages[messageIdx];
    if (!target?.id) return;
    setMessages((prev) => {
      const next = [...prev];
      next[messageIdx] = { ...next[messageIdx], feedback: rating };
      return next;
    });
    await saveFeedback(target.id, rating);
    logEvent("feedback_given", { rating, message_id: target.id });
  }

  // Initialise theme — dark by default unless explicitly set to light
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const dark = saved !== "light";
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
    // Sidebar open by default on desktop, closed on mobile
    if (window.matchMedia("(min-width: 768px)").matches) {
      setSidebarOpen(true);
    }
  }, []);

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamStatus]);

  async function submit(query: string) {
    if (!query.trim() || loading) return;

    const historySnapshot = messages;
    setMessages((prev) => [
      ...prev,
      { role: "user", content: query },
      { role: "assistant", content: "" },
    ]);
    setInput("");
    setLoading(true);
    setStreamStatus("생각 중...");

    // 대화 세션 확보 (없으면 생성)
    let convoId = currentConvoId;
    if (!convoId) {
      convoId = await createConversation(query);
      if (convoId) {
        setCurrentConvoId(convoId);
        setSidebarRefresh((n) => n + 1);
      }
    }
    if (convoId) saveMessage(convoId, "user", query);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, history: historySnapshot }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accText = "";
      let isDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.startsWith("data: ") ? part.slice(6) : part.trim();
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "status") {
              setStreamStatus(event.message);
            } else if (event.type === "token") {
              accText += event.text;
              const snapshot = accText;
              setMessages((prev) => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: snapshot };
                return msgs;
              });
            } else if (event.type === "done") {
              const finalText = accText;
              setMessages((prev) => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = {
                  ...msgs[msgs.length - 1],
                  content: finalText || "관련 법령·판례를 찾을 수 없습니다.",
                  citations: event.citations ?? [],
                };
                return msgs;
              });
              if (convoId) {
                const finalContent = finalText || "관련 법령·판례를 찾을 수 없습니다.";
                saveMessage(convoId, "assistant", finalContent).then((id) => {
                  if (id) {
                    setMessages((prev) => {
                      const next = [...prev];
                      const last = next.length - 1;
                      if (next[last]?.role === "assistant") {
                        next[last] = { ...next[last], id };
                      }
                      return next;
                    });
                  }
                });
              }
              isDone = true;
            } else if (event.type === "error") {
              setMessages((prev) => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { role: "assistant", content: event.message, retryQuery: query };
                return msgs;
              });
              isDone = true;
            }
          } catch {}
        }
      }

      if (!isDone) {
        setMessages((prev) => {
          const msgs = [...prev];
          msgs[msgs.length - 1] = {
            role: "assistant",
            content: accText || "오류가 발생했습니다. 다시 시도해 주세요.",
            retryQuery: accText ? undefined : query,
          };
          return msgs;
        });
      }
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setMessages((prev) => {
        const msgs = [...prev];
        msgs[msgs.length - 1] = {
          role: "assistant",
          content: msg.includes("timeout") || msg.includes("AbortError")
            ? "법령 검색 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요."
            : "오류가 발생했습니다. 다시 시도해 주세요.",
          retryQuery: query,
        };
        return msgs;
      });
    } finally {
      setLoading(false);
      setStreamStatus(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  }

  return (
    <div className="flex h-screen" style={{ background: C.canvas, color: C.ink }}>

      <Sidebar
        open={sidebarOpen}
        currentId={currentConvoId}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onClose={() => setSidebarOpen(false)}
        refreshKey={sidebarRefresh}
      />

      <div className="flex flex-col flex-1 min-w-0">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 px-6"
        style={{ borderBottom: `1px solid ${C.hairline}`, background: C.canvas }}>
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen((v) => !v)} aria-label="사이드바 토글"
              className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
              style={{ background: C.canvasSoft, color: C.inkMute }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div>
              <span style={{ fontSize: "15px", fontWeight: 400, letterSpacing: "-0.2px", color: C.ink }}>
                LawTax
              </span>
              <span className="lawtax-subtitle ml-2" style={{ fontSize: "13px", fontWeight: 300, color: C.inkMute }}>
                세무사 전용 법령·판례 검색
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Theme toggle */}
            <button onClick={toggleTheme} aria-label="테마 전환"
              className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
              style={{ background: C.canvasSoft, color: C.inkMute }}>
              {isDark ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              )}
            </button>
            {/* BETA pill */}
            <span className="hidden sm:inline-flex px-3 py-1 rounded-full text-[11px] font-normal tracking-wide"
              style={{
                background: C.primarySubtle,
                color: C.primaryDeep,
                fontFeatureSettings: '"ss01"',
                letterSpacing: "0.04em",
              }}>
              BETA
            </span>
            {/* User profile */}
            <UserMenu />
          </div>
        </div>
      </header>

      {/* ── Messages / Empty state ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0" style={{ background: C.canvasSoft }}>

        {messages.length === 0 ? (
          /* Empty state — centered, clean */
          <div className="lawtax-hero flex flex-col items-center justify-center min-h-full px-4 py-16">
            <div className="w-full max-w-xl">

              {/* Eyebrow pill */}
              <div className="flex justify-center mb-6">
                <span className="px-3 py-1 rounded-full text-[11px] tracking-[0.08em] uppercase"
                  style={{ background: C.primarySubtle, color: C.primaryDeep }}>
                  세무사 전용
                </span>
              </div>

              {/* Display heading — Stripe weight 300, negative tracking */}
              <h2 className="text-center mb-3"
                style={{
                  fontSize: "32px",
                  fontWeight: 700,
                  lineHeight: 1.1,
                  letterSpacing: "-0.64px",
                  color: C.ink,
                }}>
                세무 쟁점, 법령 근거로 즉시 확인
              </h2>

              {/* Subtitle */}
              <p className="lawtax-hero-sub text-center mb-10"
                style={{ fontSize: "15px", fontWeight: 300, color: C.inkMute, lineHeight: 1.5 }}>
                공개 법령·판례를 검색하여 결론, 근거 조문, 한계를 정리합니다.
              </p>

              {/* Example cards — Stripe card-feature-light style */}
              <div className="space-y-3">
                {EXAMPLE_QUERIES.map((q) => (
                  <button key={q} onClick={() => submit(q)}
                    className="lawtax-example group w-full text-left flex items-center justify-between gap-4 px-5 py-4 rounded-xl transition-all duration-150"
                    style={{
                      background: C.canvas,
                      border: `1px solid ${C.hairline}`,
                      boxShadow: SHADOW_1,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = C.primary;
                      (e.currentTarget as HTMLButtonElement).style.boxShadow = SHADOW_2;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = C.hairline;
                      (e.currentTarget as HTMLButtonElement).style.boxShadow = SHADOW_1;
                    }}>
                    <span style={{ fontSize: "14px", fontWeight: 300, color: C.ink2, lineHeight: 1.5 }}>
                      {q}
                    </span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      className="flex-shrink-0 transition-colors"
                      style={{ color: C.primarySubtle }}
                      ref={(el) => {
                        if (!el) return;
                        const btn = el.closest("button");
                        btn?.addEventListener("mouseenter", () => el.style.color = C.primary);
                        btn?.addEventListener("mouseleave", () => el.style.color = C.primarySubtle);
                      }}>
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Chat messages */
          <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>

                {msg.role === "user" ? (
                  /* User bubble — Stripe primary pill */
                  <div className="max-w-[72%] px-5 py-3 rounded-2xl text-white"
                    style={{
                      background: C.primary,
                      fontSize: "14px",
                      fontWeight: 500,
                      lineHeight: 1.6,
                    }}>
                    {msg.content}
                  </div>
                ) : (
                  /* Assistant card — Stripe card-feature-light */
                  <div className="max-w-[88%] space-y-2">
                    <div className="rounded-xl px-6 py-5"
                      style={{
                        background: C.canvas,
                        border: `1px solid ${C.hairline}`,
                        boxShadow: SHADOW_1,
                      }}>

                      {/* Status indicator */}
                      {loading && i === messages.length - 1 && streamStatus && (
                        <div className="flex items-center gap-2 mb-3">
                          <SpinnerIcon />
                          <span style={{ fontSize: "12px", fontWeight: 400, color: C.primary, letterSpacing: "0.04em" }}>
                            {streamStatus}
                          </span>
                        </div>
                      )}

                      {msg.content ? (
                        <>
                          <MarkdownContent text={msg.content} onLawClick={(law, article) => setLawPane({ law, article })} />
                          {/* Blinking cursor while streaming */}
                          {loading && i === messages.length - 1 && (
                            <span className="inline-block w-0.5 h-[0.85em] animate-pulse align-middle ml-0.5"
                              style={{ background: C.inkMute }} />
                          )}
                        </>
                      ) : loading && i === messages.length - 1 ? (
                        /* Three dots while no content yet */
                        <div className="flex items-center gap-1.5 py-1">
                          <span className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:-0.3s]"
                            style={{ background: C.primarySubtle }} />
                          <span className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:-0.15s]"
                            style={{ background: C.primarySubtle }} />
                          <span className="w-1.5 h-1.5 rounded-full animate-bounce"
                            style={{ background: C.primarySubtle }} />
                        </div>
                      ) : null}

                      {msg.retryQuery && (
                        <button onClick={() => submit(msg.retryQuery!)} disabled={loading}
                          className="mt-4 px-4 py-1.5 rounded-full text-xs font-normal transition-colors disabled:opacity-40"
                          style={{ background: C.primary, color: "#fff", fontSize: "12px" }}>
                          다시 시도
                        </button>
                      )}
                    </div>

                    {/* Feedback buttons (only for completed assistant messages with id) */}
                    {msg.id && !(loading && i === messages.length - 1) && msg.content && !msg.retryQuery && (
                      <div className="flex items-center gap-1 px-1">
                        <button onClick={() => handleFeedback(i, 1)} aria-label="도움됨"
                          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
                          style={{
                            background: msg.feedback === 1 ? C.primarySubtle : "transparent",
                            color: msg.feedback === 1 ? C.primary : C.inkMute,
                          }}
                          onMouseEnter={(e) => { if (msg.feedback !== 1) (e.currentTarget as HTMLButtonElement).style.background = C.canvasSoft; }}
                          onMouseLeave={(e) => { if (msg.feedback !== 1) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M7 10v12"/>
                            <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7V10l4-7c1.66 0 3 1.34 3 3z"/>
                          </svg>
                        </button>
                        <button onClick={() => handleFeedback(i, -1)} aria-label="도움 안 됨"
                          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
                          style={{
                            background: msg.feedback === -1 ? C.primarySubtle : "transparent",
                            color: msg.feedback === -1 ? C.primary : C.inkMute,
                          }}
                          onMouseEnter={(e) => { if (msg.feedback !== -1) (e.currentTarget as HTMLButtonElement).style.background = C.canvasSoft; }}
                          onMouseLeave={(e) => { if (msg.feedback !== -1) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 14V2"/>
                            <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17v12l-4 7c-1.66 0-3-1.34-3-3z"/>
                          </svg>
                        </button>
                      </div>
                    )}

                    {/* Citations — canvas-soft panel */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="px-5 py-3 rounded-xl space-y-1.5"
                        style={{
                          background: C.canvasSoft,
                          border: `1px solid ${C.hairline}`,
                          fontSize: "12px",
                        }}>
                        <p className="tnum" style={{ fontWeight: 400, color: C.inkMute, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: "11px" }}>
                          근거 자료
                        </p>
                        {msg.citations.map((c, j) => (
                          <div key={j} className="tnum">
                            {c.url ? (
                              <a href={c.url} target="_blank" rel="noopener noreferrer"
                                style={{ color: C.primary }} className="hover:underline">
                                {c.title}
                              </a>
                            ) : (
                              <span style={{ color: C.ink2 }}>{c.title}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Input bar ───────────────────────────────────────────────────── */}
      <div className="lawtax-input-bar flex-shrink-0 px-4 py-4"
        style={{ background: C.canvas, borderTop: `1px solid ${C.hairline}` }}>
        <div className="max-w-3xl mx-auto flex gap-3 items-center">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="세무 관련 질문을 입력하세요"
            rows={2}
            className="lawtax-input flex-1 resize-none rounded-lg px-4 py-3 text-sm transition-colors focus:outline-none"
            style={{
              border: `1px solid ${C.hairlineInput}`,
              background: C.canvas,
              color: C.ink,
              fontWeight: 300,
              fontSize: "14px",
              lineHeight: 1.5,
            }}
            onFocus={(e) => e.currentTarget.style.borderColor = C.primary}
            onBlur={(e) => e.currentTarget.style.borderColor = C.hairlineInput}
          />
          {/* Pill button — Stripe button-primary-pill */}
          <button
            onClick={() => submit(input)}
            disabled={!input.trim() || loading}
            className="lawtax-submit flex-shrink-0 rounded-full px-6 py-3 text-sm font-normal text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: C.primary, fontSize: "14px", fontWeight: 400 }}
            onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = C.primaryDeep; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = C.primary; }}>
            검색
          </button>
        </div>
      </div>

      {/* ── Disclaimer ──────────────────────────────────────────────────── */}
      <div className="lawtax-disclaimer flex-shrink-0 text-center py-2 px-4"
        style={{ fontSize: "12px", fontWeight: 300, color: C.inkMute, background: C.canvas }}>
        공개 법령·판례 기반 참고 자료입니다. 최종 판단은 담당 세무사가 합니다.
      </div>

      </div>

      {/* ── Law article drawer ─────────────────────────────────────────── */}
      {lawPane && (
        <LawPane
          law={lawPane.law}
          article={lawPane.article}
          onClose={() => setLawPane(null)}
        />
      )}
    </div>
  );
}
