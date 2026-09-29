import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Handles email confirmation links (PKCE code or token hash) and signs the user in.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = url.searchParams.get("next")?.startsWith("/") ? url.searchParams.get("next")! : "/overview";
  const supabase = await createClient();

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("Missing confirmation code") };

  const dest = url.clone();
  dest.search = "";
  if (error) {
    dest.pathname = "/login";
    dest.searchParams.set("error", "That link is invalid or has expired. Sign in or request a new link.");
  } else {
    dest.pathname = next;
  }
  return NextResponse.redirect(dest);
}
