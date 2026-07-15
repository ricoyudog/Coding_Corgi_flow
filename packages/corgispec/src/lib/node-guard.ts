export const MIN_NODE_VERSION = "20.19.0";

function parseVersion(version: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return undefined;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNodeVersionSupported(version: string): boolean {
  const current = parseVersion(version);
  const minimum = parseVersion(MIN_NODE_VERSION)!;
  if (!current) return false;

  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index]! > minimum[index]!) return true;
    if (current[index]! < minimum[index]!) return false;
  }

  return true;
}

/**
 * Check that the running Node.js version meets the minimum requirement.
 * Exits the process with code 1 if the version is too low.
 */
export function checkNodeVersion(): void {
  const current = process.versions.node;

  if (!isNodeVersionSupported(current)) {
    process.exitCode = 1;
    throw new Error(
      `Node.js >= ${MIN_NODE_VERSION} required (current: v${current})`
    );
  }
}
