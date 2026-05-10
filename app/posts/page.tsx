import type { Metadata } from "next";
import Link from "next/link";
import { listPosts } from "@/lib/posts";

export const metadata: Metadata = {
  title: "세무사 실무 가이드",
  description: "원천징수, 경비처리, 적격증빙 등 세무사가 자주 마주치는 실무 쟁점을 법령 근거와 함께 정리합니다.",
  alternates: { canonical: "/posts" },
};

export default async function PostsPage() {
  const posts = await listPosts();

  return (
    <main style={{
      maxWidth: "720px",
      margin: "0 auto",
      padding: "64px 24px 80px",
      color: "var(--c-ink)",
    }}>
      <header style={{ marginBottom: "40px" }}>
        <Link href="/" style={{
          fontSize: "13px",
          color: "var(--c-ink-mute)",
          textDecoration: "none",
        }}>
          ← LawTax
        </Link>
        <h1 style={{
          fontSize: "32px",
          fontWeight: 700,
          letterSpacing: "-0.4px",
          marginTop: "16px",
          marginBottom: "8px",
        }}>
          세무사 실무 가이드
        </h1>
        <p style={{
          fontSize: "15px",
          fontWeight: 300,
          color: "var(--c-ink-mute)",
          lineHeight: 1.6,
        }}>
          원천징수, 경비처리, 적격증빙 등 세무사가 자주 마주치는 실무 쟁점을<br/>
          현행 법령 근거와 함께 정리합니다.
        </p>
      </header>

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {posts.map((p) => (
          <li key={p.slug} style={{
            paddingBottom: "24px",
            marginBottom: "24px",
            borderBottom: "1px solid var(--c-hairline)",
          }}>
            <Link href={`/posts/${p.slug}`} style={{
              color: "var(--c-ink)",
              textDecoration: "none",
            }}>
              <h2 style={{
                fontSize: "20px",
                fontWeight: 600,
                letterSpacing: "-0.2px",
                marginBottom: "8px",
                lineHeight: 1.35,
              }}>
                {p.title}
              </h2>
              <p style={{
                fontSize: "14px",
                fontWeight: 300,
                color: "var(--c-ink-mute)",
                lineHeight: 1.6,
                marginBottom: "8px",
              }}>
                {p.description}
              </p>
              <span style={{
                fontSize: "12px",
                color: "var(--c-ink-mute)",
              }}>
                {p.date}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {posts.length === 0 && (
        <p style={{ color: "var(--c-ink-mute)", fontSize: "14px" }}>
          준비 중입니다.
        </p>
      )}
    </main>
  );
}
