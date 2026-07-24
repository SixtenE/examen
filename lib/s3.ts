import { S3Client } from "@aws-sdk/client-s3";
import {
  missingS3CredentialLabels,
  resolveS3Config,
} from "@/lib/s3-config";

const config = resolveS3Config();
const missingCredentialKeys = missingS3CredentialLabels(config);

if (missingCredentialKeys.length > 0) {
  throw new Error(
    `Missing S3 credentials: ${missingCredentialKeys.join(", ")}. On Railway, link the Bucket and use the AWS SDK variable preset, or reference ACCESS_KEY_ID / SECRET_ACCESS_KEY / REGION / ENDPOINT / BUCKET.`,
  );
}

export const awsBucketName = config.bucketName;

export function requireAwsBucketName() {
  if (!awsBucketName) {
    throw new Error(
      "Missing bucket name: set AWS_BUCKET_NAME or Railway Bucket BUCKET",
    );
  }

  return awsBucketName;
}

export const s3Client = new S3Client({
  region: config.region!,
  credentials: {
    accessKeyId: config.accessKeyId!,
    secretAccessKey: config.secretAccessKey!,
  },
  ...(config.endpoint ? { endpoint: config.endpoint } : {}),
  ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
});
