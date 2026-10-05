import { bucket, defineRailway, github, group, image, postgres, preserve, project, redis, service, volume } from "railway/iac";

export default defineRailway(() => {
  const examen = github("SixtenE/examen", { checkSuites: false });

  const Postgres = postgres("Postgres", { region: "europe-west4-drams3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres", tcpProxies: { "5432": {} } };
  const Redis = redis("Redis", { region: "europe-west4-drams3a" });
  Redis.deploy = { startCommand: "/bin/sh -c \"rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH\"" };
  Redis.networking = { privateNetworkEndpoint: "redis", tcpProxies: { "6379": {} } };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 5000 });
  const drizzleGatewayVolume = volume("drizzle-gateway-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 5000 });
  const redisVolume = volume("redis-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 5000 });
  const qdrantVolume = volume("qdrant-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 5000 });
  const compactEnvelope = bucket("compact-envelope", { region: "ams" });
  const examen2 = service("examen", {
    source: examen,
    start: "",
    preDeploy: "npm run db:migrate",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { sleepApplication: true },
    domains: ["examen.sixten.app"],
    env: { AWS_ACCESS_KEY_ID: preserve(), AWS_BUCKET_NAME: preserve(), AWS_ENDPOINT_URL: preserve(), AWS_REGION: preserve(), AWS_SECRET_ACCESS_KEY: preserve(), DATABASE_URL: preserve(), OPENROUTER_API_KEY: preserve(), QDRANT_API_KEY: preserve(), QDRANT_URL: preserve(), REDIS_URL: preserve() },
  });
  const DrizzleGateway = service("Drizzle Gateway", {
    source: image("ghcr.io/drizzle-team/gateway:latest"),
    healthcheck: "/health",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { sleepApplication: true },
    networking: { privateNetworkEndpoint: "drizzle-gateway" },
    volumeMounts: { "/app": drizzleGatewayVolume },
    env: { MASTERPASS: preserve() },
  });
  const S3Explorer = service("S3 Explorer", {
    source: github("subratomandal/s3explorer", { commitSha: "4dff58ebe92690716a9aed18dbea92e68b6d8856", upstreamUrl: "https://github.com/subratomandal/s3explorer" }),
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { sleepApplication: true },
    networking: { privateNetworkEndpoint: "s3-explorer" },
  });
  const Qdrant = service("Qdrant", {
    source: image("qdrant/qdrant"),
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { sleepApplication: true },
    networking: { privateNetworkEndpoint: "qdrant" },
    volumeMounts: { "/qdrant/storage": qdrantVolume },
    env: { PORT: preserve(), QDRANT__SERVICE__API_KEY: preserve() },
  });
  const scrape = service("scrape", {
    source: examen,
    build: "pnpm install --frozen-lockfile",
    start: "pnpm cron -- --stages scrape --mode backfill --max-items 500",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { cronSchedule: "*/30 * * * *", restartPolicyType: "NEVER" },
    networking: { privateNetworkEndpoint: "artistic-analysis" },
    env: { AWS_ACCESS_KEY_ID: preserve(), AWS_BUCKET_NAME: preserve(), AWS_ENDPOINT_URL: preserve(), AWS_REGION: preserve(), AWS_SECRET_ACCESS_KEY: preserve(), DATABASE_URL: preserve(), OPENROUTER_API_KEY: preserve(), QDRANT_API_KEY: preserve(), QDRANT_URL: preserve(), REDIS_URL: preserve() },
  });
  const embed = service("embed", {
    source: examen,
    build: "pnpm install --frozen-lockfile",
    start: "pnpm cron -- --stages embed,store,upsert --max-embed-items 50",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { cronSchedule: "0 * * * *", restartPolicyType: "NEVER" },
    networking: { privateNetworkEndpoint: "dependable-communication" },
    env: { AWS_ACCESS_KEY_ID: preserve(), AWS_BUCKET_NAME: preserve(), AWS_ENDPOINT_URL: preserve(), AWS_REGION: preserve(), AWS_SECRET_ACCESS_KEY: preserve(), DATABASE_URL: preserve(), OPENROUTER_API_KEY: preserve(), QDRANT_API_KEY: preserve(), QDRANT_URL: preserve(), REDIS_URL: preserve() },
  });
  const S3Explorer2 = group("S3 Explorer", [S3Explorer, compactEnvelope]);

  return project("examen", {
    resources: [examen2, DrizzleGateway, Qdrant, scrape, Postgres, Redis, embed, postgresVolume, drizzleGatewayVolume, redisVolume, qdrantVolume, S3Explorer2],
  });
});
