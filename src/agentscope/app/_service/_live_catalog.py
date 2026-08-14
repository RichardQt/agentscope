# -*- coding: utf-8 -*-
"""Live model catalogues from OpenAI-compatible ``GET /models``.

SiliconFlow and similar hosts expose chat, embedding, TTS and other
models on one list. The UI needs them split; these helpers classify
ids and build the corresponding cards. Results are cached briefly so
the chat / embedding / TTS / KB pickers do not each hit the provider.
"""
from __future__ import annotations

import copy
import time
from typing import Literal

from pydantic import BaseModel

from ..._logging import logger
from ...credential import OpenAICredential
from ...embedding import EmbeddingModelCard
from ...model import ModelCard
from ...tts import TTSModelCard

Kind = Literal["chat", "embedding", "tts", "other"]

_CACHE_TTL_SECS = 60.0
_ids_cache: dict[str, tuple[float, list[str]]] = {}

# Checked first so ``bge-reranker`` is not treated as an embedding model.
_OTHER_NEEDLES = (
    "rerank",
    "whisper",
    "sensevoice",
    "telespeech",
    "-asr",
    "flux",
    "kolors",
    "stable-diffusion",
    "sdxl",
    "z-image",
    "ernie-image",
    "-image",
    "image-turbo",
    "clip",
)

_EMBED_NEEDLES = (
    "embed",
    "bge-",
    "bce-embedding",
    "gte-",
    "e5-",
    "jina-embeddings",
    "text2vec",
    "m3e",
)

_TTS_NEEDLES = (
    "tts",
    "cosyvoice",
    "fish-speech",
    "fishaudio",
    "indextts",
    "gpt-sovits",
)

# CosyVoice2 voices on SiliconFlow's OpenAI-compatible speech API.
_COMPAT_TTS_VOICES = (
    "alex",
    "anna",
    "bella",
    "benjamin",
    "charles",
    "claire",
    "david",
    "diana",
)


def classify_model_id(model_id: str) -> Kind:
    """Classify a provider model id as chat, embedding, TTS, or other."""
    lowered = model_id.lower()
    if any(needle in lowered for needle in _OTHER_NEEDLES):
        return "other"
    if any(needle in lowered for needle in _EMBED_NEEDLES):
        return "embedding"
    if any(needle in lowered for needle in _TTS_NEEDLES):
        return "tts"
    return "chat"


def openai_compat_pass_dimensions(model: str) -> bool:
    """Whether an OpenAI-compatible embed API accepts ``dimensions``.

    Official ``text-embedding-3-*`` and Qwen3-Embedding do; BGE and
    most other hosts reject the extra field with HTTP 400.
    """
    lowered = model.lower()
    return "text-embedding-3" in lowered or "qwen3-embedding" in lowered


def guess_embedding_dimensions(
    model_id: str,
) -> tuple[int, list[int] | None]:
    """Return ``(default, supported or None)`` for a live embedding id."""
    lowered = model_id.lower()
    if "text-embedding-3-large" in lowered:
        return 3072, [3072, 2560, 2048, 1536, 1024, 768, 512, 256]
    if "text-embedding-3-small" in lowered:
        return 1536, [1536, 1024, 768, 512, 256]
    if "text-embedding-ada-002" in lowered:
        return 1536, None
    if "qwen3-vl-embedding" in lowered or "qwen3-embedding-8b" in lowered:
        return 4096, [4096, 2048, 1024, 768, 512]
    if "qwen3-embedding-4b" in lowered:
        return 2560, [2560, 2048, 1024, 768, 512]
    if "qwen3-embedding-0.6b" in lowered:
        return 1024, [1024, 768, 512, 256]
    if "bge-small" in lowered:
        return 512, None
    if "bge-base" in lowered:
        return 768, None
    if "bge-large" in lowered or "bge-m3" in lowered:
        return 1024, None
    if "bce-embedding" in lowered:
        return 768, None
    return 1024, None


