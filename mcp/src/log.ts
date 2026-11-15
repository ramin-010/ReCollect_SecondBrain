// stdout is the MCP channel (JSON-RPC over stdio): everything human-readable goes to stderr.

export type Logger = (message: string) => void;

export const stderrLogger: Logger = (message) => {
    process.stderr.write(`[recollect-mcp] ${message}\n`);
};

export const silentLogger: Logger = () => {};
