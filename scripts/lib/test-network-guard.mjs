// Test helper, preloaded with `node --import`: blocks every outgoing network
// connection in this process and reports each attempt on stderr. Tests use the
// report to tell whether a command tried to connect, and nothing can reach a
// real server even if a safety check were broken. Only host and port are
// reported, never credentials.
import dns from "node:dns";
import net from "node:net";

export const GUARD_MARKER = "[network-guard] blocked";

function blocked(target) {
  process.stderr.write(`${GUARD_MARKER} a connection attempt to ${target}\n`);
  return Object.assign(new Error(`network access to ${target} is blocked by the test network guard`), { code: "ETESTBLOCKED" });
}

net.Socket.prototype.connect = function connect(...args) {
  // Called as (port, host), (options), or internally with [options, callback].
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = first !== null && typeof first === "object" ? first : { port: first, host: typeof args[1] === "string" ? args[1] : "localhost" };
  const error = blocked(options.path ?? `${options.host ?? "localhost"}:${options.port}`);
  process.nextTick(() => this.destroy(error));
  return this;
};

dns.lookup = (hostname, options, callback) => {
  const done = typeof options === "function" ? options : callback;
  const error = blocked(`${hostname} (DNS lookup)`);
  process.nextTick(() => done(error));
};
dns.promises.lookup = async (hostname) => {
  throw blocked(`${hostname} (DNS lookup)`);
};
globalThis.fetch = async (input) => {
  throw blocked(String(input instanceof Request ? input.url : input));
};
