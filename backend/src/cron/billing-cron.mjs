// Billing cron — camera overage reporting + storage usage warnings.
// NOTE: the deployed copy at /opt/rsc-api/cron/billing-cron.mjs also contains
// the downgrade (1) and payment-reminder (2) sections — merge sections 3 and 4
// below into it; do not overwrite the deployed file with this one.
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  // 3. Camera overage reporting — log orgs over their camera limit
  const overages = await client.query(`
    SELECT o.id, o.name, o.plan, o.max_cameras, o.stripe_customer_id,
           COUNT(c.id) as camera_count
    FROM organizations o
    LEFT JOIN cameras c ON c.org_id = o.id AND c.deleted_at IS NULL AND c.is_dismissed = false
    WHERE o.plan IN ('business', 'enterprise')
    GROUP BY o.id
    HAVING COUNT(c.id) > o.max_cameras
  `);

  for (const org of overages.rows) {
    const extraCams = org.camera_count - org.max_cameras;
    console.log(`[cron] Camera overage: ${org.name} has ${org.camera_count}/${org.max_cameras} cameras (${extraCams} over, plan: ${org.plan})`);
    // TODO: When Stripe metered billing is configured, report usage here:
    // await stripe.subscriptionItems.createUsageRecord(itemId, { quantity: extraCams, action: 'set' });
  }

  // 4. Storage usage warnings — notify orgs at 90%+ usage
  const storageWarnings = await client.query(`
    SELECT o.id, o.name, o.plan, o.storage_gb,
           COALESCE(SUM(cl.file_size_mb)/1024.0, 0) as used_gb,
           u.email, u.full_name
    FROM organizations o
    JOIN users u ON u.org_id = o.id AND u.role = 'admin'
    LEFT JOIN clips cl ON cl.org_id = o.id AND cl.deleted_at IS NULL
    WHERE o.plan != 'free'
    GROUP BY o.id, u.email, u.full_name
    HAVING COALESCE(SUM(cl.file_size_mb)/1024.0, 0) > (o.storage_gb * 0.9)
  `);

  for (const org of storageWarnings.rows) {
    const pct = Math.round((org.used_gb / org.storage_gb) * 100);
    console.log(`[cron] Storage warning: ${org.name} at ${pct}% (${parseFloat(org.used_gb).toFixed(1)}/${org.storage_gb} GB)`);
    // TODO: Send storage warning email when email templates are ready
  }
} finally {
  await client.end();
}
