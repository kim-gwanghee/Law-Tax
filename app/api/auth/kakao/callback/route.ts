import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

function decodeJwt(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) return {};
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
}

function deriveSyntheticPassword(kakaoId: string): string {
  return createHash("sha256")
    .update(`${kakaoId}:${process.env.SUPABASE_SERVICE_ROLE_KEY}`)
    .digest("hex");
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/login?error=no_code`);

  // 1) Exchange code for tokens
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.KAKAO_REST_API_KEY!,
    redirect_uri: `${origin}/api/auth/kakao/callback`,
    code,
  });
  if (process.env.KAKAO_CLIENT_SECRET) {
    body.set("client_secret", process.env.KAKAO_CLIENT_SECRET);
  }

  const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
  });
  const tokens = await tokenRes.json();

  if (!tokens.id_token) {
    console.error("Kakao token exchange failed:", tokens);
    return NextResponse.redirect(`${origin}/login?error=kakao_token_failed`);
  }

  // 2) Decode id_token for Kakao user info
  const claims = decodeJwt(tokens.id_token);
  const kakaoId = String(claims.sub || "");
  const nickname = String(claims.nickname || "");
  const picture = String(claims.picture || "");

  if (!kakaoId) {
    return NextResponse.redirect(`${origin}/login?error=no_kakao_id`);
  }

  const syntheticEmail = `kakao_${kakaoId}@kakao.lawtax.app`;
  const password = deriveSyntheticPassword(kakaoId);

  // 3) Try sign in (existing user) first
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: syntheticEmail,
    password,
  });

  if (!signInError) {
    return NextResponse.redirect(`${origin}/`);
  }

  // 4) Not registered yet — create user via admin API
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { error: createError } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    password,
    email_confirm: true,
    user_metadata: { kakao_id: kakaoId, nickname, picture, provider: "kakao" },
  });

  if (createError) {
    console.error("createUser error:", createError);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(createError.message)}`
    );
  }

  // 5) Sign in newly created user
  const { error: signInError2 } = await supabase.auth.signInWithPassword({
    email: syntheticEmail,
    password,
  });

  if (signInError2) {
    console.error("post-create signIn error:", signInError2);
    return NextResponse.redirect(`${origin}/login?error=signin_failed`);
  }

  return NextResponse.redirect(`${origin}/`);
}
