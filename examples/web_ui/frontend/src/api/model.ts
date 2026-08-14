import { client } from './client';
import type { ListEmbeddingModelResponse, ListModelResponse, ListTTSModelResponse } from './types';

export const modelApi = {
	list: (provider: string, credentialId?: string) =>
		client.get<ListModelResponse>(
			'/model/',
			{
				provider,
				...(credentialId ? { credential_id: credentialId } : {}),
			},
			{ silent: true },
		),
};

export const ttsModelApi = {
	list: (provider: string, credentialId?: string, options?: { silent?: boolean }) =>
		client.get<ListTTSModelResponse>(
			'/tts-model/',
			{
				provider,
				...(credentialId ? { credential_id: credentialId } : {}),
			},
			options,
		),
};

export const embeddingModelApi = {
	list: (provider: string, credentialId?: string, options?: { silent?: boolean }) =>
		client.get<ListEmbeddingModelResponse>(
			'/embedding-model/',
			{
				provider,
				...(credentialId ? { credential_id: credentialId } : {}),
			},
			options,
		),
};
