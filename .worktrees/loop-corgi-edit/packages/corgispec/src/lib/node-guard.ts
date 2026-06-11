const MIN_NODE_MAJOR = 18;

/**
 * Check that the running Node.js version meets the minimum requirement.
 * Exits the process with code 1 if the version is too low.
 */
export function checkNodeVersion(): void {
  const current = process.versions.node;
  const major = parseInt(current.split(".")[0]!, 10);

  if (major < MIN_NODE_MAJOR) {
    process.exitCode = 1;
    throw new Error(
      `Node.js >= ${MIN_NODE_MAJOR} required (current: v${current})`
    );
  }
}
