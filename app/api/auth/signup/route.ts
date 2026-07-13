import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { createClientJWT, hashPassword } from "@/lib/jwt";

/**
 * POST /api/auth/signup
 * Public registration — creates a new workspace + owner user, returns JWT.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, workspace_name } = body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    const { data: existing } = await supabase
      .from("workspace_users")
      .select("id")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please sign in." },
        { status: 409 }
      );
    }

    const workspaceName = (workspace_name || "My Workspace").trim();
    const userEmail = email.toLowerCase().trim();
    const passwordHash = await hashPassword(password);

    const { data: workspace, error: wsError } = await supabase
      .from("clients")
      .insert({ name: workspaceName, email_provider: "sendgrid" })
      .select("id")
      .single();

    if (wsError || !workspace) {
      console.error("Signup workspace create error:", wsError);
      return NextResponse.json({ error: "Failed to create workspace" }, { status: 500 });
    }

    const { data: user, error: userError } = await supabase
      .from("workspace_users")
      .insert({
        workspace_id: workspace.id,
        email: userEmail,
        password_hash: passwordHash,
        role: "owner",
        is_active: true,
      })
      .select("id, workspace_id, email, role")
      .single();

    if (userError || !user) {
      await supabase.from("clients").delete().eq("id", workspace.id);
      console.error("Signup user create error:", userError);
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }

    const expiresInSeconds = 86400 * 30;
    const token = createClientJWT(
      user.workspace_id,
      user.id,
      user.email,
      user.role as "owner",
      expiresInSeconds
    );

    return NextResponse.json(
      {
        token,
        workspaceId: user.workspace_id,
        email: user.email,
        role: user.role,
        expiresIn: expiresInSeconds,
        workspace_name: workspaceName,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