async def list_openai_compatible_ids(
    credential: OpenAICredential,
    cache_key: str | None = None,
) -> list[str]:
    """Return model ids from the credential's ``GET /models`` endpoint."""
    if cache_key:
        hit = _ids_cache.get(cache_key)
        if hit is not None:
            cached_at, ids = hit
            if time.monotonic() - cached_at < _CACHE_TTL_SECS:
                return ids

    import openai

    client = openai.AsyncClient(
        api_key=credential.api_key.get_secret_value(),
        organization=credential.organization,
        base_url=credential.base_url,
        timeout=8.0,
    )
    try:
        page = await client.models.list()
        ids = sorted(
            {item.id for item in page.data if getattr(item, "id", None)},
        )
    finally:
        await client.close()

    if cache_key:
        _ids_cache[cache_key] = (time.monotonic(), ids)
    return ids


def chat_cards_from_ids(
    model_ids: list[str],
    parameter_class: type[BaseModel],
) -> list[ModelCard]:
    """Build chat-model cards for remote ids."""
    base_schema = parameter_class.model_json_schema()
    properties = copy.deepcopy(base_schema.get("properties", {}))
    for hidden in (
        "thinking_enable",
        "thinking_budget",
        "thinking_mode",
        "thinking_display",
        "voice",
    ):
        properties.pop(hidden, None)
    parameter_schema = {
        "type": "object",
        "properties": properties,
        "required": base_schema.get("required", []),
    }
    return [
        ModelCard(
            name=model_id,
            label=model_id,
            status="active",
            input_types=["text/plain"],
            output_types=["text/plain"],
            context_size=128000,
            output_size=8192,
            parameter_schema=parameter_schema,
            parameters_overrides={},
        )
        for model_id in model_ids
        if classify_model_id(model_id) == "chat"
    ]


def embedding_cards_from_ids(
    model_ids: list[str],
    parameter_class: type[BaseModel],
) -> list[EmbeddingModelCard]:
    """Build embedding-model cards for remote ids."""
    base_schema = parameter_class.model_json_schema()
    properties = copy.deepcopy(base_schema.get("properties", {}))
    parameter_schema = {
        "type": "object",
        "properties": properties,
        "required": base_schema.get("required", []),
    }
    cards: list[EmbeddingModelCard] = []
    for model_id in model_ids:
        if classify_model_id(model_id) != "embedding":
            continue
        dimensions, supported = guess_embedding_dimensions(model_id)
        lowered = model_id.lower()
        input_types = ["text/plain"]
        if "vl-embedding" in lowered:
            input_types = ["text/plain", "image/jpeg", "image/png"]
        cards.append(
            EmbeddingModelCard(
                name=model_id,
                label=model_id,
                status="active",
                input_types=input_types,
                output_types=["application/x-embedding"],
                dimensions=dimensions,
                supported_dimensions=supported,
                context_size=8192,
                parameter_schema=parameter_schema,
                parameter_overrides={},
            ),
        )
    return cards


def tts_cards_from_ids(
    model_ids: list[str],
    parameter_class: type[BaseModel],
) -> list[TTSModelCard]:
    """Build TTS-model cards for remote ids."""
    base_schema = parameter_class.model_json_schema()
    properties = copy.deepcopy(base_schema.get("properties", {}))
    # Compatible speech APIs rarely honour OpenAI's instructions field.
    properties.pop("instructions", None)
    if "voice" in properties:
        properties["voice"] = {
            **properties["voice"],
            "default": _COMPAT_TTS_VOICES[0],
            "enum": list(_COMPAT_TTS_VOICES),
        }
    required = [r for r in base_schema.get("required", []) if r in properties]
    parameter_schema = {
        "type": "object",
        "properties": properties,
        "required": required,
    }
    return [
        TTSModelCard(
            name=model_id,
            label=model_id,
            status="active",
            input_types=["text/plain"],
            output_types=["audio/mpeg"],
            realtime=False,
            parameter_schema=parameter_schema,
            parameters_overrides={},
        )
        for model_id in model_ids
        if classify_model_id(model_id) == "tts"
    ]


async def probe_openai_compatible_ids(
    credential: object,
    cache_key: str | None = None,
) -> list[str]:
    """Probe an OpenAI-compatible credential; empty on failure or skip."""
    if not isinstance(credential, OpenAICredential):
        return []
    try:
        return await list_openai_compatible_ids(
            credential,
            cache_key=cache_key,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning(
            "Live model list failed for credential %s: %s",
            cache_key or getattr(credential, "id", "?"),
            exc,
        )
        return []
