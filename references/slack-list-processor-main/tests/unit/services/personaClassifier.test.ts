/**
 * Unit tests for the persona classifier service.
 *
 * Covers:
 *   - Exact title match from the lookup table (various persona types).
 *   - Substring / fuzzy match for similar titles.
 *   - Unknown / unclassifiable title -> falls back to AI (mocked).
 *   - Empty title -> falls back to AI (mocked).
 *   - AI fallback behaviour (success, missing tool block, error).
 *   - Batch classification combining lookup + AI paths.
 *
 * The Anthropic SDK and config module are mocked so tests run offline
 * without an API key or environment variables.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks -- must be hoisted before the module under test is imported.
// ---------------------------------------------------------------------------

// Mock the config module so it does not read real env vars.
vi.mock('../../../src/config/index.js', () => ({
  config: {
    anthropic: {
      apiKey: 'test-key',
      costPer1kInputTokens: 0.0008,
      costPer1kOutputTokens: 0.004,
    },
  },
}));

// Mock the logger so it stays silent during tests.
vi.mock('../../../src/lib/logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the API usage logger so it does not require a database connection.
vi.mock('../../../src/lib/apiUsageLogger.js', () => ({
  logApiUsage: vi.fn(),
}));

// Use vi.hoisted so the mock fn is available inside the hoisted vi.mock factory.
const { mockMessagesCreate } = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockMessagesCreate };
    },
  };
});

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are in place.
// ---------------------------------------------------------------------------

import {
  classifyPersona,
  classifyPersonasBatch,
} from '../../../src/services/ai/personaClassifier.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a mock Anthropic response containing a single tool_use block
 * with the specified persona_type and confidence.
 */
function makeToolResponse(personaType: string, confidence: number) {
  return {
    content: [
      {
        type: 'tool_use' as const,
        id: 'toolu_test',
        name: 'classify_persona',
        input: { persona_type: personaType, confidence },
      },
    ],
    usage: { input_tokens: 50, output_tokens: 20 },
  };
}

/**
 * Returns a mock Anthropic response for the batch tool with the given
 * classifications array.
 */
function makeBatchToolResponse(
  classifications: Array<{ index: number; persona_type: string; confidence: number }>,
) {
  return {
    content: [
      {
        type: 'tool_use' as const,
        id: 'toolu_batch_test',
        name: 'classify_personas_batch',
        input: { classifications },
      },
    ],
    usage: { input_tokens: 100, output_tokens: 80 },
  };
}

// ---------------------------------------------------------------------------
// Tests -- classifyPersona (single)
// ---------------------------------------------------------------------------

