import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

function isAdmin(userId: string): boolean {
  const adminIds = (process.env.ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return adminIds.includes(userId);
}

type Stats = {
  totalUsers: number;
  totalConversations: number;
  totalMessages: number;
  totalQueries: number;
  queriesLast7d: number;
  queriesLast30d: number;
  activeUsersLast7d: number;
  feedbackUp: number;
  feedbackDown: number;
};

type RecentQuery = {
  content: string;
  created_at: string;
  user_id: string;
};

type TopUser = {
  user_id: string;
  query_count: number;
};

type DailyPoint = {
  date: string;
  count: number;
};

function buildDailySeries(
  isoDates: string[],
  days: number,
): DailyPoint[] {
  const counts = new Map<string, number>();
  for (const iso of isoDates) {
    const day = iso.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const series: DailyPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return series;
}

async function fetchStats(): Promise<{
  stats: Stats;
  recent: RecentQuery[];
  topUsers: TopUser[];
  dailyQueries: DailyPoint[];
  dailyNewConversations: DailyPoint[];
}> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    usersResult,
    conversationsResult,
    messagesAllResult,
    queriesAllResult,
    queries7dResult,
    queries30dResult,
    feedbackResult,
    recentResult,
    topUsersResult,
  ] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1 }),
    admin.from("conversations").select("id", { count: "exact", head: true }),
    admin.from("messages").select("id", { count: "exact", head: true }),
    admin.from("messages").select("id", { count: "exact", head: true }).eq("role", "user"),
    admin.from("messages").select("id", { count: "exact", head: true }).eq("role", "user").gte("created_at", sevenDaysAgo),
    admin.from("messages").select("id", { count: "exact", head: true }).eq("role", "user").gte("created_at", thirtyDaysAgo),
    admin.from("message_feedback").select("rating"),
    admin.from("messages")
      .select("content, created_at, conversation_id, conversations!inner(user_id)")
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(20),
    admin.from("conversations").select("user_id"),
  ]);

  const totalUsers = (usersResult.data && "total" in usersResult.data
    ? (usersResult.data as { total?: number }).total
    : undefined) ?? 0;
  const totalConversations = conversationsResult.count ?? 0;
  const totalMessages = messagesAllResult.count ?? 0;
  const totalQueries = queriesAllResult.count ?? 0;
  const queriesLast7d = queries7dResult.count ?? 0;
  const queriesLast30d = queries30dResult.count ?? 0;

  // active users (distinct user_id from conversations active in last 7d)
  const recentConversationsResult = await admin.from("conversations")
    .select("user_id")
    .gte("updated_at", sevenDaysAgo);
  const activeUsersLast7d = new Set(
    (recentConversationsResult.data ?? []).map((c) => c.user_id),
  ).size;

  const feedback = feedbackResult.data ?? [];
  const feedbackUp = feedback.filter((f) => f.rating === 1).length;
  const feedbackDown = feedback.filter((f) => f.rating === -1).length;

  type RecentRow = {
    content: string;
    created_at: string;
    conversations: { user_id: string } | { user_id: string }[];
  };
  const recent: RecentQuery[] = (recentResult.data as RecentRow[] | null ?? []).map((r) => {
    const convo = Array.isArray(r.conversations) ? r.conversations[0] : r.conversations;
    return {
      content: r.content,
      created_at: r.created_at,
      user_id: convo?.user_id ?? "",
    };
  });

  // top users by conversation count (proxy for activity)
  const counts = new Map<string, number>();
  for (const row of topUsersResult.data ?? []) {
    counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  }
  const topUsers: TopUser[] = Array.from(counts.entries())
    .map(([user_id, query_count]) => ({ user_id, query_count }))
    .sort((a, b) => b.query_count - a.query_count)
    .slice(0, 10);

  // Daily series for last 30 days
  const [queries30dRowsResult, conversations30dRowsResult] = await Promise.all([
    admin.from("messages")
      .select("created_at")
      .eq("role", "user")
      .gte("created_at", thirtyDaysAgo),
    admin.from("conversations")
      .select("created_at")
      .gte("created_at", thirtyDaysAgo),
  ]);

  const dailyQueries = buildDailySeries(
    (queries30dRowsResult.data ?? []).map((r) => r.created_at),
    30,
  );
  const dailyNewConversations = buildDailySeries(
    (conversations30dRowsResult.data ?? []).map((r) => r.created_at),
    30,
  );

  return {
    stats: {
      totalUsers,
      totalConversations,
      totalMessages,
      totalQueries,
      queriesLast7d,
      queriesLast30d,
      activeUsersLast7d,
      feedbackUp,
      feedbackDown,
    },
    recent,
    topUsers,
    dailyQueries,
    dailyNewConversations,
  };
}

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdmin(user.id)) {
    return (
      <main style={{ padding: "80px 24px", textAlign: "center", color: "var(--c-ink)", maxWidth: "500px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "12px" }}>접근 권한이 없습니다</h1>
        <p style={{ fontSize: "14px", color: "var(--c-ink-mute)", marginBottom: "24px" }}>
          관리자만 이 페이지에 접근할 수 있습니다.
        </p>
        <div style={{
          padding: "16px",
          borderRadius: "8px",
          background: "var(--c-canvas-soft)",
          border: "1px solid var(--c-hairline)",
          textAlign: "left",
          fontSize: "12px",
          color: "var(--c-ink-mute)",
        }}>
          <div style={{ marginBottom: "6px" }}>본인 User ID:</div>
          <code style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--c-ink)", wordBreak: "break-all" }}>
            {user.id}
          </code>
        </div>
      </main>
    );
  }

  const { stats, recent, topUsers, dailyQueries, dailyNewConversations } = await fetchStats();
  const totalFeedback = stats.feedbackUp + stats.feedbackDown;
  const feedbackRate = totalFeedback > 0
    ? Math.round((stats.feedbackUp / totalFeedback) * 100)
    : null;

  return (
    <main style={{
      maxWidth: "1080px",
      margin: "0 auto",
      padding: "32px 24px 80px",
      color: "var(--c-ink)",
    }}>
      <header style={{ marginBottom: "32px" }}>
        <Link href="/" style={{ fontSize: "13px", color: "var(--c-ink-mute)", textDecoration: "none" }}>
          ← LawTax
        </Link>
        <h1 style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.3px", marginTop: "12px" }}>
          관리자 대시보드
        </h1>
      </header>

      {/* Stat cards */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "32px" }}>
        <StatCard label="전체 가입자" value={stats.totalUsers.toLocaleString()} />
        <StatCard label="최근 7일 활성 유저" value={stats.activeUsersLast7d.toLocaleString()} />
        <StatCard label="총 질문 수" value={stats.totalQueries.toLocaleString()} />
        <StatCard label="최근 7일 질문" value={stats.queriesLast7d.toLocaleString()} />
        <StatCard label="최근 30일 질문" value={stats.queriesLast30d.toLocaleString()} />
        <StatCard label="총 대화 세션" value={stats.totalConversations.toLocaleString()} />
      </section>

      {/* Daily charts */}
      <section style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>최근 30일 추이</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
          <ChartCard title="일별 질문 수" series={dailyQueries} accent="var(--c-primary)" />
          <ChartCard title="일별 신규 대화" series={dailyNewConversations} accent="var(--c-primary-deep)" />
        </div>
      </section>

      {/* Feedback */}
      <section style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>답변 피드백</h2>
        <div style={{
          padding: "20px",
          borderRadius: "10px",
          border: "1px solid var(--c-hairline)",
          background: "var(--c-canvas-soft)",
          display: "flex",
          gap: "32px",
          alignItems: "center",
          flexWrap: "wrap",
        }}>
          <div>
            <div style={{ fontSize: "11px", color: "var(--c-ink-mute)", marginBottom: "4px" }}>👍 도움됨</div>
            <div style={{ fontSize: "22px", fontWeight: 600 }}>{stats.feedbackUp}</div>
          </div>
          <div>
            <div style={{ fontSize: "11px", color: "var(--c-ink-mute)", marginBottom: "4px" }}>👎 도움 안 됨</div>
            <div style={{ fontSize: "22px", fontWeight: 600 }}>{stats.feedbackDown}</div>
          </div>
          <div>
            <div style={{ fontSize: "11px", color: "var(--c-ink-mute)", marginBottom: "4px" }}>긍정 비율</div>
            <div style={{ fontSize: "22px", fontWeight: 600 }}>
              {feedbackRate !== null ? `${feedbackRate}%` : "—"}
            </div>
          </div>
        </div>
      </section>

      {/* Top users */}
      <section style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>활성 유저 Top 10 (대화 세션 기준)</h2>
        <div style={{
          borderRadius: "10px",
          border: "1px solid var(--c-hairline)",
          background: "var(--c-canvas-soft)",
          overflow: "hidden",
        }}>
          {topUsers.length === 0 && (
            <div style={{ padding: "16px", fontSize: "13px", color: "var(--c-ink-mute)" }}>아직 데이터 없음</div>
          )}
          {topUsers.map((u, i) => (
            <div key={u.user_id} style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 16px",
              borderTop: i === 0 ? "none" : "1px solid var(--c-hairline)",
              fontSize: "13px",
            }}>
              <span style={{ width: "24px", color: "var(--c-ink-mute)" }}>{i + 1}</span>
              <span style={{ flex: 1, fontFamily: "monospace", fontSize: "11px", color: "var(--c-ink-mute)" }}>
                {u.user_id.slice(0, 8)}…
              </span>
              <span style={{ fontWeight: 500 }}>{u.query_count} 세션</span>
            </div>
          ))}
        </div>
      </section>

      {/* Recent queries */}
      <section>
        <h2 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>최근 질문 20건</h2>
        <div style={{
          borderRadius: "10px",
          border: "1px solid var(--c-hairline)",
          background: "var(--c-canvas-soft)",
          overflow: "hidden",
        }}>
          {recent.length === 0 && (
            <div style={{ padding: "16px", fontSize: "13px", color: "var(--c-ink-mute)" }}>아직 데이터 없음</div>
          )}
          {recent.map((r, i) => (
            <div key={i} style={{
              padding: "12px 16px",
              borderTop: i === 0 ? "none" : "1px solid var(--c-hairline)",
              fontSize: "13px",
              lineHeight: 1.5,
            }}>
              <div style={{ marginBottom: "4px" }}>{r.content}</div>
              <div style={{ fontSize: "11px", color: "var(--c-ink-mute)", display: "flex", gap: "12px" }}>
                <span style={{ fontFamily: "monospace" }}>{r.user_id.slice(0, 8)}…</span>
                <span>{new Date(r.created_at).toLocaleString("ko-KR")}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function ChartCard({ title, series, accent }: { title: string; series: DailyPoint[]; accent: string }) {
  const max = Math.max(1, ...series.map((p) => p.count));
  const total = series.reduce((sum, p) => sum + p.count, 0);
  const width = 320;
  const height = 120;
  const barWidth = width / series.length;

  return (
    <div style={{
      padding: "18px 20px",
      borderRadius: "10px",
      border: "1px solid var(--c-hairline)",
      background: "var(--c-canvas-soft)",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ fontSize: "12px", color: "var(--c-ink-mute)" }}>{title}</div>
        <div style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "-0.2px" }}>
          {total.toLocaleString()}
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
        {series.map((p, i) => {
          const h = (p.count / max) * (height - 4);
          const x = i * barWidth;
          const y = height - h;
          return (
            <rect
              key={p.date}
              x={x + 1}
              y={y}
              width={Math.max(barWidth - 2, 1)}
              height={h}
              fill={accent}
              opacity={p.count === 0 ? 0.15 : 0.85}
              rx="1"
            >
              <title>{`${p.date}: ${p.count}건`}</title>
            </rect>
          );
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", fontSize: "10px", color: "var(--c-ink-mute)" }}>
        <span>{series[0]?.date.slice(5)}</span>
        <span>{series[series.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: "18px 20px",
      borderRadius: "10px",
      border: "1px solid var(--c-hairline)",
      background: "var(--c-canvas-soft)",
    }}>
      <div style={{ fontSize: "11px", color: "var(--c-ink-mute)", marginBottom: "6px", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.3px" }}>
        {value}
      </div>
    </div>
  );
}
