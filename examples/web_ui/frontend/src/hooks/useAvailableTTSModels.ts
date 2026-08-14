import { useState, useEffect, useCallback } from 'react';

import { credentialApi, ttsModelApi } from '@/api';
import type { CredentialView, TTSModelCard } from '@/api';

export interface CredentialWithTTSModels {
	credential: CredentialView;
	models: TTSModelCard[];
}

type Groups = Record<string, CredentialWithTTSModels[]>;

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
						const { models } = await ttsModelApi.list(type, credential.id, {
							silent: true,
						});
						if (models.length > 0) {
							result[type].push({ credential, models });
						}
					} catch {
						// Provider doesn't support TTS — skip silently
					}
				}),
			);

			for (const key of Object.keys(result)) {
				if (result[key].length === 0) delete result[key];
			}

			cached = { at: Date.now(), data: result };
			return result;
		})().finally(() => {
			inflight = null;
		});
	}
	return inflight;
}

/**
 * Fetches all credentials and their available TTS models, grouped by provider type.
 * Credentials/providers that expose no TTS models are omitted.
 */
export function useAvailableTTSModels() {
	const [groups, setGroups] = useState<Groups>(cached?.data ?? {});
	const [loading, setLoading] = useState(!cached);
	const [error, setError] = useState<Error | null>(null);

	const refetch = useCallback(async () => {
		const fresh = cached && Date.now() - cached.at < CACHE_TTL_MS;
		if (!fresh) setLoading(true);
		setError(null);
		try {
			setGroups(await loadGroups());
		} catch (e) {
			setError(e as Error);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refetch();
	}, [refetch]);

	return { groups, loading, error, refetch };
}
