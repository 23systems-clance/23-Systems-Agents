/**
 * Parser node executor for the workflow engine.
 *
 * Handles JSON/CSV parsing, field mapping, transformation, and filtering
 * as a synchronous inline operation.
 */

import { parse as csvParse } from 'csv-parse/sync';
import { applyTransform } from './transformEngine.js';
import { filterRows, type FilterCriterion } from './filterEngine.js';
import type { ParserNodeConfig } from '../types.js';
import logger from '../../../lib/logger.js';

/**
 * Executes a parser node against the execution context.
 *
 * @param config - The parser node configuration.
 * @param context - The workflow execution context.
 * @returns Updated context with parsed/transformed data in the output variable.
 */
export async function executeParserNode(
  config: ParserNodeConfig,
  context: Record<string, unknown>
): Promise<void> {
  const inputVar = config.inputVariable || '_rawData';
  const outputVar = config.outputVariable || '_parsedData';
  const rawInput = context[inputVar];

  if (rawInput === undefined || rawInput === null) {
    logger.warn('Parser node: input variable is empty', { inputVar });
    context[outputVar] = [];
    return;
  }

  // Step 1: Parse input
  let rows: Record<string, unknown>[];

  if (config.parseMode === 'csv') {
    rows = parseCsv(rawInput, config);
  } else {
    rows = parseJson(rawInput, config);
  }

  logger.info(`Parser node: parsed ${rows.length} rows from ${config.parseMode}`);

  // Step 2: Apply field mappings
  if (config.fieldMappings && config.fieldMappings.length > 0) {
    rows = rows.map((row) => applyFieldMappings(row, config.fieldMappings!));
  }

  // Step 3: Apply transformations
  if (config.transformations && config.transformations.length > 0) {
    rows = rows.map((row) => {
      for (const transform of config.transformations!) {
        try {
          row[transform.field] = applyTransform(
            transform.function,
            row[transform.field],
            transform.args as Record<string, unknown>
          );
        } catch (err) {
          logger.warn(`Parser transform failed for field ${transform.field}`, {
            function: transform.function,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return row;
    });
  }

  // Step 4: Apply filters
  if (config.filters && config.filters.length > 0) {
    const beforeCount = rows.length;
    rows = filterRows(rows, config.filters as FilterCriterion[]);
    logger.info(`Parser node: filtered ${beforeCount} -> ${rows.length} rows`);

    if (rows.length === 0) {
      logger.warn('Parser node: all rows excluded by filters');
    }
  }

  context[outputVar] = rows;
}

/**
 * Parses CSV input into row objects.
 */
function parseCsv(
  input: unknown,
  config: ParserNodeConfig
): Record<string, unknown>[] {
  const csvString = typeof input === 'string' ? input : JSON.stringify(input);
  const delimiter = config.csvDelimiter || ',';
  const hasHeaders = config.csvHasHeaders !== false;

  try {
    const parsed = csvParse(csvString, {
      delimiter,
      columns: hasHeaders,
      skip_empty_lines: true,
      trim: true,
    });
    return parsed as unknown as Record<string, unknown>[];
  } catch (err) {
    logger.error('Parser node: CSV parsing failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Parses JSON input into row objects.
 */
function parseJson(
  input: unknown,
  config: ParserNodeConfig
): Record<string, unknown>[] {
  let data: unknown;

  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (err) {
      logger.error('Parser node: JSON parsing failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  } else {
    data = input;
  }

  // Apply root path extraction
  if (config.jsonRootPath) {
    const parts = config.jsonRootPath.split('.');
    let current: unknown = data;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        logger.warn(`Parser node: JSON root path "${config.jsonRootPath}" not found`);
        return [];
      }
      current = (current as Record<string, unknown>)[part];
    }
    data = current;
  }

  // Ensure we have an array of objects
  if (Array.isArray(data)) {
    return data.map((item) =>
      typeof item === 'object' && item !== null ? item as Record<string, unknown> : { value: item }
    );
  }

  if (typeof data === 'object' && data !== null) {
    return [data as Record<string, unknown>];
  }

  return [{ value: data }];
}

/**
 * Applies field mappings (rename, combine, split) to a row.
 */
function applyFieldMappings(
  row: Record<string, unknown>,
  mappings: NonNullable<ParserNodeConfig['fieldMappings']>
): Record<string, unknown> {
  for (const mapping of mappings) {
    switch (mapping.mode) {
      case 'rename':
        if (mapping.sourceField in row) {
          row[mapping.targetField] = row[mapping.sourceField];
          if (mapping.sourceField !== mapping.targetField) {
            delete row[mapping.sourceField];
          }
        }
        break;

      case 'combine':
        if (mapping.combineWith) {
          const delimiter = mapping.combineDelimiter || ' ';
          row[mapping.targetField] = `${String(row[mapping.sourceField] ?? '')}${delimiter}${String(row[mapping.combineWith] ?? '')}`;
        }
        break;

      case 'split':
        if (mapping.splitDelimiter && mapping.sourceField in row) {
          const parts = String(row[mapping.sourceField] ?? '').split(mapping.splitDelimiter);
          row[mapping.targetField] = parts;
        }
        break;
    }
  }
  return row;
}
