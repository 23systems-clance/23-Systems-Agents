/**
 * Data migration: Create CrmConnection records for existing HubSpotConnections.
 *
 * For each HubSpotConnection that doesn't already have a CrmConnection,
 * creates a CrmConnection with crmType=HUBSPOT, status matching the
 * HubSpot connection status, and links the hubspotConnectionId.
 *
 * Also seeds default field mappings for each new CrmConnection using
 * the HubSpot default field map.
 *
 * Usage:
 *   npx tsx src/scripts/migrateToCrmConnections.ts
 *   npx tsx src/scripts/migrateToCrmConnections.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { HUBSPOT_CONTACT_FIELD_MAP } from '../services/crm/adapters/hubspot/hubspotFieldMap.js';

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);

  try {
    console.log(`Migration: Create CrmConnection for existing HubSpotConnections${isDryRun ? ' (DRY RUN)' : ''}`);

    // Find all HubSpot connections that don't have a CrmConnection yet
    const hubspotConnections = await prisma.hubSpotConnection.findMany({
      where: {
        crmConnection: null, // No CrmConnection linked
      },
      include: {
        client: { select: { id: true, name: true } },
      },
    });

    console.log(`Found ${hubspotConnections.length} HubSpot connections without CrmConnection`);

    if (isDryRun) {
      for (const hsc of hubspotConnections) {
        console.log(`  [DRY RUN] Would create CrmConnection for client "${hsc.client?.name}" (${hsc.clientId}), HubSpot portal: ${hsc.hubspotPortalName || hsc.hubspotPortalId}`);
      }
      return;
    }

    let created = 0;
    let mappingsCreated = 0;

    for (const hsc of hubspotConnections) {
      // Map HubSpot status to CRM status
      let crmStatus: 'ACTIVE' | 'DISCONNECTED' | 'TOKEN_EXPIRED' | 'ERROR';
      switch (hsc.status) {
        case 'ACTIVE':
          crmStatus = 'ACTIVE';
          break;
        case 'DISCONNECTED':
          crmStatus = 'DISCONNECTED';
          break;
        case 'TOKEN_EXPIRED':
          crmStatus = 'TOKEN_EXPIRED';
          break;
        default:
          crmStatus = 'ACTIVE';
      }

      // Check if a CrmConnection already exists for this client + HUBSPOT
      const existing = await prisma.crmConnection.findUnique({
        where: {
          clientId_crmType: {
            clientId: hsc.clientId,
            crmType: 'HUBSPOT',
          },
        },
      });

      if (existing) {
        console.log(`  Skipping client ${hsc.clientId} — CrmConnection already exists`);
        continue;
      }

      const connection = await prisma.crmConnection.create({
        data: {
          clientId: hsc.clientId,
          crmType: 'HUBSPOT',
          status: crmStatus,
          displayName: hsc.hubspotPortalName || `HubSpot (${hsc.hubspotPortalId})`,
          hubspotConnectionId: hsc.id,
        },
      });

      // Seed default field mappings
      let displayOrder = 0;
      for (const [canonicalField, crmProperty] of Object.entries(HUBSPOT_CONTACT_FIELD_MAP)) {
        if (!crmProperty) continue;

        await prisma.crmFieldMapping.create({
          data: {
            crmConnectionId: connection.id,
            canonicalField,
            crmProperty,
            dataType: 'string',
            syncDirection: 'TO_CRM',
            overwriteExisting: true,
            displayOrder: displayOrder++,
          },
        });
        mappingsCreated++;
      }

      created++;
      console.log(`  Created CrmConnection for client "${hsc.client?.name}" (${connection.id}) with ${displayOrder} field mappings`);
    }

    console.log(`\nMigration complete: ${created} CrmConnections created, ${mappingsCreated} field mappings seeded`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
