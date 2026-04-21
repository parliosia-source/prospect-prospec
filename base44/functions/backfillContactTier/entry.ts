import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function inferContactTier(contact) {
  const hasEmail = !!(contact.email && contact.email.includes("@"));
  const hasLinkedIn = !!(contact.linkedinUrl && contact.linkedinUrl.includes("linkedin.com/in/"));
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim()
    || (contact.fullName || "").trim();
  const hasFullName = name.split(/\s+/).filter(p => p.length > 1).length >= 2;
  const hasTitle = !!(contact.title && contact.title.trim().length > 3);

  if (hasEmail && hasFullName) return "VERIFIED";
  if (hasFullName && hasLinkedIn) return "IDENTIFIED";
  if (hasFullName) return "IDENTIFIED";
  if (hasTitle || hasEmail) return "ROLE_ONLY";
  return "PLACEHOLDER";
}

async function writeWithRetry(base44, id, data, label) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await base44.asServiceRole.entities.Contact.update(id, data);
      return true;
    } catch (e) {
      const isRL = e.status === 429 || (e.message || "").includes("Rate limit");
      if (isRL && attempt < 5) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000 + 500));
      } else {
        console.error(`[${label}] Failed ${id}: ${e.message}`);
        return false;
      }
    }
  }
  return false;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const offset = body.offset || 0;
  const chunkSize = body.chunkSize || 400;

  let updated = 0, skipped = 0, failed = 0;
  const tierCounts = { VERIFIED: 0, IDENTIFIED: 0, ROLE_ONLY: 0, PLACEHOLDER: 0 };
  const samples = [];

  const batch = await base44.asServiceRole.entities.Contact
    .filter({}, "-created_date", chunkSize, offset)
    .catch(() => []);

  for (const contact of batch) {
    if (contact.contactTier) {
      skipped++;
      tierCounts[contact.contactTier] = (tierCounts[contact.contactTier] || 0) + 1;
      continue;
    }

    const tier = inferContactTier(contact);
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;

    if (samples.length < 5) {
      samples.push({ fullName: contact.fullName, title: contact.title, hasEmail: !!(contact.email?.includes("@")), tierInferred: tier });
    }

    if (!dryRun) {
      const ok = await writeWithRetry(base44, contact.id, { contactTier: tier }, "backfillContactTier");
      if (ok) updated++; else failed++;
      await new Promise(r => setTimeout(r, 350));
    } else {
      updated++;
    }
  }

  return Response.json({
    success: true, dryRun, offset, chunkSize,
    recordsInChunk: batch.length, updated, skipped, failed, tierCounts, samples,
    nextOffset: batch.length === chunkSize ? offset + chunkSize : null,
    done: batch.length < chunkSize,
  });
});