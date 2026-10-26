/**
 * Cloudflare REST API client (no deps) — used with the CUSTOMER's API token (transient).
 * Token is sent only in the Authorization header and never logged.
 */
import { randHex } from '../../../packages/shared/src/config';

const CF_API = 'https://api.cloudflare.com/client/v4';

export interface CfResult<T> {
  ok: boolean;
  result?: T;
  code?: number | string;
  message?: string;
  status: number;
}

export interface D1DbInfo {
  uuid: string;
  name: string;
}

export function buildMultipart(fields: Array<{ name: string; filename?: string; contentType: string; body: string }>): {
  contentType: string;
  body: string;
} {
  const boundary = `----cybrixform${randHex(12)}`;
  let body = '';
  for (const f of fields) {
    body += `--${boundary}\r\n`;
    body += `content-disposition: form-data; name="${f.name}"${f.filename ? `; filename="${f.filename}"` : ''}\r\n`;
    body += `content-type: ${f.contentType}\r\n\r\n`;
    body += `${f.body}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return { contentType: `multipart/form-data; boundary=${boundary}`, body };
}

export class Cf {
  constructor(private token: string) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<CfResult<T>> {
    try {
      const res = await fetch(`${CF_API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return this.parse<T>(res);
    } catch (e) {
      return { ok: false, code: 'network', message: e instanceof Error ? e.message : 'network error', status: 0 };
    }
  }

  private async parse<T>(res: Response): Promise<CfResult<T>> {
    let j: any = null;
    try {
      j = await res.json();
    } catch {
      /* non-JSON */
    }
    if (j && typeof j === 'object' && 'success' in j) {
      if (j.success) return { ok: true, result: j.result as T, status: res.status };
      const e = Array.isArray(j.errors) && j.errors[0] ? j.errors[0] : {};
      return {
        ok: false,
        code: e.code ?? res.status,
        message: (e.message ?? 'unknown Cloudflare error').slice(0, 160),
        status: res.status,
      };
    }
    if (res.ok) return { ok: true, result: j as T, status: res.status };
    return { ok: false, code: res.status, message: `HTTP ${res.status}`, status: res.status };
  }

  /* ----------------------------- token & accounts ----------------------------- */

  verifyToken(): Promise<CfResult<{ id: string; status: string }>> {
    return this.req('GET', '/user/tokens/verify');
  }

  listAccounts(): Promise<CfResult<Array<{ id: string; name: string }>>> {
    return this.req('GET', '/accounts?per_page=50');
  }

  /* --------------------------- permission probes ------------------------------ */

  /** Workers Scripts permission probe (list scripts). */
  probeWorkers(accountId: string): Promise<CfResult<unknown>> {
    return this.req('GET', `/accounts/${accountId}/workers/scripts?per_page=5`);
  }

  /** List worker scripts (used to warn when a worker name will be overwritten). */
  listWorkers(accountId: string): Promise<CfResult<Array<{ id: string }>>> {
    return this.req('GET', `/accounts/${accountId}/workers/scripts?per_page=50`);
  }

  /** D1 permission probe (list databases). */
  probeD1(accountId: string): Promise<CfResult<unknown>> {
    return this.req('GET', `/accounts/${accountId}/d1/database?per_page=5`);
  }

  /* --------------------------------- D1 --------------------------------------- */

  async listD1(accountId: string): Promise<CfResult<D1DbInfo[]>> {
    const first = await this.req<{ uuid: string; name: string }[]>(
      'GET',
      `/accounts/${accountId}/d1/database?per_page=50&page=1`
    );
    if (!first.ok || !first.result) return { ok: first.ok, status: first.status, code: first.code, message: first.message };
    const list: D1DbInfo[] = first.result.map((d) => ({ uuid: d.uuid, name: d.name }));
    if (first.result.length === 50) {
      const second = await this.req<{ uuid: string; name: string }[]>(
        'GET',
        `/accounts/${accountId}/d1/database?per_page=50&page=2`
      );
      if (second.ok && second.result) for (const d of second.result) list.push({ uuid: d.uuid, name: d.name });
    }
    return { ok: true, result: list, status: first.status };
  }

  createD1(accountId: string, name: string): Promise<CfResult<{ uuid: string; name: string }>> {
    return this.req('POST', `/accounts/${accountId}/d1/database`, { name });
  }

  /* ------------------------------- Workers ------------------------------------ */

  /**
   * Upload a module worker (ES module) with bindings.
   * metadata + main.js as multipart/form-data (metadata is application/json, source is application/javascript+module).
   */
  async uploadWorker(
    accountId: string,
    name: string,
    metadata: Record<string, unknown>,
    moduleContent: string
  ): Promise<CfResult<unknown>> {
    const { contentType, body } = buildMultipart([
      { name: 'metadata', contentType: 'application/json', body: JSON.stringify(metadata) },
      { name: 'main.js', filename: 'main.js', contentType: 'application/javascript+module', body: moduleContent },
    ]);
    try {
      const res = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': contentType },
        body,
      });
      return this.parse(res);
    } catch (e) {
      return { ok: false, code: 'network', message: e instanceof Error ? e.message : 'network error', status: 0 };
    }
  }

  /** Account-level workers.dev subdomain (auto-registers one for fresh accounts). */
  async getSubdomain(accountId: string): Promise<CfResult<{ subdomain: string }>> {
    const r = await this.req<{ subdomain?: string }>('GET', `/accounts/${accountId}/workers/subdomain`);
    if (r.ok && r.result?.subdomain) return { ok: true, result: { subdomain: r.result.subdomain }, status: r.status };
    // Fresh account without a registered subdomain — try to register one (best effort).
    const seed = randHex(2);
    const candidate = `cybrix-${seed}`;
    const put = await this.req<{ subdomain?: string }>('PUT', `/accounts/${accountId}/workers/subdomain`, {
      subdomain: candidate,
    });
    if (put.ok && put.result?.subdomain) return { ok: true, result: { subdomain: put.result.subdomain }, status: put.status };
    return {
      ok: false,
      code: put.code ?? r.code,
      message: put.message ?? r.message ?? 'no workers.dev subdomain registered for this account',
      status: put.status || r.status,
    };
  }

  /** Enable the workers.dev route for a script. */
  enableSubdomain(accountId: string, scriptName: string): Promise<CfResult<unknown>> {
    return this.req('POST', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`, {
      enabled: true,
      previews_enabled: false,
    });
  }
}
