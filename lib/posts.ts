import { promises as fs } from "fs";
import path from "path";
import matter from "gray-matter";
import { marked } from "marked";

export type PostMeta = {
  slug: string;
  title: string;
  description: string;
  date: string;
  keywords: string[];
};

export type Post = PostMeta & {
  html: string;
};

const POSTS_DIR = path.join(process.cwd(), "content", "posts");

export async function listPosts(): Promise<PostMeta[]> {
  const files = await fs.readdir(POSTS_DIR).catch(() => []);
  const posts: PostMeta[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const slug = file.replace(/\.md$/, "");
    const raw = await fs.readFile(path.join(POSTS_DIR, file), "utf-8");
    const { data } = matter(raw);
    posts.push({
      slug,
      title: String(data.title ?? slug),
      description: String(data.description ?? ""),
      date: String(data.date ?? ""),
      keywords: Array.isArray(data.keywords) ? data.keywords : [],
    });
  }
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getPost(slug: string): Promise<Post | null> {
  const filePath = path.join(POSTS_DIR, `${slug}.md`);
  const raw = await fs.readFile(filePath, "utf-8").catch(() => null);
  if (!raw) return null;
  const { data, content } = matter(raw);
  const html = await marked.parse(content);
  return {
    slug,
    title: String(data.title ?? slug),
    description: String(data.description ?? ""),
    date: String(data.date ?? ""),
    keywords: Array.isArray(data.keywords) ? data.keywords : [],
    html,
  };
}
