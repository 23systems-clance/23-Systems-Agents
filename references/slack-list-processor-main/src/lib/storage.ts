import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config/index.js';

const DEFAULT_PRESIGNED_EXPIRY_SECONDS = 604_800; // 7 days

/**
 * S3-compatible object storage client configured from application config.
 */
const s3 = new S3Client({
  region: config.s3.region,
  ...(config.s3.accessKeyId && config.s3.secretAccessKey
    ? {
        credentials: {
          accessKeyId: config.s3.accessKeyId,
          secretAccessKey: config.s3.secretAccessKey,
        },
      }
    : {}),
  ...(config.s3.endpoint ? { endpoint: config.s3.endpoint, forcePathStyle: true } : {}),
});

/**
 * Uploads a file buffer to S3 and returns the object key.
 */
export async function uploadFile(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );
  return key;
}

/**
 * Downloads a file from S3 and returns its contents as a Buffer.
 */
export async function downloadFile(key: string): Promise<Buffer> {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
    }),
  );

  if (!response.Body) {
    throw new Error(`Empty response body for S3 key: ${key}`);
  }

  const chunks: Uint8Array[] = [];
  const stream = response.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Deletes a file from S3 by its key.
 */
export async function deleteFile(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
    }),
  );
}

/**
 * Generates a pre-signed URL for downloading an object. Defaults to 7-day expiry.
 */
export async function getPresignedUrl(
  key: string,
  expiresIn: number = DEFAULT_PRESIGNED_EXPIRY_SECONDS,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
  });

  return getSignedUrl(s3, command, { expiresIn });
}