describe('classifyPersona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Exact title match from lookup table
  // -----------------------------------------------------------------------

  describe('exact title match from lookup table', () => {
    it('should classify "VP of Engineering" as ENGINEERING_LEADER via lookup', async () => {
      const result = await classifyPersona('VP of Engineering');

      expect(result).toEqual({
        personaType: 'ENGINEERING_LEADER',
        confidence: 1.0,
        source: 'lookup',
      });
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('should classify "CIO" as IT_LEADER via lookup', async () => {
      const result = await classifyPersona('CIO');

      expect(result).toEqual({
        personaType: 'IT_LEADER',
        confidence: 1.0,
        source: 'lookup',
      });
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('should classify "CEO" as CEO via lookup', async () => {
      const result = await classifyPersona('CEO');

      expect(result).toEqual({
        personaType: 'CEO',
        confidence: 1.0,
        source: 'lookup',
      });
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('should classify "Founder" as FOUNDER_OWNER via lookup', async () => {
      const result = await classifyPersona('Founder');

      expect(result).toEqual({
        personaType: 'FOUNDER_OWNER',
        confidence: 1.0,
        source: 'lookup',
      });
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('should be case-insensitive for exact matches', async () => {
      const result = await classifyPersona('vp OF engineering');

      expect(result.personaType).toBe('ENGINEERING_LEADER');
      expect(result.source).toBe('lookup');
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('should trim whitespace before matching', async () => {
      const result = await classifyPersona('  CIO  ');

      expect(result.personaType).toBe('IT_LEADER');
      expect(result.source).toBe('lookup');
    });
  });

  // -----------------------------------------------------------------------
  // 2. More exact matches across persona types
  // -----------------------------------------------------------------------

  describe('exact matches across persona types', () => {
    const exactMatchCases: Array<[string, string]> = [
      ['CFO', 'FINANCE_LEADER'],
      ['Chief Revenue Officer', 'SALES_LEADER'],
      ['COO', 'OPERATIONS_LEADER'],
      ['CHRO', 'HR_LEADER'],
      ['VP of Customer Success', 'CUSTOMER_SUCCESS_LEADER'],
      ['CMO', 'MARKETING_LEADER'],
      ['Chief Product Officer', 'PRODUCT_LEADER'],
      ['General Counsel', 'COMPLIANCE_LEADER'],
      ['Chief Scientist', 'RESEARCH_LEADER'],
      ['Software Engineer', 'NON_LEADER'],
      ['Co-Founder', 'FOUNDER_OWNER'],
    ];

    it.each(exactMatchCases)(
      'should classify "%s" as %s via lookup',
      async (title, expectedPersona) => {
        const result = await classifyPersona(title);

        expect(result.personaType).toBe(expectedPersona);
        expect(result.confidence).toBe(1.0);
        expect(result.source).toBe('lookup');
        expect(mockMessagesCreate).not.toHaveBeenCalled();
      },
    );
  });

  // -----------------------------------------------------------------------
  // 3. Substring / fuzzy match for similar titles
  // -----------------------------------------------------------------------

  describe('substring match for similar titles', () => {
    it('should classify "Head of IT" as IT_LEADER via substring match', async () => {
      const result = await classifyPersona('Head of IT');

      expect(result.personaType).toBe('IT_LEADER');
      expect(result.confidence).toBe(1.0);
      expect(result.source).toBe('lookup');
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('should classify "Senior VP of Engineering, Platform" via substring match', async () => {
      const result = await classifyPersona('Senior VP of Engineering, Platform');

      // Contains "vp of engineering" as a substring
      expect(result.personaType).toBe('ENGINEERING_LEADER');
      expect(result.source).toBe('lookup');
    });

    it('should classify "Global Head of Marketing" via substring match', async () => {
      const result = await classifyPersona('Global Head of Marketing');

      // Contains "head of marketing" as a substring
      expect(result.personaType).toBe('MARKETING_LEADER');
      expect(result.source).toBe('lookup');
    });

    it('should classify "Director of IT and Security" via substring match', async () => {
      const result = await classifyPersona('Director of IT and Security');

      // Contains "director of it" as a substring
      expect(result.personaType).toBe('IT_LEADER');
      expect(result.source).toBe('lookup');
    });
  });

  // -----------------------------------------------------------------------
  // 4. Unknown / unclassifiable title -> AI fallback
  // -----------------------------------------------------------------------

  describe('AI fallback for unknown titles', () => {
    it('should call AI for a title not in the lookup table', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        makeToolResponse('OPERATIONS_LEADER', 0.85),
      );

      const result = await classifyPersona('Chief Happiness Officer');

      expect(result).toEqual({
        personaType: 'OPERATIONS_LEADER',
        confidence: 0.85,
        source: 'ai',
      });
      expect(mockMessagesCreate).toHaveBeenCalledOnce();
    });

    it('should default to NON_LEADER when AI returns no tool_use block', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'I cannot classify this.' }],
        usage: { input_tokens: 50, output_tokens: 20 },
      });

      const result = await classifyPersona('Mysterious Title XYZ');

      expect(result).toEqual({
        personaType: 'NON_LEADER',
        confidence: 0,
        source: 'ai',
      });
    });

    it('should default to NON_LEADER when AI returns an invalid persona type', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        makeToolResponse('INVALID_TYPE', 0.9),
      );

      const result = await classifyPersona('Weird Title');

      expect(result).toEqual({
        personaType: 'NON_LEADER',
        confidence: 0,
        source: 'ai',
      });
    });

    it('should default to NON_LEADER when AI call throws an error', async () => {
      mockMessagesCreate.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const result = await classifyPersona('Some Obscure Title');

      expect(result).toEqual({
        personaType: 'NON_LEADER',
        confidence: 0,
        source: 'ai',
      });
    });
  });

  // -----------------------------------------------------------------------
  // 5. Empty title
  // -----------------------------------------------------------------------

  describe('empty title handling', () => {
    it('should fall back to AI for an empty string title', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        makeToolResponse('NON_LEADER', 0),
      );

      const result = await classifyPersona('');

      // Empty string -> lookupPersona returns null -> AI fallback
      expect(result.source).toBe('ai');
      expect(mockMessagesCreate).toHaveBeenCalledOnce();
    });

    it('should fall back to AI for a whitespace-only title', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        makeToolResponse('NON_LEADER', 0),
      );

      const result = await classifyPersona('   ');

      expect(result.source).toBe('ai');
      expect(mockMessagesCreate).toHaveBeenCalledOnce();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests -- classifyPersonasBatch
// ---------------------------------------------------------------------------

describe('classifyPersonasBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return an empty array when given no titles', async () => {
    const result = await classifyPersonasBatch([]);

    expect(result).toEqual([]);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('should resolve all titles via lookup when all are in the table', async () => {
    const titles = [
      { index: 0, jobTitle: 'CEO' },
      { index: 1, jobTitle: 'VP of Engineering' },
      { index: 2, jobTitle: 'CFO' },
    ];

    const results = await classifyPersonasBatch(titles);

    expect(results).toHaveLength(3);
    expect(results.find((r) => r.index === 0)?.personaType).toBe('CEO');
    expect(results.find((r) => r.index === 1)?.personaType).toBe('ENGINEERING_LEADER');
    expect(results.find((r) => r.index === 2)?.personaType).toBe('FINANCE_LEADER');
    // No AI call needed when all match lookup
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('should use AI for titles not in the lookup table', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      makeBatchToolResponse([
        { index: 1, persona_type: 'HR_LEADER', confidence: 0.9 },
      ]),
    );

    const titles = [
      { index: 0, jobTitle: 'CIO' },                     // lookup hit
      { index: 1, jobTitle: 'Chief Happiness Officer' },  // AI needed
    ];

    const results = await classifyPersonasBatch(titles);

    expect(results).toHaveLength(2);

    const lookupResult = results.find((r) => r.index === 0);
    expect(lookupResult?.personaType).toBe('IT_LEADER');
    expect(lookupResult?.source).toBe('lookup');

    const aiResult = results.find((r) => r.index === 1);
    expect(aiResult?.personaType).toBe('HR_LEADER');
    expect(aiResult?.source).toBe('ai');
    expect(aiResult?.confidence).toBe(0.9);

    expect(mockMessagesCreate).toHaveBeenCalledOnce();
  });

  it('should default to NON_LEADER for AI titles when batch call fails', async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error('Service unavailable'));

    const titles = [
      { index: 0, jobTitle: 'CIO' },                     // lookup hit
      { index: 1, jobTitle: 'Chief Happiness Officer' },  // AI needed -> error
    ];

    const results = await classifyPersonasBatch(titles);

    expect(results).toHaveLength(2);

    const lookupResult = results.find((r) => r.index === 0);
    expect(lookupResult?.personaType).toBe('IT_LEADER');
    expect(lookupResult?.source).toBe('lookup');

    const aiResult = results.find((r) => r.index === 1);
    expect(aiResult?.personaType).toBe('NON_LEADER');
    expect(aiResult?.confidence).toBe(0);
    expect(aiResult?.source).toBe('ai');
  });

  it('should default to NON_LEADER when batch AI returns no tool_use block', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Cannot classify.' }],
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    const titles = [
      { index: 0, jobTitle: 'Unknown Role XYZ' },
    ];

    const results = await classifyPersonasBatch(titles);

    expect(results).toHaveLength(1);
    expect(results[0]?.personaType).toBe('NON_LEADER');
    expect(results[0]?.confidence).toBe(0);
    expect(results[0]?.source).toBe('ai');
  });

  it('should default to NON_LEADER for titles missing from AI batch response', async () => {
    // AI only returns classification for index 1 but not index 2
    mockMessagesCreate.mockResolvedValueOnce(
      makeBatchToolResponse([
        { index: 1, persona_type: 'SALES_LEADER', confidence: 0.8 },
      ]),
    );

    const titles = [
      { index: 0, jobTitle: 'CIO' },                         // lookup hit
      { index: 1, jobTitle: 'Chief Happiness Officer' },      // AI returns result
      { index: 2, jobTitle: 'Grand Poobah of Everything' },   // AI missing
    ];

    const results = await classifyPersonasBatch(titles);

    expect(results).toHaveLength(3);

    const missingResult = results.find((r) => r.index === 2);
    expect(missingResult?.personaType).toBe('NON_LEADER');
    expect(missingResult?.confidence).toBe(0);
    expect(missingResult?.source).toBe('ai');
  });
});
