import { describe, expect, it } from "vitest";
import {
  missingS3CredentialLabels,
  resolveS3Config,
} from "@/lib/s3-config";

describe("resolveS3Config", () => {
  it("reads AWS SDK environment names", () => {
    expect(
      resolveS3Config({
        AWS_REGION: "auto",
        AWS_ACCESS_KEY_ID: "key",
        AWS_SECRET_ACCESS_KEY: "secret",
        AWS_BUCKET_NAME: "examen",
        AWS_ENDPOINT_URL: "https://storage.railway.app",
      }),
    ).toEqual({
      region: "auto",
      accessKeyId: "key",
      secretAccessKey: "secret",
      endpoint: "https://storage.railway.app",
      bucketName: "examen",
      forcePathStyle: false,
    });
  });

  it("falls back to Railway Bucket credential names", () => {
    expect(
      resolveS3Config({
        REGION: "auto",
        ACCESS_KEY_ID: "key",
        SECRET_ACCESS_KEY: "secret",
        BUCKET: "examen-abc123",
        ENDPOINT: "https://storage.railway.app",
      }),
    ).toEqual({
      region: "auto",
      accessKeyId: "key",
      secretAccessKey: "secret",
      endpoint: "https://storage.railway.app",
      bucketName: "examen-abc123",
      forcePathStyle: false,
    });
  });

  it("prefers AWS_* names when both are set", () => {
    const config = resolveS3Config({
      AWS_REGION: "eu-west-1",
      REGION: "auto",
      AWS_ACCESS_KEY_ID: "aws-key",
      ACCESS_KEY_ID: "railway-key",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      SECRET_ACCESS_KEY: "railway-secret",
      AWS_BUCKET_NAME: "aws-bucket",
      BUCKET: "railway-bucket",
    });

    expect(config.region).toBe("eu-west-1");
    expect(config.accessKeyId).toBe("aws-key");
    expect(config.secretAccessKey).toBe("aws-secret");
    expect(config.bucketName).toBe("aws-bucket");
  });

  it("lists missing credential labels", () => {
    expect(missingS3CredentialLabels(resolveS3Config({}))).toEqual([
      "AWS_REGION or REGION",
      "AWS_ACCESS_KEY_ID or ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY or SECRET_ACCESS_KEY",
    ]);
  });
});
