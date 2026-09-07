import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface AppConfig {
  dataDir: string;
  databasePath: string;
  gifsDir: string;
  debug: boolean;
  version: string;
  googleAnalyticsId?: string;
  googleAnalyticsName?: string;
}

export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
): AppConfig {
  const configuredDataDir = environment.DATA_DIR?.trim();
  const production = environment.NODE_ENV === "production";

  if (!configuredDataDir && production) {
    throw new Error("DATA_DIR must point to gif.gg's persistent data directory");
  }

  const dataDir = resolve(
    configuredDataDir || join(tmpdir(), "gifgg-development"),
  );
  const googleAnalyticsId = environment.GA_ID?.trim();
  const googleAnalyticsName = environment.GA_NAME?.trim();

  return {
    dataDir,
    databasePath: join(dataDir, "gifgg.sqlite"),
    gifsDir: join(dataDir, "gifs"),
    debug: !production,
    version: environment.APP_VERSION?.trim() || "1",
    ...(googleAnalyticsId ? { googleAnalyticsId } : {}),
    ...(googleAnalyticsName ? { googleAnalyticsName } : {}),
  };
}
