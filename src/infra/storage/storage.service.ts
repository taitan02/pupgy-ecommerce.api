import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../logger/logger.js';
import type { Env } from '../../config/env.schema.js';

export interface StoredObject {
  contentType: string;
  sizeBytes: number;
}

/**
 * Object storage over the S3 API. Cloudflare R2 speaks it, and so does MinIO, so
 * development and production run the same code path with different env values —
 * no provider SDK, no second implementation to keep in sync.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.publicBaseUrl = config.get('S3_PUBLIC_BASE_URL', { infer: true }).replace(/\/$/, '');

    this.client = new S3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      // R2 ignores the region but the SDK insists on one; "auto" is what Cloudflare
      // documents.
      region: config.get('S3_REGION', { infer: true }),
      // MinIO serves buckets as a path; R2 does too, so this stays on for both.
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
  }

  /** Creates the bucket in local development so a fresh machine just works. In
   *  production the bucket is created once, by hand, with its own access policy. */
  async onModuleInit(): Promise<void> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') return;

    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        logger.info({ bucket: this.bucket }, 'created storage bucket');
      } catch (error) {
        logger.warn({ err: error, bucket: this.bucket }, 'could not ensure storage bucket exists');
      }
    }
  }

  /** A short-lived URL the browser can PUT the file to directly. */
  createUploadUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
  }

  /**
   * What actually landed in the bucket. A presigned PUT cannot enforce a size limit,
   * so the only honest way to know is to ask the store after the upload.
   */
  async head(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        contentType: result.ContentType ?? 'application/octet-stream',
        sizeBytes: result.ContentLength ?? 0,
      };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      // A leftover object costs storage; a failed request costs the user their
      // action. Log it and move on — cleanup can be swept up later.
      logger.error({ err: error, key }, 'failed to delete object');
    }
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }
}
