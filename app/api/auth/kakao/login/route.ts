import { NextRequest, NextResponse } from "next/server";
import { getOrigin } from "@/lib/origin";

export async function GET(req: NextRequest) {
  const origin = getOrigin(req);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.KAKAO_REST_API_KEY!,
    redirect_uri: `${origin}/api/auth/kakao/callback`,
    scope: "openid profile_nickname profile_image",
  });
  return NextResponse.redirect(
    `https://kauth.kakao.com/oauth/authorize?${params.toString()}`
  );
}
