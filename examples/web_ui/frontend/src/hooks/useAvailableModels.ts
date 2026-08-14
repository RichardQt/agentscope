import { useState, useEffect, useCallback } from 'react';

import { credentialApi, modelApi } from '@/api';
import type { CredentialView, ModelCard } from '@/api';

export interface CredentialWithModels {
	credential: CredentialView;
	models: ModelCard[];
}

type Groups = Record<string, CredentialWithModels[]>;

const CACHE_TTL_MS = 5 * 60_000;
let cached: { at: number; data: Groups } | null = null;
let inflight: Promise<Groups> | null = null;

async function loadGroups(): Promise<Groups> {
	if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
		return cached.data;
	}
	if (!inflight) {
		inflight = (async () => {
			const { credentials } = await credentialApi.list({ silent: true });
			const result: Groups = {};
			await Promise.all(
				credentials.map(async (credential) => {
					const type = credential.data.type as string | undefined;
					if (!type) return;
					if (!result[type]) result[type] = [];
					try {
						const { models } = await modelApi.list(type, credential.id);
						result[type].push({ credential, models });
					} catch {
						result[type].push({ credential, models: [] });
					}
				}),
			);
			cached = { at: Date.now(), data: result };
			return result;
		})().finally(() => {
			inflight = null;
		});
	}
	return inflight;
}

/**
 * Fetches all credentials and their available models, grouped by provider type.
 * Provider type is read from `credential.data.type`.
 * Credentials without a `type` field or whose model fetch fails are silently skipped.
 *
 * Chat, the LLM picker and the parameter popover all call this hook;
 * they share one in-flight request so the browser does not exhaust
 * HTTP/1.1's 6-connection-per-host limit (the session SSE stream
 * already occupies one slot).
 */
export function useAvailableModels() {
	const [groups, setGroups] = useState<Groups>(cached?.data ?? {});
	const [loading, setLoading] = useState(!cached);
	const [error, setError] = useState<Error | null>(null);

	const refetch = useCallback(async (force = false) => {
		if (force) cached = null;
		const fresh = cached && Date.now() - cached.at < CACHE_TTL_MS;
		if (!fresh) setLoading(true);
		setError(null);
		try {
			const result = await loadGroups();
			setGroups(result);
		} catch (e) {
			setError(e as Error);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refetch();
	}, [refetch]);

	return { groups, loading, error, refetch };
}
