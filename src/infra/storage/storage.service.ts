import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
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
      return;
    } catch {
      // Missing, so create it below.
    }

    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      logger.info({ bucket: this.bucket }, 'created storage bucket');
    } catch (error) {
      logger.error({ err: error, bucket: this.bucket }, 'could not create storage bucket');
      return;
    }

    // Reported separately from the bucket itself: not every S3 implementation
    // supports bucket policies (S3Mock, used in CI, does not), and saying the bucket
    // failed when only the policy did sends you looking in the wrong place.
    try {
      await this.allowPublicReads();
    } catch (error) {
      logger.warn(
        { err: error, bucket: this.bucket },
        'bucket policy not applied — uploaded images may not be publicly readable',
      );
    }
  }

  /**
   * Product photos are public: the storefront renders them straight from
   * S3_PUBLIC_BASE_URL. On Cloudflare R2 that is the bucket's public domain, set once
   * in the dashboard; MinIO starts private, so development would silently show broken
   * images without this.
   */
  private async allowPublicReads(): Promise<void> {
    await this.client.send(
      new PutBucketPolicyCommand({
        Bucket: this.bucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucket}/*`],
            },
          ],
        }),
      }),
    );
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
