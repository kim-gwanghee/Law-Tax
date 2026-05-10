import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost, listPosts } from "@/lib/posts";

export async function generateStaticParams() {
  const posts = await listPosts();
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: "찾을 수 없음" };
  return {
    title: post.title,
    description: post.description,
    keywords: post.keywords,
    alternates: { canonical: `/posts/${slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      url: `/posts/${slug}`,
      publishedTime: post.date,
    },
  };
}

export default async function PostPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  return (
    <main style={{
      maxWidth: "720px",
      margin: "0 auto",
      padding: "48px 24px 80px",
      color: "var(--c-ink)",
    }}>
      <nav style={{ marginBottom: "32px" }}>
        <Link href="/posts" style={{
          fontSize: "13px",
          color: "var(--c-ink-mute)",
          textDecoration: "none",
        }}>
          ← 실무 가이드
        </Link>
      </nav>

      <header style={{ marginBottom: "32px" }}>
        <h1 style={{
          fontSize: "30px",
          fontWeight: 700,
          letterSpacing: "-0.4px",
          lineHeight: 1.3,
          marginBottom: "12px",
        }}>
          {post.title}
        </h1>
        <p style={{
          fontSize: "15px",
          fontWeight: 300,
          color: "var(--c-ink-mute)",
          lineHeight: 1.6,
          marginBottom: "12px",
        }}>
          {post.description}
        </p>
        <span style={{ fontSize: "12px", color: "var(--c-ink-mute)" }}>
          {post.date}
        </span>
      </header>

      <article
        className="lawtax-post"
        dangerouslySetInnerHTML={{ __html: post.html }}
      />

      <footer style={{
        marginTop: "64px",
        padding: "24px",
        borderRadius: "12px",
        background: "var(--c-canvas-soft)",
        border: "1px solid var(--c-hairline)",
        textAlign: "center",
      }}>
        <p style={{ fontSize: "14px", marginBottom: "12px", color: "var(--c-ink)" }}>
          비슷한 사례에 대해 AI에게 물어보세요
        </p>
        <Link href="/" style={{
          display: "inline-block",
          padding: "10px 20px",
          borderRadius: "999px",
          background: "var(--c-primary)",
          color: "white",
          textDecoration: "none",
          fontSize: "14px",
          fontWeight: 500,
        }}>
          LawTax에서 검색하기 →
        </Link>
      </footer>
    </main>
  );
}
