/**
 * Document converter service.
 *
 * Converts PDF, DOCX, and XLSX files to markdown format using
 * specialized libraries for each format.
 *
 * Conversion paths:
 * - PDF: pdf-parse → plain text → minimal markdown
 * - DOCX: mammoth → HTML → turndown with GFM plugin
 * - XLSX: xlsx → JSON per sheet → GFM markdown tables
 */

import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { PDFParse } from 'pdf-parse';
import * as XLSX from 'xlsx';
import { config } from '../../config/index.js';

/** Result of a document conversion. */
export interface ConversionResult {
  /** Converted markdown content. */
  markdown: string;
  /** Non-fatal warnings generated during conversion. */
  warnings: string[];
}

/** MIME type constants for supported conversions. */
const MIME_PDF = 'application/pdf';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Converts a file buffer to markdown based on its MIME type.
 *
 * @param buffer - Raw file content.
 * @param mimeType - MIME type of the original file.
 * @param fileName - Original filename (used for error context).
 * @returns Converted markdown and any warnings.
 * @throws Error if conversion fails or output exceeds size limit.
 */
export async function convertToMarkdown(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ConversionResult> {
  let result: ConversionResult;

  switch (mimeType) {
    case MIME_PDF:
      result = await convertPdf(buffer, fileName);
      break;
    case MIME_DOCX:
      result = await convertDocx(buffer, fileName);
      break;
    case MIME_XLSX:
      result = convertXlsx(buffer, fileName);
      break;
    default:
      throw new Error(`Unsupported MIME type for conversion: ${mimeType}`);
  }

  // Validate output size.
  const sizeBytes = Buffer.byteLength(result.markdown, 'utf-8');
  if (sizeBytes > config.doc.maxMarkdownSize) {
    const maxKb = (config.doc.maxMarkdownSize / 1024).toFixed(0);
    throw new Error(
      `Converted markdown (${(sizeBytes / 1024).toFixed(0)} KB) exceeds maximum size of ${maxKb} KB.`,
    );
  }

  // Warn on near-empty conversion output.
  if (result.markdown.length < 50) {
    result.warnings.push(
      'Converted document contains minimal text content and may not be useful as a reference.',
    );
  }

  return result;
}

/**
 * Converts a PDF buffer to markdown via text extraction.
 */
async function convertPdf(buffer: Buffer, fileName: string): Promise<ConversionResult> {
  const warnings: string[] = [];

  let textResult: { text: string; total: number };
  try {
    // Create PDFParse instance with buffer data
    const pdf = new PDFParse({ data: buffer });

    // Extract text from all pages
    textResult = await pdf.getText();

    // Clean up resources
    await pdf.destroy();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('encrypt')) {
      throw new Error(
        `Cannot convert *${fileName}*: the PDF is password-protected. Please upload an unprotected version.`,
      );
    }
    throw new Error(`Failed to convert *${fileName}*: ${msg}`);
  }

  const text = textResult.text?.trim() ?? '';

  if (!text) {
    warnings.push('PDF appears to contain no extractable text (may be image-based).');
  }

  // Wrap extracted text in minimal markdown structure.
  const title = fileName.replace(/\.[^.]+$/, '');
  const markdown = `# ${title}\n\n${text}`;

  return { markdown, warnings };
}

/**
 * Converts a DOCX buffer to markdown via mammoth (HTML) + turndown.
 */
async function convertDocx(buffer: Buffer, fileName: string): Promise<ConversionResult> {
  const warnings: string[] = [];

  let mammothResult: { value: string; messages: Array<{ type: string; message: string }> };
  try {
    mammothResult = await mammoth.convertToHtml({ buffer });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to convert *${fileName}*: ${msg}`);
  }

  if (mammothResult.messages.length > 0) {
    for (const msg of mammothResult.messages) {
      if (msg.type === 'warning') {
        warnings.push(msg.message);
      }
    }
  }

  let html = mammothResult.value;

  // Strip base64-embedded images to reduce size.
  html = html.replace(/<img[^>]+src="data:[^"]*"[^>]*>/gi, '');

  // Convert HTML to markdown using turndown with GFM plugin for tables.
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });
  turndown.use(gfm);

  const markdown = turndown.turndown(html);

  return { markdown, warnings };
}

/**
 * Converts an XLSX buffer to markdown tables (one per sheet).
 */
function convertXlsx(buffer: Buffer, fileName: string): ConversionResult {
  const warnings: string[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('encrypt')) {
      throw new Error(
        `Cannot convert *${fileName}*: the spreadsheet is password-protected. Please upload an unprotected version.`,
      );
    }
    throw new Error(`Failed to convert *${fileName}*: ${msg}`);
  }
  const sheets: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);
    if (rows.length === 0) {
      warnings.push(`Sheet "${sheetName}" is empty.`);
      continue;
    }

    // Extract headers from first row keys.
    const headers = Object.keys(rows[0]);
    if (headers.length === 0) continue;

    // Build GFM markdown table.
    const headerRow = `| ${headers.join(' | ')} |`;
    const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
    const dataRows = rows.map(
      (row) => `| ${headers.map((h) => String(row[h] ?? '')).join(' | ')} |`,
    );

    const sheetMd =
      `## ${sheetName}\n\n${headerRow}\n${separatorRow}\n${dataRows.join('\n')}`;
    sheets.push(sheetMd);
  }

  if (sheets.length === 0) {
    warnings.push('Workbook contains no data.');
  }

  const title = fileName.replace(/\.[^.]+$/, '');
  const markdown = `# ${title}\n\n${sheets.join('\n\n')}`;

  return { markdown, warnings };
}
