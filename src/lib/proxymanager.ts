import fs from 'fs';

export type ParsedProxy = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  label?: string;
};

type ProxyState = {
  proxy: ParsedProxy;
  failures: number;
  quarantineUntil?: number;
};

export class ProxyManager {
  private states: ProxyState[] = [];
  private idx = 0;

  constructor(filePath: string) {
    const lines = fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    if (!lines.length) throw new Error('proxies.txt is empty or missing');

    this.states = lines.map(raw => ({
      proxy: parseProxy(raw),
      failures: 0,
    }));
  }

  nextHealthy(): ProxyState | null {
    const now = Date.now();
    for (let i = 0; i < this.states.length; i++) {
      const ptr = (this.idx + i) % this.states.length;
      const st = this.states[ptr];
      if (!st.quarantineUntil || st.quarantineUntil <= now) {
        this.idx = (ptr + 1) % this.states.length;
        return st;
      }
    }
    return null;
  }

  markSuccess(st: ProxyState) {
    st.failures = 0;
    st.quarantineUntil = undefined;
  }

  markFailure(st: ProxyState, attempt: number) {
    st.failures += 1;
    if (st.failures >= 3) {
      const q = Math.min(5 * 60_000 * (attempt + 1), 30 * 60_000); // up to 30m
      st.quarantineUntil = Date.now() + q;
      st.failures = 0;
    }
  }
}

export function parseProxy(line: string): ParsedProxy {
  // Supports:
  // ip:port:user:pass:label
  // ip:port:label
  // ip:port
  const parts = line.split(':');
  if (parts.length >= 4) {
    const [host, port, user, pass, ...rest] = parts;
    return { host, port: Number(port), user, pass, label: rest.join(':') || undefined };
  }
  if (parts.length === 3) {
    const [host, port, label] = parts;
    return { host, port: Number(port), label };
  }
  const [host, port] = parts;
  return { host, port: Number(port) };
}

export function proxyToUrl(p: ParsedProxy): string {
  if (p.user && p.pass) {
    return `http://${encodeURIComponent(p.user)}:${encodeURIComponent(p.pass)}@${p.host}:${p.port}`;
  }
  return `http://${p.host}:${p.port}`;
}
