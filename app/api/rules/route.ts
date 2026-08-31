import { addAudit, errorResponse, requireAdmin } from "@/lib/villix-server";

type RulePayload = {
  version?: number;
  originalType?: string;
  type?: string;
  label?: string;
  description?: string;
  recipientPercentage?: number;
  active?: boolean;
};

function ruleType(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(normalized)) {
    throw new Error("Use 2–40 lowercase letters, numbers, underscores, or hyphens for the type key.");
  }
  return normalized;
}

function ruleValues(body: RulePayload) {
  const type = ruleType(body.type);
  const label = String(body.label ?? "").trim();
  const description = String(body.description ?? "").trim();
  const percentage = Number(body.recipientPercentage);
  if (label.length < 2 || label.length > 60) throw new Error("Rule name must be between 2 and 60 characters.");
  if (description.length > 180) throw new Error("Rule description must be 180 characters or fewer.");
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("Recipient percentage must be between 0 and 100.");
  }
  return {
    type,
    label,
    description,
    payout_bps: Math.round(percentage * 100),
    active: body.active !== false,
  };
}

async function requireRuleEditor() {
  const context = await requireAdmin();
  if (context.actor.role === "reviewer") throw new Response("Only owners and administrators can change payout rules.", { status: 403 });
  return context;
}

export async function POST(request: Request) {
  try {
    const { actor, supabase } = await requireRuleEditor();
    const body = await request.json() as RulePayload & { action?: string; effectiveDate?: string };

    if (body.action === "create_version") {
      const { data: version, error } = await supabase.rpc("create_rule_version");
      if (error) throw error;
      await addAudit(supabase, actor, "rules.draft_created", "rule_version", String(version), `Rule version ${version} started`, "The active policy was copied into an editable draft.");
      return Response.json({ version }, { status: 201 });
    }

    if (body.action === "publish") {
      const version = Number(body.version);
      const effectiveDate = String(body.effectiveDate ?? "");
      if (!Number.isInteger(version) || version < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
        throw new Error("A valid draft version and effective date are required.");
      }
      const { error } = await supabase.rpc("publish_rule_version", { target_version: version, effective_date: effectiveDate });
      if (error) throw error;
      await addAudit(supabase, actor, "rules.published", "rule_version", String(version), `Rule version ${version} published`, `The policy becomes effective ${effectiveDate}.`, "success");
      return Response.json({ version });
    }

    if (body.action === "add") {
      const version = Number(body.version);
      if (!Number.isInteger(version) || version < 1) throw new Error("A valid draft version is required.");
      const values = ruleValues(body);
      const { error } = await supabase.from("contribution_rules").insert({ version, ...values });
      if (error) throw error;
      await addAudit(supabase, actor, "rule.created", "rule", `${version}:${values.type}`, `${values.label} rule added`, `Version ${version} will pay recipients ${(values.payout_bps / 100).toFixed(2)}%.`);
      return Response.json({ version, type: values.type }, { status: 201 });
    }

    throw new Error("Unsupported rule action.");
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      return Response.json({ error: "A rule with that type key already exists in this version." }, { status: 409 });
    }
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { actor, supabase } = await requireRuleEditor();
    const body = await request.json() as RulePayload;
    const version = Number(body.version);
    const originalType = ruleType(body.originalType);
    if (!Number.isInteger(version) || version < 1) throw new Error("A valid draft version is required.");
    const values = ruleValues(body);
    const { data: updated, error } = await supabase
      .from("contribution_rules")
      .update(values)
      .eq("version", version)
      .eq("type", originalType)
      .select("type")
      .maybeSingle();
    if (error) throw error;
    if (!updated) return Response.json({ error: "Rule not found or this version is no longer editable." }, { status: 404 });
    await addAudit(supabase, actor, "rule.updated", "rule", `${version}:${values.type}`, `${values.label} rule updated`, `Version ${version} will pay recipients ${(values.payout_bps / 100).toFixed(2)}%.`);
    return Response.json({ version, type: values.type });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      return Response.json({ error: "A rule with that type key already exists in this version." }, { status: 409 });
    }
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { actor, supabase } = await requireRuleEditor();
    const body = await request.json() as RulePayload;
    const version = Number(body.version);
    const type = ruleType(body.type);
    if (!Number.isInteger(version) || version < 1) throw new Error("A valid draft version is required.");
    const { data: removed, error } = await supabase
      .from("contribution_rules")
      .delete()
      .eq("version", version)
      .eq("type", type)
      .select("label")
      .maybeSingle();
    if (error) throw error;
    if (!removed) return Response.json({ error: "Rule not found or this version is no longer editable." }, { status: 404 });
    await addAudit(supabase, actor, "rule.removed", "rule", `${version}:${type}`, `${removed.label} rule removed`, `The rule was removed from draft version ${version}.`, "warning");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
