/** Prefer AWS SDK names; fall back to Railway Bucket credential names. */
export function resolveS3Config(env: NodeJS.ProcessEnv = process.env) {
  const region = firstEnv(env, "AWS_REGION", "REGION");
  const accessKeyId = firstEnv(env, "AWS_ACCESS_KEY_ID", "ACCESS_KEY_ID");
  const secretAccessKey = firstEnv(
    env,
    "AWS_SECRET_ACCESS_KEY",
    "SECRET_ACCESS_KEY",
  );
  const endpoint = firstEnv(env, "AWS_ENDPOINT_URL", "ENDPOINT");
  const bucketName = firstEnv(
    env,
    "AWS_BUCKET_NAME",
    "BUCKET",
    "AWS_S3_BUCKET_NAME",
  );
  const forcePathStyle = env.AWS_FORCE_PATH_STYLE === "true";

  return {
    region,
    accessKeyId,
    secretAccessKey,
    endpoint,
    bucketName,
    forcePathStyle,
  };
}

function firstEnv(env: NodeJS.ProcessEnv, ...keys: string[]) {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

export function missingS3CredentialLabels(
  config: ReturnType<typeof resolveS3Config>,
) {
  return (
    [
      ["region", config.region, "AWS_REGION or REGION"],
      ["accessKeyId", config.accessKeyId, "AWS_ACCESS_KEY_ID or ACCESS_KEY_ID"],
      [
        "secretAccessKey",
        config.secretAccessKey,
        "AWS_SECRET_ACCESS_KEY or SECRET_ACCESS_KEY",
      ],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([, , label]) => label);
}
