import { describe, it, expect } from 'vitest';
import { extractCloudProviders } from '../../../src/services/builtwith/cloudExtractor.js';
import type { CloudExtractionResult } from '../../../src/services/builtwith/cloudExtractor.js';

/**
 * Helper to build a BuiltWith-style technology entry.
 *
 * @param name - Technology Name field
 * @param tag  - Technology Tag field (defaults to empty string)
 */
function tech(name: string, tag = ''): { Name: string; Tag: string } {
  return { Name: name, Tag: tag };
}

describe('extractCloudProviders', () => {
  // -------------------------------------------------------------------
  // 1. AWS-dominant company
  // -------------------------------------------------------------------
  describe('AWS-dominant company', () => {
    it('should detect AWS as primary when multiple AWS services are present', () => {
      const technologies = [
        tech('Amazon-EC2', 'hosting'),
        tech('Amazon-CloudFront', 'cdn'),
        tech('AWS-Lambda', 'serverless'),
        tech('Amazon-S3', 'storage'),
        tech('Amazon-Route-53', 'dns'),
      ];

      const result: CloudExtractionResult = extractCloudProviders(technologies);

      expect(result.primaryProvider).toBe('AWS');
      expect(result.allProviders).toContain('AWS');
      expect(result.allProviders.length).toBeGreaterThanOrEqual(1);
    });

    it('should accumulate weight from multiple AWS compute signals', () => {
      const technologies = [
        tech('Amazon-EC2'),
        tech('Amazon-ECS'),
        tech('Amazon-EKS'),
      ];

      const result = extractCloudProviders(technologies);

      expect(result.primaryProvider).toBe('AWS');
      // All three are compute (weight 10 each) = total weight 30
      expect(result.allProviders).toEqual(['AWS']);
    });
  });

  // -------------------------------------------------------------------
  // 2. Azure-dominant company
  // -------------------------------------------------------------------
  describe('Azure-dominant company', () => {
    it('should detect Azure as primary when multiple Azure services are present', () => {
      const technologies = [
        tech('Azure-Websites', 'hosting'),
        tech('Azure-App-Service', 'compute'),
        tech('Azure-SQL', 'database'),
        tech('Azure-Active-Directory', 'identity'),
      ];

      const result = extractCloudProviders(technologies);

      expect(result.primaryProvider).toBe('Azure');
      expect(result.allProviders).toContain('Azure');
    });

    it('should detect Azure from a single strong compute signal', () => {
      const technologies = [
        tech('Azure-Virtual-Machines'),
      ];

      const result = extractCloudProviders(technologies);

      expect(result.primaryProvider).toBe('Azure');
    });
  });

  // -------------------------------------------------------------------
  // 3. Multi-cloud company
  // -------------------------------------------------------------------
  describe('multi-cloud company', () => {
    it('should detect both AWS and Azure, with primary based on higher total weight', () => {
      const technologies = [
        // AWS: EC2 (10) + S3 (3) = 13
        tech('Amazon-EC2'),
        tech('Amazon-S3'),
        // Azure: Azure-Websites (10) + Azure-Functions (9) + Azure-CDN (5) = 24
        tech('Azure-Websites'),
        tech('Azure-Functions'),
        tech('Azure-CDN'),
      ];

      const result = extractCloudProviders(technologies);

      expect(result.primaryProvider).toBe('Azure');
      expect(result.allProviders).toContain('AWS');
      expect(result.allProviders).toContain('Azure');
      // Azure should be first (higher total weight)
      expect(result.allProviders.indexOf('Azure')).toBeLessThan(
        result.allProviders.indexOf('AWS'),
      );
    });

    it('should detect three providers when AWS, Azure, and GCP are all present', () => {
      const technologies = [
        tech('Amazon-EC2'),
        tech('Azure-Websites'),
        tech('Google-Compute-Engine'),
      ];

      const result = extractCloudProviders(technologies);

      expect(result.allProviders).toContain('AWS');
      expect(result.allProviders).toContain('Azure');
      expect(result.allProviders).toContain('GCP');
      expect(result.allProviders).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------
  // 4. No cloud provider detected
  // -------------------------------------------------------------------
  describe('no cloud provider detected', () => {
    it('should return "Unknown" when technologies contain no cloud keywords', () => {
      const technologies = [
        tech('jQuery', 'javascript-library'),
        tech('WordPress', 'cms'),
        tech('Nginx', 'web-server'),
        tech('Google-Analytics', 'analytics'),
      ];

      const result = extractCloudProviders(technologies);

      expect(result.primaryProvider).toBe('Unknown');
      expect(result.allProviders).toEqual([]);
    });

    it('should return "Unknown" for an empty technologies array', () => {
      const result = extractCloudProviders([]);

      expect(result.primaryProvider).toBe('Unknown');
      expect(result.allProviders).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // 5. Signal weight priority (tie-breaking by category)
  // -------------------------------------------------------------------
  describe('signal weight priority and tie-breaking', () => {
    it('should rank compute signals higher than CDN/storage signals by weight', () => {
      const technologies = [
        // AWS: only low-weight signals: S3 (3) + CloudFront (5) + Route-53 (4) = 12
        tech('Amazon-S3'),
        tech('Amazon-CloudFront'),
        tech('Amazon-Route-53'),
        // Azure: one compute signal: Azure-Websites (10) + Azure-DNS (4) = 14
        tech('Azure-Websites'),
        tech('Azure-DNS'),
      ];

      const result = extractCloudProviders(technologies);

      // Azure has higher total weight (14 vs 12) so it should be primary
      expect(result.primaryProvider).toBe('Azure');
    });

    it('should break ties using category priority (compute beats cdn)', () => {
      // Both providers will have total weight = 5
      // AWS: CloudFront weight=5, category=cdn (priority 4)
      // GCP: Google-Cloud-CDN weight=5, category=cdn (priority 4)
      // ... same weight AND same priority, so sort is stable/arbitrary
      // Instead test: AWS compute (10) vs Azure compute (10) -- same weight, same priority
      // Better test: one provider has compute, other has cdn, but equal weight

      const technologies = [
        // Azure: Azure-CDN weight=5, highest category=cdn (priority 4)
        tech('Azure-CDN'),
        // GCP: Google-Cloud-CDN weight=5, highest category=cdn (priority 4)
        // Actually let's craft a real tie scenario:
        // AWS: Amazon-CloudFront (weight 5, cdn priority 4)
        tech('Amazon-CloudFront'),
      ];

      // Both have weight 5, both have cdn priority 4 -- this tests equal tie
      // Let's instead test a meaningful tie-break:
      // Provider A: total weight 10, highest category = cdn (priority 4)
      // Provider B: total weight 10, highest category = compute (priority 7)
      // Provider B should win

      const tieBreakTechs = [
        // AWS: CloudFront (5) + CloudFront (5 -- won't double-count same tech, need different ones)
        // AWS: CloudFront (5, cdn) + Route-53 (4, dns) + S3 (3, storage) = 12, highest = cdn (4)
        tech('Amazon-CloudFront'),
        tech('Amazon-Route-53'),
        tech('Amazon-S3'),
        // Azure: Azure-App-Service (10, compute) + Azure-Active-Directory (2, other) = 12, highest = compute (7)
        tech('Azure-App-Service'),
        tech('Azure-Active-Directory'),
      ];

      const result = extractCloudProviders(tieBreakTechs);

      // Both have weight 12, but Azure has compute (priority 7) vs AWS cdn (priority 4)
      expect(result.primaryProvider).toBe('Azure');
      expect(result.allProviders[0]).toBe('Azure');
      expect(result.allProviders[1]).toBe('AWS');
    });

    it('should give hosting/compute keywords (weight 10) more influence than other (weight 2)', () => {
      const technologies = [
        // AWS: many low-weight signals: SES (2) + SNS (2) + Certificate Manager (2) = 6
        tech('Amazon-SES'),
        tech('Amazon-SNS'),
        tech('AWS-Certificate-Manager'),
        // GCP: single compute signal: Cloud Run (10)
        tech('Google-Cloud-Run'),
      ];

      const result = extractCloudProviders(technologies);

      // GCP has weight 10 vs AWS weight 6
      expect(result.primaryProvider).toBe('GCP');
    });
  });

  // -------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------
  describe('edge cases', () => {
    it('should match keywords case-insensitively in the Name field', () => {
      const technologies = [
        tech('amazon-ec2', 'hosting'),
      ];

      const result = extractCloudProviders(technologies);

      expect(result.primaryProvider).toBe('AWS');
    });

    it('should match keywords in the Tag field', () => {
      const technologies = [
        tech('Some Hosting Service', 'Amazon-EC2'),
      ];

      const result = extractCloudProviders(technologies);

      expect(result.primaryProvider).toBe('AWS');
    });

    it('should match keywords as substrings', () => {
      // "Amazon-EC2" should match within "Amazon-EC2-Instance-Connect"
      const technologies = [
        tech('Amazon-EC2-Instance-Connect'),
      ];

      const result = extractCloudProviders(technologies);

      expect(result.primaryProvider).toBe('AWS');
    });
  });
});
