import { toast } from 'sonner';

/** Vite dev-server prefix proxied to the AgentScope backend. Same origin, no CORS preflight. */
const DEV_API_PREFIX = '/as-api';

/**
 * Stored backend origin, rewritten in Vite dev so API calls stay same-origin.
 *
 * The chat page already holds one SSE slot; a cross-origin `X-User-ID`
 * header would add an OPTIONS preflight to every request and exhaust
 * Chrome's 6-connection HTTP/1.1 limit. Setup still probes the raw
 * address via an explicit `baseUrl` override.
 */
export const getBaseUrl = () => {
	const stored = localStorage.getItem('server_url') ?? '';
	if (!import.meta.env.DEV || typeof window === 'undefined' || !stored) {
		return stored;
	}
	try {
		const target = new URL(stored);
		const here = window.location;
		if (target.port === '8002' && here.port === '5173' && target.origin !== here.origin) {
			return `${here.origin}${DEV_API_PREFIX}`;
		}
	} catch {
		// Fall through and use the stored value as-is.
	}
	return stored;
};
export const getUserId = () => localStorage.getItem('username') ?? '';

/**
 * Join a server root and an absolute API path.
 *
 * `new URL('/sessions/x', 'http://host/as-api')` drops the `/as-api`
 * prefix; concatenating keeps a proxied root intact.
 */
export function resolveApiUrl(path: string, base = getBaseUrl()): URL {
	const root = base.replace(/\/+$/, '');
	const suffix = path.startsWith('/') ? path : `/${path}`;
	return new URL(`${root}${suffix}`);
}

/**
 * Structured error thrown for non-2xx HTTP responses.
 * `message` contains the human-readable detail extracted from the backend.
 */
export class ApiError extends Error {
	readonly status: number;
	readonly detail: string;

	constructor(status: number, detail: string) {
		super(detail);
		this.name = 'ApiError';
		this.status = status;
		this.detail = detail;
	}
}

interface RequestOptions {
	method?: string;
	body?: unknown;
	params?: Record<string, string>;
	/** When true, suppresses the automatic error toast. Useful when the caller shows its own inline error UI. */
	silent?: boolean;
	signal?: AbortSignal;
	/** Overrides the stored server URL. Lets the setup page probe an address before persisting it. */
	baseUrl?: string;
	/** Overrides the stored username, for the same reason as `baseUrl`. */
	userId?: string;
	/** Gives up after this many ms and reports {@link TIMEOUT_STATUS}. Off by default — a streaming chat is meant to stay open. */
	timeoutMs?: number;
}

/** Reported when `timeoutMs` elapses. Real 408s come from a server, so either way the request did not complete in time. */
export const TIMEOUT_STATUS = 408;

function buildHeaders(hasBody: boolean, userId?: string): Record<string, string> {
	const headers: Record<string, string> = { 'X-User-ID': userId ?? getUserId() };
	if (hasBody) headers['Content-Type'] = 'application/json';
	return headers;
}

/** Parse the response body and extract the `detail` field if the backend returned JSON. */
async function extractErrorDetail(res: Response): Promise<string> {
	const text = await res.text();
	try {
		const json = JSON.parse(text) as { detail?: unknown };
		if (typeof json.detail === 'string') return json.detail;
		if (json.detail !== undefined) return JSON.stringify(json.detail);
	} catch {
		// not JSON – fall through
	}
	return text || res.statusText;
}

function isAbort(e: unknown): boolean {
	return e instanceof DOMException && e.name === 'AbortError';
}

function isTimeout(e: unknown): boolean {
	return e instanceof DOMException && e.name === 'TimeoutError';
}

async function fetchWithRetry(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
	try {
		return await fetch(url, init);
	} catch (e) {
		if (isAbort(e) || isTimeout(e) || signal?.aborted) throw e;
		// A crowded HTTP/1.1 pool (SSE + CORS preflight) can drop the first
		// attempt; one short retry usually lands after a slot frees up.
		await new Promise((r) => setTimeout(r, 200));
		if (signal?.aborted) throw e;
		return await fetch(url, init);
	}
}

async function streamRequest(path: string, options: RequestOptions = {}): Promise<Response> {
	const {
		method = 'GET',
		body,
		params,
		signal,
		silent = false,
		baseUrl,
		userId,
		timeoutMs,
	} = options;
	const url = resolveApiUrl(path, baseUrl ?? getBaseUrl());
	if (params) {
		Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
	}

	// AbortSignal.timeout aborts with a TimeoutError, which is what lets the
	// catch below tell "too slow" apart from the caller's own cancellation.
	const deadline = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
	const combined =
		deadline && signal ? AbortSignal.any([signal, deadline]) : (deadline ?? signal);

	let res: Response;
	try {
		res = await fetchWithRetry(
			url.toString(),
			{
				method,
				headers: buildHeaders(body !== undefined, userId),
				body: body ? JSON.stringify(body) : undefined,
				signal: combined,
			},
			combined,
		);
	} catch (e) {
		// An abort is the caller's own doing — pass it through untouched.
		if (isAbort(e)) throw e;
		// Otherwise fetch only rejects when the request never reached the
		// server: wrong address, DNS failure, refused connection, blocked
		// preflight. Status 0 distinguishes that from any HTTP-level failure.
		const error = isTimeout(e)
			? new ApiError(TIMEOUT_STATUS, 'The server took too long to respond.')
			: new ApiError(
					0,
					'Cannot reach the server. Check the server address and your network.',
				);
		if (!silent) toast.error(error.detail);
		throw error;
	}

	if (!res.ok) {
		const detail = await extractErrorDetail(res);
		const error = new ApiError(res.status, detail);
		if (!silent) toast.error(detail);
		throw error;
	}

	return res;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const res = await streamRequest(path, options);
	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
}

export const client = {
	get: <T>(
		path: string,
		params?: Record<string, string>,
		options?: { silent?: boolean; baseUrl?: string; userId?: string; timeoutMs?: number },
	) => request<T>(path, { method: 'GET', params, ...options }),
	post: <T>(
		path: string,
		body?: unknown,
		params?: Record<string, string>,
		options?: { silent?: boolean },
	) => request<T>(path, { method: 'POST', body, params, silent: options?.silent }),
	patch: <T>(
		path: string,
		body?: unknown,
		params?: Record<string, string>,
		options?: { silent?: boolean },
	) => request<T>(path, { method: 'PATCH', body, params, silent: options?.silent }),
	delete: <T = void>(path: string, params?: Record<string, string>) =>
		request<T>(path, { method: 'DELETE', params }),
	stream: (path: string, options?: RequestOptions) => streamRequest(path, options),
};
