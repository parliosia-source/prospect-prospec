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

async function writeWithRetry(base44, id, data) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await base44.asServiceRole.entities.Contact.update(id, data);
      return { ok: true };
    } catch (e) {
      const isRL = e.status === 429 || (e.message || "").includes("Rate limit");
      if (isRL && attempt < 3) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 3000));
      } else {
        return { ok: false, error: e.message };
      }
    }
  }
  return { ok: false, error: "Max retries" };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const offset = body.offset || 0;
  const chunkSize = body.chunkSize || 50;

  const batch = await base44.asServiceRole.entities.Contact
    .filter({}, "-created_date", chunkSize, offset)
    .catch(() => []);

  let processedCount = 0, successCount = 0, errorCount = 0, skippedCount = 0;
  const tierCounts = { VERIFIED: 0, IDENTIFIED: 0, ROLE_ONLY: 0, PLACEHOLDER: 0 };
  const errorIds = [];

  for (const contact of batch) {
    processedCount++;

    if (contact.contactTier) {
      skippedCount++;
      tierCounts[contact.contactTier] = (tierCounts[contact.contactTier] || 0) + 1;
      continue;
    }

    const tier = inferContactTier(contact);
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;

    if (!dryRun) {
      const res = await writeWithRetry(base44, contact.id, { contactTier: tier });
      if (res.ok) successCount++;
      else { errorCount++; errorIds.push({ id: contact.id, name: contact.fullName, error: res.error }); }
      await new Promise(r => setTimeout(r, 600));
    } else {
      successCount++;
    }
  }

  const hasMore = batch.length === chunkSize;

  return Response.json({
    success: true, dryRun, offset, chunkSize,
    processedCount, successCount, errorCount, skippedCount,
    tierCounts, errorIds, hasMore,
    nextOffsetSuggested: hasMore ? offset + chunkSize : null,
  });
});