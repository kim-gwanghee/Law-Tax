import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    return NextResponse.json({ outbound_ip: data.ip });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
