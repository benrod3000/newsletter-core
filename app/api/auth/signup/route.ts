import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { createClientJWT, hashPassword } from "@/lib/jwt";

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
    const userEmail = email.toLowerCase().trim();
    const workspaceName = (workspace_name || "My Workspace").trim();
    const passwordHash = await hashPassword(password);
    const slug = userEmail.split("@")[0]
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    // Check if email already exists
    const { data: existing } = await supabase
      .from("workspace_users")
      .select("id")
      .eq("email", userEmail)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    // Try to create a new workspace directly
    let workspaceId: string | null = null;

    const { data: newWs, error: wsError } = await supabase
      .from("clients")
      .insert({ name: workspaceName, slug })
      .select("id")
      .single();

    if (wsError) {
      console.warn("Could not create new workspace, falling back to default:", wsError.message);
      // Fallback: use default workspace if it exists
      const { data: defaultWs } = await supabase
        .from("clients")
        .select("id")
        .eq("slug", "default")
        .single();

      workspaceId = defaultWs?.id || null;
    } else {
      workspaceId = newWs?.id || null;
    }

    if (!workspaceId) {
      return NextResponse.json(
        { error: "Unable to set up workspace. Please try again or contact support." },
        { status: 500 }
      );
    }

    // Create the user
    const { data: user, error: userError } = await supabase
      .from("workspace_users")
      .insert({
        workspace_id: workspaceId,
        email: userEmail,
        password_hash: passwordHash,
        role: "owner",
        is_active: true,
      })
      .select("id, workspace_id, email, role")
      .single();

    if (userError || !user) {
      // Clean up workspace if we created one
      if (newWs?.id) await supabase.from("clients").delete().eq("id", newWs.id);
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }

    const expiresIn = 86400 * 30;
    const token = createClientJWT(user.workspace_id, user.id, user.email, "owner", expiresIn);

    return NextResponse.json({
      token,
      workspaceId: user.workspace_id,
      email: user.email,
      role: "owner",
      expiresIn,
      workspace_name: workspaceName,
    }, { status: 201 });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
