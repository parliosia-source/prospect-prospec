import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── contactTier inference rules ───────────────────────────────────────────────
// VERIFIED    = email + full name (first + last) confirmed — highest quality
// IDENTIFIED  = full name + LinkedIn but no email — known person, actionable
// ROLE_ONLY   = title only, no name, possibly email — partial, isStub=true
// PLACEHOLDER = no real info at all — lowest quality

function inferContactTier(contact) {
  const hasEmail = !!(contact.email && contact.email.includes("@"));
  const hasLinkedIn = !!(contact.linkedinUrl && contact.linkedinUrl.includes("linkedin.com/in/"));
  const hasFullName = (() => {
    const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim()
      || (contact.fullName || "").trim();
    const parts = name.split(/\s+/).filter(p => p.length > 1);
    return parts.length >= 2;
  })();
  const hasTitle = !!(contact.title && contact.title.trim().length > 3);

  // VERIFIED: has email + full name
  if (hasEmail && hasFullName) return "VERIFIED";

  // IDENTIFIED: has full name + LinkedIn (even without email)
  if (hasFullName && hasLinkedIn) return "IDENTIFIED";

  // IDENTIFIED: has full name alone (rare but useful)
  if (hasFullName && hasEmail) return "VERIFIED"; // already caught above

  // ROLE_ONLY: has title or email but no full name
  if (hasTitle || hasEmail) return "ROLE_ONLY";

  // PLACEHOLDER: nothing useful
  return "PLACEHOLDER";
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const limit = body.limit || 0;

  let page = 0;
  let total = 0, updated = 0, skipped = 0, failed = 0;
  const tierCounts = { VERIFIED: 0, IDENTIFIED: 0, ROLE_ONLY: 0, PLACEHOLDER: 0 };
  const samples = [];

  while (true) {
    const batch = await base44.asServiceRole.entities.Contact
      .filter({}, "-created_date", 500, page * 500)
      .catch(() => []);
    if (!batch || batch.length === 0) break;

    for (const contact of batch) {
      if (limit > 0 && total >= limit) break;
      total++;

      // Skip if already set
      if (contact.contactTier) {
        skipped++;
        tierCounts[contact.contactTier] = (tierCounts[contact.contactTier] || 0) + 1;
        continue;
      }

      const tier = inferContactTier(contact);
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;

      if (samples.length < 10) {
        samples.push({
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          fullName: contact.fullName,
          title: contact.title,
          hasEmail: !!(contact.email && contact.email.includes("@")),
          hasLinkedIn: !!(contact.linkedinUrl && contact.linkedinUrl.includes("linkedin.com/in/")),
          isStub: contact.isStub || false,
          tierInferred: tier,
        });
      }

      if (!dryRun) {
        try {
          await base44.asServiceRole.entities.Contact.update(contact.id, { contactTier: tier });
          updated++;
        } catch (e) {
          console.error(`[backfillContactTier] Failed ${contact.id}: ${e.message}`);
          failed++;
        }
      } else {
        updated++;
      }
    }

    if (batch.length < 500) break;
    if (limit > 0 && total >= limit) break;
    page++;
    if (page >= 40) break;
  }

  return Response.json({ success: true, dryRun, total, updated, skipped, failed, tierCounts, samples });
});