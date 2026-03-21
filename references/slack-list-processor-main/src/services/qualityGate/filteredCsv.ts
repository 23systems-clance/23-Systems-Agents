/**
 * Filtered rows CSV generation and S3 upload.
 *
 * Generates a CSV from filtered rows preserving original columns and
 * appending a "Filter Reason" column. Uploads to S3 and returns the
 * key + presigned URL.
 */

import { stringify } from 'csv-stringify/sync';
import { uploadFile, getPresignedUrl } from '../../lib/storage.js';
import type { FilteredRow } from './types.js';

/**
 * Generates a filtered-rows CSV, uploads to S3, and returns the key + URL.
 *
 * @param filteredRows - Rows that were rejected by the quality gate.
 * @param originalHeaders - Original column headers from the uploaded file.
 * @param jobId - Job UUID for the S3 key path.
 * @returns Object with S3 key and presigned download URL (7-day expiry).
 */
export async function generateFilteredCsv(
  filteredRows: FilteredRow[],
  originalHeaders: string[],
  jobId: string,
): Promise<{ key: string; url: string }> {
  // Build CSV data: original columns + "Filter Reason"
  const headers = [...originalHeaders, 'Filter Reason'];

  const records = filteredRows.map((fr) => {
    const values = originalHeaders.map((h) => fr.row[h] ?? '');
    values.push(fr.reason);
    return values;
  });

  const csvContent = stringify([headers, ...records]);

  // UTF-8 BOM for Excel compatibility
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const csvBuffer = Buffer.concat([bom, Buffer.from(csvContent, 'utf-8')]);

  const key = `jobs/${jobId}/filtered-rows.csv`;
  await uploadFile(key, csvBuffer, 'text/csv; charset=utf-8');
  const url = await getPresignedUrl(key);

  return { key, url };
}
